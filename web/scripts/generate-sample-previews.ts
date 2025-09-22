import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateQuizFromSource } from '../src/lib/server/llm/quizGenerator';
import type { InlineSourceFile, QuizGeneration } from '../src/lib/server/llm/schemas';

type QuizMode = 'extraction' | 'synthesis';

type SampleFile = {
	readonly absolutePath: string;
	readonly relativePath: string;
	readonly mode: QuizMode;
};

type ManifestItem = {
	readonly id: string;
	readonly sequence: number;
	readonly mode: QuizMode;
	readonly sourceFile: string;
	readonly sourceDisplayName: string;
	readonly resultPath: string;
	readonly status: 'ok' | 'error';
	readonly questionCount?: number;
	readonly quizTitle?: string;
	readonly summary?: string;
	readonly subject?: string;
	readonly board?: string;
	readonly errorMessage?: string;
};

type PersistedQuizBase = {
	readonly sequence: number;
	readonly mode: QuizMode;
	readonly sourceFile: string;
	readonly sourceDisplayName: string;
	readonly generatedAt: string;
	readonly subjectGuess?: string;
	readonly boardGuess?: string;
};

type PersistedQuizSuccess = PersistedQuizBase & {
	readonly status: 'ok';
	readonly quiz: QuizGeneration;
};

type PersistedQuizError = PersistedQuizBase & {
	readonly status: 'error';
	readonly error: {
		readonly message: string;
		readonly stack?: string;
	};
};

type PersistedQuiz = PersistedQuizSuccess | PersistedQuizError;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');
const dataRoot = path.join(repoRoot, 'data', 'samples');
const previewRoot = path.join(webRoot, 'static', 'admin-preview');
const quizOutputRoot = path.join(previewRoot, 'quizzes');
const manifestPath = path.join(previewRoot, 'manifest.json');

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const QUESTION_COUNT_BY_MODE: Record<QuizMode, number> = {
	extraction: 6,
	synthesis: 6
};

async function listSampleFiles(): Promise<SampleFile[]> {
	const results: SampleFile[] = [];
	async function walk(currentRelative: string): Promise<void> {
		const absolute = path.join(dataRoot, currentRelative);
		const entries = await readdir(absolute, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith('.')) {
				continue;
			}
			const nextRelative = path.join(currentRelative, entry.name);
			const nextAbsolute = path.join(dataRoot, nextRelative);
			if (entry.isDirectory()) {
				await walk(nextRelative);
				continue;
			}
			const extension = path.extname(entry.name).toLowerCase();
			if (!ALLOWED_EXTENSIONS.has(extension)) {
				console.warn(`Skipping unsupported file extension for ${nextRelative}`);
				continue;
			}
			const mode = resolveMode(nextRelative);
			results.push({
				absolutePath: nextAbsolute,
				relativePath: nextRelative.replace(/\\/g, '/'),
				mode
			});
		}
	}
	await walk('');
	results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	return results;
}

function resolveMode(relativePath: string): QuizMode {
	const normalised = relativePath.replace(/\\/g, '/');
	if (normalised.includes('with-questions/')) {
		return 'extraction';
	}
	if (normalised.includes('no-questions/')) {
		return 'synthesis';
	}
	throw new Error(`Unable to determine quiz mode for ${relativePath}`);
}

function guessSubject(relativePath: string): string | undefined {
	const name = relativePath.toLowerCase();
	if (name.includes('chem')) {
		return 'chemistry';
	}
	if (name.includes('phys')) {
		return 'physics';
	}
	if (name.includes('bio') || name.includes('health') || name.includes('blood')) {
		return 'biology';
	}
	return undefined;
}

function guessBoard(relativePath: string): string | undefined {
	const name = relativePath.toLowerCase();
	if (name.includes('aqa')) {
		return 'AQA';
	}
	if (name.includes('ocr')) {
		return 'OCR';
	}
	if (name.includes('edexcel')) {
		return 'Edexcel';
	}
	return undefined;
}

async function loadInlineSource(file: SampleFile): Promise<InlineSourceFile> {
	const buffer = await readFile(file.absolutePath);
	const mimeType = detectMimeType(file.absolutePath);
	return {
		displayName: path.basename(file.absolutePath),
		mimeType,
		data: buffer.toString('base64')
	};
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

function toSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
}

