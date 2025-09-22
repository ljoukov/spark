import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	type InlineSourceFile,
	type QuizGeneration,
	QuizGenerationSchema
} from '../src/lib/server/llm/schemas';
import { previewFixtures } from './fixtures/adminPreviewQuizzes';

type ModeConfig = {
	readonly mode: 'extraction' | 'synthesis';
	readonly subject?: string;
	readonly board?: string;
	readonly questionCount: number;
};

type GenerationSource = 'live' | 'fixture';

type ManifestSourceFile = {
	readonly relativePath: string;
	readonly displayName: string;
	readonly mimeType: string;
	readonly bytes: number;
};

type ManifestEntry = {
	readonly id: string;
	readonly label: string;
	readonly mode: 'extraction' | 'synthesis' | 'extension';
	readonly questionCount: number;
	readonly subject?: string;
	readonly board?: string;
	readonly generatedAt: string;
	readonly generationSource: GenerationSource;
	readonly status: 'ok' | 'error';
	readonly errorMessage?: string;
	readonly quizPath: string;
	readonly sourceFiles: ManifestSourceFile[];
};

type ManifestFile = {
	readonly generatedAt: string;
	readonly generator: {
		readonly script: string;
		readonly questionCountDefault: number;
		readonly usedFixtures: boolean;
	};
	readonly entries: ManifestEntry[];
};

type QuizGeneratorModule = typeof import('../src/lib/server/llm/quizGenerator');

const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const WEB_ROOT = path.resolve(CURRENT_DIR, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');
const DATA_ROOT = path.resolve(REPO_ROOT, 'data', 'samples');
const OUTPUT_DIR = path.resolve(WEB_ROOT, 'static', 'admin', 'quiz-previews');
const DEFAULT_QUESTION_COUNT = 3;

const FORCE_FIXTURES = process.env.SPARK_PREVIEW_FORCE_FIXTURES === '1';
const HAS_GEMINI_KEY = Boolean(process.env.GEMINI_API_KEY?.trim());

let generatorModulePromise: Promise<QuizGeneratorModule> | undefined;

async function getGeneratorModule(): Promise<QuizGeneratorModule> {
	if (!generatorModulePromise) {
		generatorModulePromise = import('../src/lib/server/llm/quizGenerator');
	}
	return generatorModulePromise;
}

async function collectSampleFiles(root: string): Promise<string[]> {
	const results: string[] = [];
	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			if (entry.isFile()) {
				results.push(fullPath);
			}
		}
	}
	await walk(root);
	results.sort();
	return results;
}

function detectModeConfig(relativePath: string): ModeConfig {
	const firstSegment = relativePath.split(/[\\/]/)[0] ?? '';
	switch (firstSegment) {
		case 'with-questions':
			return {
				mode: 'extraction',
				subject: 'chemistry',
				board: 'AQA',
				questionCount: DEFAULT_QUESTION_COUNT
			};
		case 'no-questions':
			return {
				mode: 'synthesis',
				subject: 'biology',
				board: 'OCR',
				questionCount: DEFAULT_QUESTION_COUNT
			};
		default:
			return { mode: 'synthesis', questionCount: DEFAULT_QUESTION_COUNT };
	}
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

function toSlug(relativePath: string): string {
	const normalised = relativePath.replace(/[\\]+/g, '/');
	return normalised
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();
}

function toPosix(relativePath: string): string {
	return relativePath.replace(/\\/g, '/');
}

async function ensureOutputDirectory(target: string): Promise<void> {
	await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });
}

async function generateQuiz(
	inlineFiles: InlineSourceFile[],
	config: ModeConfig
): Promise<QuizGeneration | undefined> {
	if (FORCE_FIXTURES || !HAS_GEMINI_KEY) {
		return undefined;
	}
	const module = await getGeneratorModule();
	return module.generateQuizFromSource({
		mode: config.mode,
		questionCount: config.questionCount,
		sourceFiles: inlineFiles,
		subject: config.subject,
		board: config.board
	});
}

