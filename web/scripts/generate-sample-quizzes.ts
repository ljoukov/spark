import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GoogleGenAI } from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import type { InlineSourceFile, QuizGeneration } from '../src/lib/llm/schemas';
import {
	QUIZ_RESPONSE_SCHEMA,
	buildGenerationPrompt,
	buildSourceParts,
	parseQuizFromText,
	type GenerateQuizOptions
} from '../src/lib/server/llm/quizPrompts';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data', 'samples');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'static', 'admin', 'sample-quizzes');

const MODEL_ID = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.2;

const proxyUrl =
	process.env.HTTPS_PROXY ??
	process.env.https_proxy ??
	process.env.HTTP_PROXY ??
	process.env.http_proxy ??
	process.env.npm_config_https_proxy ??
	process.env.npm_config_proxy ??
	process.env.npm_config_http_proxy;

if (proxyUrl) {
	setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

type CategoryConfig = Omit<GenerateQuizOptions, 'sourceFiles'>;

const CATEGORY_DEFAULTS: Record<string, CategoryConfig> = {
	'with-questions': {
		mode: 'extraction',
		questionCount: 6,
		subject: 'chemistry',
		board: 'AQA',
		temperature: DEFAULT_TEMPERATURE
	},
	'no-questions': {
		mode: 'synthesis',
		questionCount: 6,
		subject: 'biology',
		board: 'OCR',
		temperature: DEFAULT_TEMPERATURE
	}
};

const FALLBACK_CONFIG: CategoryConfig = {
	mode: 'synthesis',
	questionCount: 6,
	temperature: DEFAULT_TEMPERATURE
};

type SampleJob = {
	readonly id: string;
	readonly category: string;
	readonly displayName: string;
	readonly sourcePath: string;
	readonly relativeSourcePath: string;
	readonly mode: 'extraction' | 'synthesis';
	readonly questionCount: number;
	readonly subject?: string;
	readonly board?: string;
	readonly temperature?: number;
};

type GeneratedSample = {
	readonly job: SampleJob;
	readonly quiz: QuizGeneration;
	readonly prompt: string;
	readonly outputFileName: string;
	readonly generatedAt: string;
};

function slugify(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '')
			.replace(/-{2,}/g, '-')
			.trim() || 'sample'
	);
}

function detectMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.pdf':
			return 'application/pdf';
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.png':
			return 'image/png';
		default:
			throw new Error(`Unsupported extension for inline data: ${ext}`);
	}
}

async function loadInlineSource(filePath: string): Promise<InlineSourceFile> {
	const buffer = await readFile(filePath);
	return {
		displayName: path.basename(filePath),
		mimeType: detectMimeType(filePath),
		data: buffer.toString('base64')
	};
}

async function collectJobs(): Promise<SampleJob[]> {
	const entries = await readdir(DATA_ROOT, { withFileTypes: true });
	const slugCounts = new Map<string, number>();
	const jobs: SampleJob[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const category = entry.name;
		const categoryPath = path.join(DATA_ROOT, category);
		const config = CATEGORY_DEFAULTS[category] ?? FALLBACK_CONFIG;
		const files = await readdir(categoryPath, { withFileTypes: true });
		for (const file of files) {
			if (!file.isFile()) {
				continue;
			}
			const sourcePath = path.join(categoryPath, file.name);
			const displayName = file.name;
			const baseSlug = `${category}-${slugify(path.parse(displayName).name)}`;
			const count = slugCounts.get(baseSlug) ?? 0;
			slugCounts.set(baseSlug, count + 1);
			const id = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
			const relativeSourcePath = path.relative(REPO_ROOT, sourcePath).split(path.sep).join('/');
			jobs.push({
				id,
				category,
				displayName,
				sourcePath,
				relativeSourcePath,
				mode: config.mode,
				questionCount: config.questionCount,
				subject: config.subject,
				board: config.board,
				temperature: config.temperature
			});
		}
	}
	jobs.sort((a, b) => a.id.localeCompare(b.id));
	return jobs;
}

