#!/usr/bin/env tsx

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, mkdir, copyFile, rm, symlink, writeFile } from 'node:fs/promises';

import { Type, type Schema, type Part, type GenerateContentResponse } from '@google/genai';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

import { runGeminiCall } from '../../../utils/gemini';
import {
	runJobsWithConcurrency,
	type JobProgressReporter,
	type ModelCallHandle
} from './concurrency';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(CURRENT_DIR, '../../../../../../');
const REPO_ROOT = resolve(WEB_ROOT, '../');

const DEFAULT_SRC_DIR = join(REPO_ROOT, 'spark-data', 'downloads');
const DEFAULT_DST_DIR = join(REPO_ROOT, 'spark-data', 'samples-organized');

const LOCAL_ENV_PATH = resolve('.env.local');
if (existsSync(LOCAL_ENV_PATH)) {
	loadEnv({ path: LOCAL_ENV_PATH });
}

const GEMINI_MODEL_ID = 'gemini-flash-lite-latest';
const MAX_CONCURRENCY = 256;
const CACHE_FILE_NAME = 'classification-cache.json';
const ERROR_LOG_FILE_NAME = 'classification-errors.log';
// Gemini (see SPEC) only accepts PDFs and raster images, keep the allowlist tight.
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const GRADE_BUCKETS = ['foundation', 'intermediate', 'higher', 'mixed'] as const;

const PAGE_BUCKETS = [
	'1page',
	'up-to-4pages',
	'up-to-10pages',
	'up-to-20pages',
	'up-to-50pages',
	'50plus'
] as const;

const EXAM_BOARDS = [
	'AQA',
	'OCR',
	'Edexcel',
	'Pearson',
	'Cambridge',
	'WJEC',
	'Eduqas',
	'CCEA',
	'general'
] as const;

const MATERIAL_TYPES = ['study', 'revision', 'test', 'other'] as const;

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
const DEFAULT_CONFIDENCE: (typeof CONFIDENCE_LEVELS)[number] = 'medium';

const CONFIDENCE_SYNONYMS: Record<string, (typeof CONFIDENCE_LEVELS)[number]> = {
	high: 'high',
	'highly confident': 'high',
	'very high': 'high',
	strong: 'high',
	certain: 'high',
	confident: 'high',
	assured: 'high',
	medium: 'medium',
	moderate: 'medium',
	average: 'medium',
	balanced: 'medium',
	steady: 'medium',
	low: 'low',
	'fairly low': 'low',
	weak: 'low',
	uncertain: 'low',
	unsure: 'low',
	doubtful: 'low',
	unknown: 'low',
	limited: 'low',
	minimal: 'low'
};

function normaliseConfidenceInput(value: unknown): unknown {
	if (value === undefined || value === null) {
		return DEFAULT_CONFIDENCE;
	}
	if (typeof value !== 'string') {
		return DEFAULT_CONFIDENCE;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return DEFAULT_CONFIDENCE;
	}
	const canonicalWhitespace = trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
	const lower = canonicalWhitespace.toLowerCase();
	const stripped = lower
		.replace(/\bconfidence(?:\s+level)?\b/g, '')
		.replace(/\blevel\b/g, '')
		.replace(/\bscore\b/g, '')
		.replace(/:+$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	const direct = CONFIDENCE_SYNONYMS[stripped];
	if (direct) {
		return direct;
	}
	const tokens = stripped.split(' ').filter(Boolean);
	for (let i = 0; i < tokens.length; i += 1) {
		const solo = tokens[i];
		const duo = tokens[i + 1] ? `${solo} ${tokens[i + 1]}` : undefined;
		if (duo) {
			const duoMatch = CONFIDENCE_SYNONYMS[duo];
			if (duoMatch) {
				return duoMatch;
			}
		}
		const tokenMatch = CONFIDENCE_SYNONYMS[solo];
		if (tokenMatch) {
			return tokenMatch;
		}
	}
	if (stripped && CONFIDENCE_LEVELS.includes(stripped as (typeof CONFIDENCE_LEVELS)[number])) {
		return stripped;
	}
	return DEFAULT_CONFIDENCE;
}

const ConfidenceSchema = z.preprocess(normaliseConfidenceInput, z.enum(CONFIDENCE_LEVELS));

const CLASSIFICATION_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		pageBucket: { type: Type.STRING, enum: [...PAGE_BUCKETS] },
		pageCountEstimate: { type: Type.INTEGER, minimum: 1 },
		examBoard: { type: Type.STRING, enum: [...EXAM_BOARDS] },
		gradeBucket: { type: Type.STRING, enum: [...GRADE_BUCKETS] },
		materialType: { type: Type.STRING, enum: [...MATERIAL_TYPES] },
		summary: { type: Type.STRING },
		rationale: { type: Type.STRING },
		confidence: { type: Type.STRING, enum: [...CONFIDENCE_LEVELS] },
		tags: {
			type: Type.ARRAY,
			items: { type: Type.STRING },
			description: 'Optional short keywords that describe the material.'
		},
		shortName: {
			type: Type.STRING,
			description:
				'Lowercase slug beginning with subject, then topic keywords separated by hyphens.'
		}
	},
	required: [
		'pageBucket',
		'examBoard',
		'summary',
		'rationale',
		'gradeBucket',
		'materialType',
		'confidence',
		'shortName'
	],
	propertyOrdering: [
		'pageBucket',
		'pageCountEstimate',
		'examBoard',
		'summary',
		'rationale',
		'gradeBucket',
		'materialType',
		'confidence',
		'tags',
		'shortName'
	]
};