async function main(): Promise<void> {
	console.log('[preview] collecting sample files…');
	const files = await collectSampleFiles(DATA_ROOT);
	if (files.length === 0) {
		console.warn('[preview] no sample files found.');
	}

	await ensureOutputDirectory(OUTPUT_DIR);
	const generatedAt = new Date().toISOString();
	const manifestEntries: ManifestEntry[] = [];
	let usedFixtures = false;

	for (const absolutePath of files) {
		const relativePath = path.relative(DATA_ROOT, absolutePath);
		const posixRelativePath = toPosix(relativePath);
		const slug = toSlug(relativePath);
		const config = detectModeConfig(relativePath);
		const displayName = path.basename(relativePath);
		const label = posixRelativePath;
		const mimeType = detectMimeType(absolutePath);

		console.log(`[preview] processing ${posixRelativePath}`);
		const buffer = await readFile(absolutePath);
		const inlineFile: InlineSourceFile = {
			displayName,
			mimeType,
			data: buffer.toString('base64')
		};

		const inlineFiles = [inlineFile];
		let quiz: QuizGeneration | undefined;
		let status: 'ok' | 'error' = 'ok';
		let generationSource: GenerationSource = HAS_GEMINI_KEY && !FORCE_FIXTURES ? 'live' : 'fixture';
		let errorMessage: string | undefined;

		if (HAS_GEMINI_KEY && !FORCE_FIXTURES) {
			try {
				quiz = await generateQuiz(inlineFiles, config);
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown generation failure';
				console.warn(`[preview] live generation failed for ${posixRelativePath}: ${message}`);
				errorMessage = message;
				quiz = undefined;
			}
		}

		if (!quiz) {
			const fixture = previewFixtures[posixRelativePath];
			if (fixture) {
				quiz = QuizGenerationSchema.parse(fixture);
				generationSource = 'fixture';
				usedFixtures = true;
				console.log(`[preview] used fixture for ${posixRelativePath}`);
			} else {
				status = 'error';
				generationSource = FORCE_FIXTURES || !HAS_GEMINI_KEY ? 'fixture' : 'live';
				errorMessage =
					errorMessage ??
					(FORCE_FIXTURES || !HAS_GEMINI_KEY
						? 'Gemini key unavailable and no fixture was defined.'
						: 'Gemini generation failed and no fixture was defined.');
			}
		}

		const entryFilename = `${slug || 'sample'}.json`;
		const entryPath = path.join(OUTPUT_DIR, entryFilename);

		if (quiz) {
			const parsed = QuizGenerationSchema.parse(quiz);
			await writeFile(entryPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
		} else {
			await writeFile(
				entryPath,
				`${JSON.stringify({ error: errorMessage ?? 'Generation failed' }, null, 2)}\n`,
				'utf8'
			);
		}

		const { size } = await stat(absolutePath);
		manifestEntries.push({
			id: slug || 'sample',
			label,
			mode: quiz?.mode ?? config.mode,
			questionCount: quiz?.questionCount ?? config.questionCount,
			subject: quiz?.subject ?? config.subject,
			board: quiz?.board ?? config.board,
			generatedAt,
			generationSource,
			status,
			errorMessage,
			quizPath: entryFilename,
			sourceFiles: [
				{
					relativePath: posixRelativePath,
					displayName,
					mimeType,
					bytes: size
				}
			]
		});
	}

	const manifest: ManifestFile = {
		generatedAt,
		generator: {
			script: 'scripts/generate-admin-previews.ts',
			questionCountDefault: DEFAULT_QUESTION_COUNT,
			usedFixtures
		},
		entries: manifestEntries
	};

	const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	console.log(`[preview] wrote manifest with ${manifestEntries.length} entries.`);
	console.log(`[preview] output directory: ${path.relative(REPO_ROOT, OUTPUT_DIR)}`);
}

main().catch((error) => {
	console.error('[preview] generation failed:', error);
	process.exitCode = 1;
});