async function generateQuiz(client: GoogleGenAI, job: SampleJob): Promise<GeneratedSample> {
	const source = await loadInlineSource(job.sourcePath);
	const options: GenerateQuizOptions = {
		mode: job.mode,
		questionCount: job.questionCount,
		subject: job.subject,
		board: job.board,
		sourceFiles: [source],
		temperature: job.temperature
	};
	const prompt = buildGenerationPrompt(options);
	const parts = [{ text: prompt }, ...buildSourceParts(options.sourceFiles)];
	const response = await client.models.generateContent({
		model: MODEL_ID,
		contents: [
			{
				role: 'user',
				parts
			}
		],
		config: {
			responseMimeType: 'application/json',
			responseSchema: QUIZ_RESPONSE_SCHEMA,
			temperature: options.temperature ?? DEFAULT_TEMPERATURE
		}
	});
	const text = response.text;
	if (!text) {
		throw new Error(`Gemini returned an empty response for ${job.id}`);
	}
	const quiz = parseQuizFromText(text);
	const outputFileName = `${job.id}.json`;
	return {
		job,
		quiz,
		prompt,
		outputFileName,
		generatedAt: new Date().toISOString()
	};
}

async function main(): Promise<void> {
	const apiKey = process.env.GEMINI_API_KEY?.trim();
	if (!apiKey) {
		console.error('[sample-quizzes] GEMINI_API_KEY is not set.');
		process.exitCode = 1;
		return;
	}
	const jobs = await collectJobs();
	if (jobs.length === 0) {
		console.warn('[sample-quizzes] No sample files found.');
		return;
	}

	await rm(OUTPUT_DIR, { recursive: true, force: true });
	await mkdir(OUTPUT_DIR, { recursive: true });

	const client = new GoogleGenAI({ apiKey });
	const indexGeneratedAt = new Date().toISOString();
	const results: GeneratedSample[] = [];

	for (const job of jobs) {
		console.log(
			`[sample-quizzes] Generating ${job.id} (${job.mode}) from ${job.relativeSourcePath}...`
		);
		try {
			const result = await generateQuiz(client, job);
			const outputPath = path.join(OUTPUT_DIR, result.outputFileName);
			const payload = {
				id: result.job.id,
				mode: result.job.mode,
				subject: result.job.subject,
				board: result.job.board,
				generatedAt: result.generatedAt,
				request: {
					model: MODEL_ID,
					questionCount: result.job.questionCount,
					temperature: result.job.temperature ?? DEFAULT_TEMPERATURE
				},
				source: {
					relativePath: result.job.relativeSourcePath,
					displayName: result.job.displayName
				},
				prompt: result.prompt,
				quiz: result.quiz
			};
			await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
			results.push(result);
			console.log(`[sample-quizzes] Saved ${result.outputFileName}`);
		} catch (error) {
			console.error(
				`[sample-quizzes] Failed to generate quiz for ${job.id}:`,
				error instanceof Error ? error.message : error
			);
			throw error;
		}
	}

	const indexPayload = {
		generatedAt: indexGeneratedAt,
		samples: results.map((result, index) => ({
			id: result.job.id,
			label: `Sample ${index + 1}: ${result.job.displayName}`,
			mode: result.job.mode,
			subject: result.job.subject,
			board: result.job.board,
			questionCount: result.quiz.questionCount,
			request: {
				model: MODEL_ID,
				questionCount: result.job.questionCount,
				temperature: result.job.temperature ?? DEFAULT_TEMPERATURE
			},
			source: {
				relativePath: result.job.relativeSourcePath,
				displayName: result.job.displayName
			},
			quizTitle: result.quiz.quizTitle,
			summary: result.quiz.summary,
			outputPath: `/admin/sample-quizzes/${result.outputFileName}`,
			generatedAt: result.generatedAt
		}))
	};

	await writeFile(
		path.join(OUTPUT_DIR, 'index.json'),
		JSON.stringify(indexPayload, null, 2),
		'utf8'
	);
	console.log(`[sample-quizzes] Wrote index.json with ${results.length} entries.`);
}

main().catch((error) => {
	console.error('[sample-quizzes] Unhandled error:', error);
	process.exitCode = 1;
});