const ClassificationSchema = z.object({
	pageBucket: z.enum(PAGE_BUCKETS),
	pageCountEstimate: z.number().int().positive().optional(),
	examBoard: z.enum(EXAM_BOARDS),
	gradeBucket: z.enum(GRADE_BUCKETS),
	materialType: z.enum(MATERIAL_TYPES),
	summary: z.string().min(1),
	rationale: z.string().min(1),
	confidence: ConfidenceSchema,
	tags: z.array(z.string().min(1)).optional(),
	shortName: z
		.string()
		.min(3)
		.transform((value) => value.trim().toLowerCase())
		.refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), {
			message: 'shortName must be lowercase slug with letters/numbers separated by hyphens'
		})
});

type Classification = z.infer<typeof ClassificationSchema>;

type PlacementMode = 'link' | 'copy' | 'move';

type CliOptions = {
	src: string;
	dst: string;
	mode: PlacementMode;
	dryRun: boolean;
	concurrency: number;
	retryFailed: boolean;
};

type SampleFile = {
	sourcePath: string;
	relativePath: string;
	name: string;
	ext: string;
	sizeBytes: number;
};

type ClassifiedSample = {
	file: SampleFile;
	classification: Classification;
};

type CacheEntry = {
	classification: Classification;
	modelId?: string;
	updatedAt?: string;
};

type CacheData = Record<string, CacheEntry>;

type JobResult = {
	file: SampleFile;
	classification?: Classification;
	modelId?: string;
	error?: unknown;
};

const CacheEntrySchema = z.object({
	classification: ClassificationSchema,
	modelId: z.string().optional(),
	updatedAt: z.string().optional()
});

const CacheSchema = z.record(z.string(), CacheEntrySchema);

function parseArgs(): CliOptions {
	const args = process.argv.slice(2);
	let src = DEFAULT_SRC_DIR;
	let dst = DEFAULT_DST_DIR;
	let mode: PlacementMode = 'link';
	let dryRun = false;
	let concurrency = MAX_CONCURRENCY;
	let retryFailed = false;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === '--src' && args[i + 1]) {
			src = resolve(args[i + 1]);
			i += 1;
			continue;
		}
		if (arg === '--dst' && args[i + 1]) {
			dst = resolve(args[i + 1]);
			i += 1;
			continue;
		}
		if (arg === '--mode' && args[i + 1]) {
			const candidate = args[i + 1] as PlacementMode;
			if (!['link', 'copy', 'move'].includes(candidate)) {
				throw new Error(`Unsupported mode: ${candidate}`);
			}
			mode = candidate;
			i += 1;
			continue;
		}
		if (arg === '--dry-run') {
			dryRun = true;
			continue;
		}
		if (arg === '--retry-failed') {
			retryFailed = true;
			continue;
		}
		if (arg === '--concurrency' && args[i + 1]) {
			const value = Number(args[i + 1]);
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error(`Invalid concurrency value: ${args[i + 1]}`);
			}
			concurrency = Math.min(MAX_CONCURRENCY, Math.floor(value));
			i += 1;
			continue;
		}
	}

	return { src, dst, mode, dryRun, concurrency, retryFailed };
}

