#!/usr/bin/env node
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GoogleGenAI } from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import {
	QUIZ_RESPONSE_SCHEMA,
	buildGenerationPrompt,
	buildSourceParts,
	normaliseQuizPayload,
	type GenerationPromptOptions
} from '../src/lib/server/llm/generationCore';
import {
	QuizGenerationSchema,
	type InlineSourceFile,
	type QuizGeneration
} from '../src/lib/server/llm/schemas';

const DEFAULT_QUESTION_COUNT = 6;
const SUBJECT_BY_MODE: Record<GenerationPromptOptions['mode'], string> = {
	extraction: 'chemistry',
	synthesis: 'biology'
};
const BOARD_BY_MODE: Record<GenerationPromptOptions['mode'], string> = {
	extraction: 'AQA',
	synthesis: 'OCR'
};

interface GenerateOptions extends GenerationPromptOptions {
	readonly sourceFiles: InlineSourceFile[];
}

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const GEMINI_MODEL_ID = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.2;

function createGeminiClient(): GoogleGenAI {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error('GEMINI_API_KEY environment variable is required.');
	}
	return new GoogleGenAI({ apiKey });
}

function configureProxyAgent(): void {
	const candidates = [
		process.env.HTTPS_PROXY,
		process.env.https_proxy,
		process.env.HTTP_PROXY,
		process.env.http_proxy
	];
	const proxy = candidates.find((value) => typeof value === 'string' && value.length > 0);
	if (proxy) {
		setGlobalDispatcher(new ProxyAgent(proxy));
	}
}

configureProxyAgent();

const geminiClient = createGeminiClient();

interface PreviewIndexEntry {
	readonly id: number;
	readonly sourceRelativePath: string;
	readonly mode: GenerationPromptOptions['mode'];
	readonly subject?: string;
	readonly board?: string;
	readonly questionCount: number;
	readonly outputFile: string;
}

interface PreviewDetail extends PreviewIndexEntry {
	readonly quiz: unknown;
}

async function generateQuiz(options: GenerateOptions): Promise<QuizGeneration> {
	const prompt = buildGenerationPrompt(options);
	const parts = [{ text: prompt }, ...buildSourceParts(options.sourceFiles)];
	const response = await geminiClient.models.generateContent({
		model: GEMINI_MODEL_ID,
		contents: [
			{
				role: 'user',
				parts
			}
		],
		config: {
			responseMimeType: 'application/json',
			responseSchema: QUIZ_RESPONSE_SCHEMA,
			temperature: DEFAULT_TEMPERATURE
		}
	});

	const text = response.text;
	if (!text) {
		throw new Error('Gemini returned an empty response for quiz generation.');
	}

	const parsed = JSON.parse(text);
	const normalised = normaliseQuizPayload(parsed);
	return QuizGenerationSchema.parse(normalised);
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
			throw new Error(`Unsupported file extension: ${ext}`);
	}
}

async function listRelativeFiles(root: string, relative = ''): Promise<string[]> {
	const absolute = path.join(root, relative);
	const items = await readdir(absolute, { withFileTypes: true });
	const files: string[] = [];
	for (const item of items) {
		if (item.isDirectory()) {
			const nested = await listRelativeFiles(root, path.join(relative, item.name));
			files.push(...nested);
		} else if (item.isFile()) {
			const entryPath = path.join(relative, item.name);
			if (SUPPORTED_EXTENSIONS.has(path.extname(entryPath).toLowerCase())) {
				files.push(entryPath);
			}
		}
	}
	return files;
}

async function loadInlineSourceFile(root: string, relativePath: string): Promise<InlineSourceFile> {
	const absolutePath = path.join(root, relativePath);
	const data = await readFile(absolutePath);
	return {
		displayName: path.basename(relativePath),
		mimeType: detectMimeType(relativePath),
		data: data.toString('base64')
	};
}

function resolveMode(relativePath: string): GenerationPromptOptions['mode'] {
	const [topLevel] = relativePath.split(path.sep);
	if (topLevel === 'with-questions') {
		return 'extraction';
	}
	return 'synthesis';
}

function normaliseRelativePath(relativePath: string): string {
	return relativePath.split(path.sep).join('/');
}

async function main(): Promise<void> {
	const currentFile = fileURLToPath(import.meta.url);
	const scriptsDir = path.dirname(currentFile);
	const webDir = path.resolve(scriptsDir, '..');
	const repoRoot = path.resolve(webDir, '..');
	const dataRoot = path.join(repoRoot, 'data', 'samples');
	const outputDir = path.join(webDir, 'static', 'admin-preview-data');

	await rm(outputDir, { recursive: true, force: true });
	await mkdir(outputDir, { recursive: true });

	const relativeFiles = await listRelativeFiles(dataRoot);
	relativeFiles.sort((a, b) => a.localeCompare(b));

	if (relativeFiles.length === 0) {
		console.warn('[admin-previews] No sample files found.');
		return;
	}

	const indexEntries: PreviewIndexEntry[] = [];
	let counter = 0;

	for (const relative of relativeFiles) {
		counter += 1;
		const mode = resolveMode(relative);
		const subject = SUBJECT_BY_MODE[mode];
		const board = BOARD_BY_MODE[mode];
		const inlineSource = await loadInlineSourceFile(dataRoot, relative);
		const normalisedPath = normaliseRelativePath(relative);

		console.log(
			`[admin-previews] Generating ${mode} quiz for ${normalisedPath} (entry #${counter}).`
		);

		const quiz = await generateQuiz({
			mode,
			questionCount: DEFAULT_QUESTION_COUNT,
			subject,
			board,
			sourceFiles: [inlineSource]
		});

		const outputFile = `preview-${String(counter).padStart(2, '0')}.json`;
		const detail: PreviewDetail = {
			id: counter,
			sourceRelativePath: normalisedPath,
			mode,
			subject,
			board,
			questionCount: quiz.questionCount,
			outputFile,
			quiz
		};

		await writeFile(
			path.join(outputDir, outputFile),
			`${JSON.stringify(detail, null, 2)}\n`,
			'utf8'
		);

		indexEntries.push({
			id: detail.id,
			sourceRelativePath: detail.sourceRelativePath,
			mode: detail.mode,
			subject: detail.subject,
			board: detail.board,
			questionCount: detail.questionCount,
			outputFile: detail.outputFile
		});
	}

	const indexPayload = {
		generatedAt: new Date().toISOString(),
		entries: indexEntries
	};

	await writeFile(
		path.join(outputDir, 'index.json'),
		`${JSON.stringify(indexPayload, null, 2)}\n`,
		'utf8'
	);

	console.log(
		`[admin-previews] Wrote ${indexEntries.length} previews to ${path.relative(
			repoRoot,
			outputDir
		)}`
	);
}

main().catch((error) => {
	console.error('[admin-previews] Failed to generate previews.');
	console.error(error);
	process.exitCode = 1;
});