function ensureSafeId(base: string, sequence: number): string {
	const slug = toSlug(base);
	const padded = sequence.toString().padStart(3, '0');
	return `${padded}-${slug}`;
}

async function ensureDataDirectories(): Promise<void> {
	const stats = await stat(dataRoot).catch(() => undefined);
	if (!stats || !stats.isDirectory()) {
		throw new Error(`Expected data directory at ${dataRoot}`);
	}
}

async function main(): Promise<void> {
	await ensureDataDirectories();
	const sampleFiles = await listSampleFiles();
	if (sampleFiles.length === 0) {
		console.warn('No sample files found. Nothing to do.');
		return;
	}

	await rm(previewRoot, { recursive: true, force: true });
	await mkdir(quizOutputRoot, { recursive: true });

	const runTimestamp = new Date().toISOString();
	const manifestItems: ManifestItem[] = [];

	for (let index = 0; index < sampleFiles.length; index += 1) {
		const sample = sampleFiles[index]!;
		const sequence = index + 1;
		const subjectGuess = guessSubject(sample.relativePath);
		const boardGuess = guessBoard(sample.relativePath);
		const questionCount = QUESTION_COUNT_BY_MODE[sample.mode];
		console.log(
			`Generating quiz for [${sequence}/${sampleFiles.length}] ${sample.relativePath} (${sample.mode})`
		);

		const id = ensureSafeId(sample.relativePath, sequence);
		const resultFileName = `${id}.json`;
		const resultPath = path.join('quizzes', resultFileName);
		const inline = await loadInlineSource(sample);

		try {
			const quiz = await generateQuizFromSource({
				mode: sample.mode,
				questionCount,
				subject: subjectGuess,
				board: boardGuess,
				sourceFiles: [inline]
			});

			const persisted: PersistedQuiz = {
				status: 'ok',
				sequence,
				mode: sample.mode,
				sourceFile: `data/samples/${sample.relativePath}`,
				sourceDisplayName: inline.displayName,
				generatedAt: runTimestamp,
				subjectGuess,
				boardGuess,
				quiz
			};
			await writeFile(
				path.join(previewRoot, resultPath),
				JSON.stringify(persisted, null, 2),
				'utf8'
			);

			manifestItems.push({
				id,
				sequence,
				mode: sample.mode,
				sourceFile: persisted.sourceFile,
				sourceDisplayName: inline.displayName,
				resultPath,
				status: 'ok',
				questionCount: quiz.questionCount,
				quizTitle: quiz.quizTitle,
				summary: quiz.summary,
				subject: quiz.subject ?? subjectGuess,
				board: quiz.board ?? boardGuess
			});

			console.log(` → Saved preview to ${resultPath}`);
		} catch (error) {
			const message =
				error instanceof Error ? error.message || 'Unknown Gemini error' : 'Unknown Gemini error';
			const stack = error instanceof Error ? error.stack : undefined;

			const persisted: PersistedQuiz = {
				status: 'error',
				sequence,
				mode: sample.mode,
				sourceFile: `data/samples/${sample.relativePath}`,
				sourceDisplayName: inline.displayName,
				generatedAt: runTimestamp,
				subjectGuess,
				boardGuess,
				error: {
					message,
					stack
				}
			};

			await writeFile(
				path.join(previewRoot, resultPath),
				JSON.stringify(persisted, null, 2),
				'utf8'
			);

			manifestItems.push({
				id,
				sequence,
				mode: sample.mode,
				sourceFile: persisted.sourceFile,
				sourceDisplayName: inline.displayName,
				resultPath,
				status: 'error',
				subject: subjectGuess,
				board: boardGuess,
				errorMessage: message
			});

			console.error(` ✖ Failed to generate preview for ${sample.relativePath}: ${message}`);
		}
	}

	const manifest = {
		generatedAt: runTimestamp,
		itemCount: manifestItems.length,
		items: manifestItems
	} satisfies {
		generatedAt: string;
		itemCount: number;
		items: ManifestItem[];
	};

	await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
	console.log(`Wrote manifest with ${manifestItems.length} entries to ${manifestPath}`);
}

main().catch((error) => {
	console.error('Failed to generate quiz previews');
	console.error(error instanceof Error ? (error.stack ?? error.message) : error);
	process.exitCode = 1;
});