async function collectSampleFiles(root: string): Promise<SampleFile[]> {
	const entries: SampleFile[] = [];
	async function walk(current: string): Promise<void> {
		const dirEntries = await readdir(current, { withFileTypes: true });
		for (const entry of dirEntries) {
			if (entry.name.startsWith('.')) {
				continue;
			}
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			const stats = await stat(fullPath);
			if (!stats.isFile()) {
				continue;
			}
			const rel = fullPath.substring(root.length + 1);
			const ext = extname(entry.name).toLowerCase();
			if (!SUPPORTED_EXTENSIONS.has(ext)) {
				console.warn(`[collect] Skipping unsupported extension ${ext || '(none)'}: ${rel}`);
				continue;
			}
			entries.push({
				sourcePath: fullPath,
				relativePath: rel,
				name: entry.name,
				ext,
				sizeBytes: stats.size
			});
		}
	}
	await walk(root);
	return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function buildPrompt(file: SampleFile): string {
	const lines = [
		"You are cataloguing Spark's GCSE science study materials for evaluation coverage.",
		'Review the metadata below plus the attached file, then classify the resource using the schema.',
		'',
		`File name: ${file.name}`,
		`Relative path: ${file.relativePath}`,
		`File extension: ${file.ext || 'unknown'}`,
		`File size: ${(file.sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
		'Detected page count: unknown — inspect the attached file and estimate when needed.',
		'Page bucket options: 1page | up-to-4pages | up-to-10pages | up-to-20pages | up-to-50pages | 50plus',
		'Exam board options: AQA | OCR | Edexcel | Pearson | Cambridge | WJEC | Eduqas | CCEA | general',
		'Grade bucket options (choose one, no "unknown"): foundation | intermediate | higher | mixed',
		'Material type options: study | revision | test | other',
		'',
		'Guidance:',
		'- study: textbooks, detailed notes, teaching guides, handbooks, resource packs, practical instructions.',
		'- revision: condensed summaries, knowledge organisers, checklists, flashcards.',
		'- test: exam papers, specimen assessments, question banks, mark schemes, worksheet question sets.',
		'- other: admin sheets, timetables, templates, lists, or anything unsuitable for quiz generation.',
		'- Prefer specific boards when evidence exists; otherwise use general.',
		'- Estimate the page count by inspecting the attachment so you can choose the correct bucket.',
		'- Provide a concise summary (1-2 sentences) focusing on subject coverage.',
		'- Explain your reasoning in the rationale field.',
		'- Always return your best-guess gradeBucket even if evidence is sparse—choose the closest match.',
		'- Produce shortName as a lowercase slug that begins with the subject and then key topic words (e.g., "physics-electricity-circuits"). Use hyphens only, no spaces or file extensions.',
		'',
		'The original document is attached to this prompt. Inspect it directly when deciding the board, grade intensity, and naming.',
		'Return JSON that matches the schema exactly.'
	];
	return lines.join('\n');
}

function detectMimeType(ext: string): string {
	switch (ext) {
		case '.pdf':
			return 'application/pdf';
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.png':
			return 'image/png';
		default:
			return 'application/octet-stream';
	}
}

function buildFilePart(file: SampleFile, buffer: Buffer): Part {
	return {
		inlineData: {
			data: buffer.toString('base64'),
			mimeType: detectMimeType(file.ext)
		}
	};
}

function estimateUploadBytes(parts: Part[]): number {
	return parts.reduce((total, part) => {
		let increment = 0;
		if (typeof part.text === 'string') {
			increment += Buffer.byteLength(part.text, 'utf8');
		}
		const inlineData = part.inlineData?.data;
		if (inlineData) {
			try {
				increment += Buffer.from(inlineData, 'base64').byteLength;
			} catch {
				increment += inlineData.length;
			}
		}
		return total + increment;
	}, 0);
}

async function callGeminiJson({
	parts,
	label,
	progress
}: {
	parts: Part[];
	label: string;
	progress: JobProgressReporter;
}): Promise<{ text: string; modelId: string }> {
	const uploadBytes = estimateUploadBytes(parts);
	return runGeminiCall(async (client) => {
		const callHandle: ModelCallHandle = progress.startModelCall({
			modelId: GEMINI_MODEL_ID,
			uploadBytes
		});
		try {
			const stream = await client.models.generateContentStream({
				model: GEMINI_MODEL_ID,
				contents: [
					{
						role: 'user',
						parts
					}
				],
				config: {
					responseMimeType: 'application/json',
					responseSchema: CLASSIFICATION_SCHEMA
				}
			});
			let latestText = '';
			let lastPromptTokens = 0;
			let lastInferenceTokens = 0;
			let modelId = GEMINI_MODEL_ID;
			let finalChunk: GenerateContentResponse | undefined;
			for await (const chunk of stream) {
				if (chunk.modelVersion) {
					modelId = chunk.modelVersion;
				}
				if (chunk.candidates) {
					for (const candidate of chunk.candidates) {
						const contentParts = candidate.content?.parts ?? [];
						for (const part of contentParts) {
							if (part.thought || !part.text) {
								continue;
							}
							latestText += part.text;
							progress.reportChars(part.text.length);
						}
					}
				} else if (chunk.text) {
					latestText += chunk.text;
					progress.reportChars(chunk.text.length);
				}
				finalChunk = chunk;
				const usage = chunk.usageMetadata;
				if (usage) {
					const promptTokens = usage.promptTokenCount ?? 0;
					const inferenceTokens =
						(usage.thoughtsTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0);
					const promptDelta = Math.max(0, promptTokens - lastPromptTokens);
					const inferenceDelta = Math.max(0, inferenceTokens - lastInferenceTokens);
					if (promptDelta > 0 || inferenceDelta > 0) {
						progress.recordModelUsage(callHandle, {
							promptTokensDelta: promptDelta,
							inferenceTokensDelta: inferenceDelta,
							timestamp: Date.now()
						});
					}
					lastPromptTokens = promptTokens;
					lastInferenceTokens = inferenceTokens;
				}
			}
			const fallbackText = finalChunk?.text ?? '';
			const finalText = latestText || fallbackText;
			if (!finalText) {
				throw new Error(`[${label}] Empty response from Gemini`);
			}
			return { text: finalText, modelId };
		} finally {
			progress.finishModelCall(callHandle);
		}
	});
}

async function loadCache(cachePath: string): Promise<CacheData> {
	try {
		const raw = await readFile(cachePath, 'utf8');
		if (!raw.trim()) {
			return {};
		}
		const parsed = JSON.parse(raw);
		const validated = CacheSchema.parse(parsed);
		const result: CacheData = {};
		for (const [rel, entry] of Object.entries(validated)) {
			result[rel] = {
				classification: normaliseClassification(entry.classification),
				modelId: entry.modelId,
				updatedAt: entry.updatedAt
			};
		}
		return result;
	} catch (error: unknown) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === 'ENOENT') {
			return {};
		}
		console.warn(`[cache] Failed to load ${cachePath}:`, error);
		return {};
	}
}

async function writeCache(cachePath: string, data: CacheData): Promise<void> {
	const payload = `${JSON.stringify(data, null, 2)}\n`;
	await writeFile(cachePath, payload, 'utf8');
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

function buildValidationErrorMessage({
	issues,
	payload,
	rawText,
	label
}: {
	issues: z.ZodIssue[];
	payload: unknown;
	rawText: string;
	label: string;
}): string {
	const issueLines = issues.map((issue) => {
		const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '(root)';
		const value = formatValueForError(getValueAtPath(payload, issue.path));
		const received = value === undefined ? '' : ` (received ${value})`;
		return `${pathLabel}: ${issue.message}${received}`;
	});
	const payloadJson = safeStringify(payload, 2);
	const rawTextSection = rawText && rawText.trim() && rawText.trim() !== payloadJson.trim()
		? `\nRaw response text:\n${rawText}`
		: '';
	return `Validation failed for ${label}:\n${issueLines.join('\n')}\nPayload:\n${payloadJson}${rawTextSection}`;
}

function safeStringify(value: unknown, spacing = 2): string {
	try {
		return JSON.stringify(value, null, spacing);
	} catch {
		return String(value);
	}
}

function getValueAtPath(payload: unknown, path: (string | number)[]): unknown {
	let current: unknown = payload;
	for (const segment of path) {
		if (current === null || typeof current !== 'object') {
			return undefined;
		}
		if (Array.isArray(current)) {
			const index = typeof segment === 'number' ? segment : Number.parseInt(String(segment), 10);
			if (!Number.isFinite(index) || index < 0 || index >= current.length) {
				return undefined;
			}
			current = current[index];
			continue;
		}
		const key = String(segment);
		if (!(key in (current as Record<string, unknown>))) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function formatValueForError(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === null) {
		return 'null';
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		const clipped = trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
		return JSON.stringify(clipped);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	const json = safeStringify(value);
	return json.length > 200 ? `${json.slice(0, 197)}...` : json;
}

async function classifyBatch({
	files,
	options,
	cacheData,
	scheduleCacheWrite
}: {
	files: SampleFile[];
	options: CliOptions;
	cacheData: CacheData;
	scheduleCacheWrite: () => void;
}): Promise<JobResult[]> {
	if (files.length === 0) {
		return [];
	}
	return runJobsWithConcurrency<SampleFile, JobResult>({
		items: files,
		concurrency: Math.min(options.concurrency, MAX_CONCURRENCY),
		getId: (item) => item.relativePath,
		handler: async (file, context) => {
			const prompt = buildPrompt(file);
			try {
				const buffer = await readFile(file.sourcePath);
				const parts: Part[] = [{ text: prompt }, buildFilePart(file, buffer)];
				const { text, modelId } = await callGeminiJson({
					parts,
					label: file.relativePath,
					progress: context.progress
				});
				let parsed: unknown;
				try {
					parsed = JSON.parse(text);
				} catch (error) {
					throw new Error(
						`Failed to parse JSON for ${file.relativePath}: ${(error as Error).message}\n${text}`
					);
				}
				const validation = ClassificationSchema.safeParse(parsed);
				if (!validation.success) {
					throw new Error(
						buildValidationErrorMessage({
							issues: validation.error.issues,
							payload: parsed,
							rawText: text,
							label: file.relativePath
						})
					);
				}
				const classification = normaliseClassification(validation.data);
				if (!options.dryRun) {
					cacheData[file.relativePath] = {
						classification,
						modelId,
						updatedAt: new Date().toISOString()
					};
					scheduleCacheWrite();
				}
				return { file, classification, modelId } satisfies JobResult;
			} catch (error) {
				const message = formatError(error);
				context.progress.log(`Failed ${file.relativePath}: ${message}`);
				return { file, error };
			}
		},
		label: 'Classify',
		updateIntervalMs: 750
	});
}

function normaliseClassification(value: Classification): Classification {
	return {
		...value,
		examBoard: value.examBoard,
		gradeBucket: value.gradeBucket,
		materialType: value.materialType,
		pageBucket: value.pageBucket,
		shortName: value.shortName
	};
}

function bucketToPath(bucket: Classification['pageBucket']): string {
	return bucket;
}

function boardToPath(board: Classification['examBoard']): string {
	return board;
}

function gradeToPath(grade: Classification['gradeBucket']): string {
	return grade;
}

function typeToPath(materialType: Classification['materialType']): string {
	return materialType;
}

function buildTargetFileName(shortName: string, ext: string): string {
	const extension = ext && ext.startsWith('.') ? ext : ext ? `.${ext}` : '';
	return `${shortName}${extension}`;
}

async function placeFile({
	file,
	classification,
	options
}: {
	file: SampleFile;
	classification: Classification;
	options: CliOptions;
}): Promise<{ placedPath: string } | undefined> {
	const bucketDir = bucketToPath(classification.pageBucket);
	const boardDir = boardToPath(classification.examBoard);
	const gradeDir = gradeToPath(classification.gradeBucket);
	const typeDir = typeToPath(classification.materialType);
	const targetDir = join(options.dst, bucketDir, boardDir, gradeDir, typeDir);
	const desiredName = buildTargetFileName(classification.shortName, file.ext);
	const destination = await ensureUniquePath(
		targetDir,
		desiredName,
		file.relativePath,
		!options.dryRun
	);
	if (options.dryRun) {
		return { placedPath: destination };
	}
	await mkdir(targetDir, { recursive: true });
	await rmIfExists(destination);
	switch (options.mode) {
		case 'link': {
			const relPath = relative(dirname(destination), file.sourcePath);
			await symlink(relPath, destination);
			break;
		}
		case 'copy': {
			await copyFile(file.sourcePath, destination);
			break;
		}
		case 'move': {
			await copyFile(file.sourcePath, destination);
			await rm(file.sourcePath);
			break;
		}
	}
	return { placedPath: destination };
}

async function rmIfExists(target: string): Promise<void> {
	try {
		await rm(target, { force: true });
	} catch (error: unknown) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code !== 'ENOENT') {
			throw error;
		}
	}
}

async function ensureUniquePath(
	dir: string,
	baseName: string,
	rel: string,
	createDirs: boolean
): Promise<string> {
	if (createDirs) {
		await mkdir(dir, { recursive: true });
	}
	let candidate = join(dir, baseName);
	if (!(await pathExists(candidate))) {
		return candidate;
	}
	const { name, ext } = splitName(baseName);
	const hash = makeHash(rel).slice(0, 8);
	candidate = join(dir, `${name}-${hash}${ext}`);
	return candidate;
}

function splitName(fileName: string): { name: string; ext: string } {
	const idx = fileName.lastIndexOf('.');
	if (idx <= 0) {
		return { name: fileName, ext: '' };
	}
	return { name: fileName.slice(0, idx), ext: fileName.slice(idx) };
}

function makeHash(input: string): string {
	return Buffer.from(input)
		.toString('base64url')
		.replace(/[^a-zA-Z0-9]+/g, '')
		.slice(0, 16);
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function writeIndex(classified: ClassifiedSample[], outputDir: string): Promise<void> {
	const header = [
		'original',
		'rel',
		'pageBucket',
		'examBoard',
		'gradeBucket',
		'materialType',
		'summary',
		'confidence',
		'pageCountEstimate',
		'shortName'
	];
	const rows = classified.map((entry) => {
		const { file, classification } = entry;
		return [
			csvEscape(file.sourcePath),
			csvEscape(file.relativePath),
			csvEscape(classification.pageBucket),
			csvEscape(classification.examBoard),
			csvEscape(classification.gradeBucket),
			csvEscape(classification.materialType),
			csvEscape(classification.summary),
			csvEscape(classification.confidence),
			csvEscape(
				classification.pageCountEstimate !== undefined
					? String(classification.pageCountEstimate)
					: ''
			),
			csvEscape(classification.shortName)
		].join(',');
	});
	const content = `${header.join(',')}\n${rows.join('\n')}\n`;
	await mkdir(outputDir, { recursive: true });
	await writeFile(join(outputDir, '_index.csv'), content, 'utf8');
}

function csvEscape(value: string): string {
	const safe = value.replace(/"/g, '""');
	return `"${safe}"`;
}

function incrementCount(map: Map<string, number>, key: string): void {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function formatCountEntries(map: Map<string, number>): [string, number][] {
	return Array.from(map.entries()).sort((a, b) => {
		const diff = b[1] - a[1];
		return diff !== 0 ? diff : a[0].localeCompare(b[0]);
	});
}

function printCountSection({ label, map }: { label: string; map: Map<string, number> }): void {
	if (map.size === 0) {
		console.log(`  - ${label}: none`);
		return;
	}
	console.log(`  - ${label}:`);
	for (const [key, count] of formatCountEntries(map)) {
		console.log(`    ${key}: ${count}`);
	}
}

async function main(): Promise<void> {
	const options = parseArgs();
	if (!existsSync(options.src)) {
		throw new Error(`Source directory not found: ${options.src}`);
	}
	await mkdir(options.dst, { recursive: true });
	const files = await collectSampleFiles(options.src);
	if (files.length === 0) {
		console.log('No files found to classify.');
		return;
	}
	const cachePath = join(options.src, CACHE_FILE_NAME);
	const errorLogPath = join(options.src, ERROR_LOG_FILE_NAME);
	const cacheData = await loadCache(cachePath);
	const alreadyClassified: ClassifiedSample[] = [];
	const pending: SampleFile[] = [];

	for (const file of files) {
		const cached = cacheData[file.relativePath];
		if (!cached) {
			pending.push(file);
			continue;
		}
		try {
			const classification = normaliseClassification(cached.classification);
			alreadyClassified.push({ file, classification });
		} catch (error) {
			console.warn(`[cache] Discarding invalid cache entry for ${file.relativePath}:`, error);
			delete cacheData[file.relativePath];
			pending.push(file);
		}
	}

	let cacheWriteChain: Promise<void> = Promise.resolve();
	const scheduleCacheWrite = (): void => {
		const snapshot = JSON.parse(JSON.stringify(cacheData)) as CacheData;
		cacheWriteChain = cacheWriteChain
			.then(() => writeCache(cachePath, snapshot))
			.catch((error) => {
				console.error(`[cache] Failed to write ${cachePath}:`, error);
			});
	};

	const newlyClassified: ClassifiedSample[] = [];
	const failures: JobResult[] = [];
	const accumulate = (results: JobResult[]): void => {
		for (const result of results) {
			if (result.classification) {
				newlyClassified.push({
					file: result.file,
					classification: result.classification
				});
			}
			if (result.error) {
				failures.push(result);
			}
		}
	};

	const initialResults = await classifyBatch({
		files: pending,
		options,
		cacheData,
		scheduleCacheWrite
	});
	accumulate(initialResults);

	let retriedCount = 0;
	let retrySuccessCount = 0;
	if (options.retryFailed && failures.length > 0) {
		const retryTargets = failures.map((result) => result.file);
		retriedCount = retryTargets.length;
		console.log(`Retrying ${retriedCount} failed file${retriedCount === 1 ? '' : 's'}...`);
		failures.length = 0;
		const retryResults = await classifyBatch({
			files: retryTargets,
			options,
			cacheData,
			scheduleCacheWrite
		});
		retrySuccessCount = retryResults.filter((result) => result.classification).length;
		accumulate(retryResults);
	}

	if (!options.dryRun) {
		await cacheWriteChain;
	}

	const allClassified = [...alreadyClassified, ...newlyClassified];

	const boardCounts = new Map<string, number>();
	const gradeCounts = new Map<string, number>();
	const materialCounts = new Map<string, number>();
	const pageBucketCounts = new Map<string, number>();

	for (const entry of allClassified) {
		const { classification } = entry;
		incrementCount(boardCounts, boardToPath(classification.examBoard));
		incrementCount(gradeCounts, gradeToPath(classification.gradeBucket));
		incrementCount(materialCounts, typeToPath(classification.materialType));
		incrementCount(pageBucketCounts, bucketToPath(classification.pageBucket));
	}

	const placed: ClassifiedSample[] = [];
	for (const entry of allClassified) {
		const placement = await placeFile({
			file: entry.file,
			classification: entry.classification,
			options
		});
		if (placement) {
			placed.push(entry);
		}
	}

	if (!options.dryRun) {
		await cacheWriteChain;
	}
	await writeIndex(placed, options.dst);

	const cachedCount = alreadyClassified.length;
	const newCount = newlyClassified.length;
	console.log(
		`\nProcessed ${placed.length} files (cached ${cachedCount}, new ${newCount}). Output directory: ${options.dst}`
	);
	if (!options.dryRun && (cachedCount > 0 || newCount > 0)) {
		console.log(`Cache file: ${cachePath}`);
	}
	if (options.dryRun) {
		console.log('Dry run mode: no filesystem changes were made and cache was not updated.');
	}
	if (allClassified.length > 0) {
		console.log(`Category breakdown (${allClassified.length} classified files):`);
		printCountSection({ label: 'Boards', map: boardCounts });
		printCountSection({ label: 'Grade buckets', map: gradeCounts });
		printCountSection({ label: 'Material types', map: materialCounts });
		printCountSection({ label: 'Page buckets', map: pageBucketCounts });
	}
	if (retriedCount > 0) {
		console.log(
			`Retry completed: ${retriedCount} attempted, ${retrySuccessCount} succeeded on retry.`
		);
	}
	if (failures.length > 0) {
		let errorLogWritten = false;
		const logLines = failures
			.map(
				(failure) =>
					`[${new Date().toISOString()}] ${failure.file.relativePath}: ${formatError(
						failure.error
					)}`
				)
			.join('\n');
		if (!options.dryRun) {
			await writeFile(errorLogPath, `${logLines}\n`, 'utf8');
			errorLogWritten = true;
		}
		const destinationNote = errorLogWritten
			? `Details written to ${errorLogPath}.`
			: `Details would be written to ${errorLogPath} (dry run).`;
		console.warn(
			`Skipped ${failures.length} files due to classification errors. ${destinationNote}`
		);
	}
}

void main().catch((error) => {
	console.error('Classification failed:', error);
	process.exit(1);
});
