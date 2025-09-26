import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

import {
	type Part,
	type Schema,
	type GenerateContentResponseUsageMetadata,
	GenerateContentResponse
} from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import {
	JudgeAuditSchema,
	JudgeVerdictSchema,
	type InlineSourceFile,
	type JudgeAudit,
	type JudgeVerdict,
	type QuizGeneration
} from '../../../../llm/schemas';
import {
	QUIZ_RESPONSE_SCHEMA,
	buildExtensionPrompt,
	buildGenerationPrompt,
	buildSourceParts,
	parseQuizFromText,
	type GenerateQuizOptions
} from '../../quizPrompts';
import {
    DEFAULT_EXTENSION_QUESTION_COUNT,
    DEFAULT_GENERATION_QUESTION_COUNT,
    QUIZ_GENERATION_MODEL_ID
} from '../../quizGenerator';
import {
	AUDIT_RESPONSE_SCHEMA,
	JUDGE_RESPONSE_SCHEMA,
	buildAuditPrompt,
	buildJudgePrompt,
	QUIZ_EVAL_MODEL_ID
} from '../judge';
import { runGeminiCall, type GeminiModelId } from '../../../utils/gemini';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(CURRENT_DIR, '../../../../../');
const REPO_ROOT = path.resolve(WEB_ROOT, '../..');
const DATA_ROOT = path.join(REPO_ROOT, 'data', 'samples');
const OUTPUT_DIR = path.join(WEB_ROOT, 'static', 'admin', 'sample-quizzes');
const REPORT_ROOT = path.join(REPO_ROOT, 'docs', 'reports');
const SAMPLE_REPORT_ROOT = path.join(REPORT_ROOT, 'sample-quizzes');

const LOCAL_ENV_PATH = path.resolve('.env.local');
if (existsSync(LOCAL_ENV_PATH)) {
	loadEnv({ path: LOCAL_ENV_PATH });
}

const execFileAsync = promisify(execFile);

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

const PROGRESS_LOG_INTERVAL_MS = 500;

function estimateUploadBytes(parts: Part[]): number {
	return parts.reduce((total, part) => {
		if (typeof part.text === 'string') {
			total += Buffer.byteLength(part.text, 'utf8');
		}
		const inlineData = part.inlineData?.data;
		if (inlineData) {
			try {
				total += Buffer.from(inlineData, 'base64').byteLength;
			} catch (error) {
				total += inlineData.length;
			}
		}
		const fileUri = part.fileData?.fileUri;
		if (fileUri) {
			total += Buffer.byteLength(fileUri, 'utf8');
		}
		return total;
	}, 0);
}

function formatBytes(bytes: number): string {
	if (bytes === 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / Math.pow(1024, exponent);
	return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function rawPathForAttempt(basePath: string, attempt: number): string {
	const directory = path.dirname(basePath);
	const ext = path.extname(basePath);
	const baseName = path.basename(basePath, ext);
	const suffix = `.attempt${attempt}`;
	return path.join(directory, `${baseName}${suffix}${ext}`);
}

type SampleJob = {
	readonly id: string;
	readonly category: string;
	readonly displayName: string;
	readonly sourcePath: string;
	readonly relativeSourcePath: string;
	readonly questionCount: number;
	readonly subject?: string;
};

type QuizModelRun = {
	readonly modelId: string;
};

type QuizFilePayload = {
	readonly id: string;
	readonly mode: QuizGeneration['mode'];
	readonly subject?: string;
	readonly generatedAt: string;
	readonly request: {
		readonly model: string;
		readonly questionCount: number;
	};
	readonly source: {
		readonly relativePath: string;
		readonly displayName: string;
	};
	readonly prompt: string;
	readonly quiz: QuizGeneration;
	readonly model: QuizModelRun;
	readonly job: SampleJob;
};

type JudgeFilePayload = {
	readonly id: string;
	readonly evaluatedAt: string;
	readonly prompt: string;
	readonly source: {
		readonly relativePath: string;
		readonly displayName: string;
	};
	readonly job: SampleJob;
	readonly judge: {
		readonly model: QuizModelRun;
		readonly verdict: JudgeVerdict;
	};
	readonly audit?: {
		readonly model: QuizModelRun;
		readonly result: JudgeAudit;
	};
};

type GenerationResult = {
	readonly job: SampleJob;
	readonly quiz: QuizFilePayload;
	readonly judge: JudgeFilePayload;
	readonly extension: QuizFilePayload;
	readonly extensionJudge: JudgeFilePayload;
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
				const questionCount = DEFAULT_GENERATION_QUESTION_COUNT;
				jobs.push({
					id,
					category,
					displayName,
					sourcePath,
					relativeSourcePath,
					questionCount
				});
		}
	}
	jobs.sort((a, b) => a.id.localeCompare(b.id));
	return jobs;
}

async function callModel({
	model,
	schema,
	parts,
	rawFilePath,
	label
}: {
	model: GeminiModelId;
	schema: Schema;
	parts: Part[];
	rawFilePath: string;
	label: string;
}): Promise<{ text: string; modelId: string }> {
	const logPrefix = `      [${model}]`;
	const uploadBytes = estimateUploadBytes(parts);
	const maxAttempts = 3;

	let startMillis = 0;
	let firstChunkMillis = 0;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		startMillis = Date.now();
		const attemptLabel = `attempt ${attempt}/${maxAttempts}`;
		console.log(`${logPrefix}: ${label}, ${attemptLabel}, upload ≈ ${formatBytes(uploadBytes)}`);

		const { text } = await runGeminiCall(async (client) => {
			const stream = await client.models.generateContentStream({
				model,
				contents: [
					{
						role: 'user',
						parts
					}
				],
				config: {
					responseMimeType: 'application/json',
					responseSchema: schema
				}
			});

			let chunkCount = 0;
			let firstChunkLogged = false;
			let lastProgressLog = 0;
			let latestText = '';
			let lastLength = 0;
			let latestUsage: GenerateContentResponseUsageMetadata | undefined;
			let finalChunk: GenerateContentResponse | undefined;

			for await (const chunk of stream) {
				chunkCount += 1;
				finalChunk = chunk;
				const { text } = chunk;
				if (text !== undefined) {
					latestText += text;
				}
				if (chunk.usageMetadata) {
					latestUsage = chunk.usageMetadata;
				}
				if (!firstChunkLogged && latestText.length > 0) {
					firstChunkLogged = true;
					lastProgressLog = firstChunkMillis = Date.now();
					lastLength = latestText.length;
					console.log(
						`${logPrefix}: received first chunk of ${latestText.length} chars in ${Math.round((firstChunkMillis - startMillis) / 1_000)}s`
					);
					continue;
				}
				if (
					firstChunkLogged &&
					Date.now() - lastProgressLog >= PROGRESS_LOG_INTERVAL_MS &&
					latestText.length !== lastLength
				) {
					console.log(
						`${logPrefix}: streaming… ${chunkCount} chunk${chunkCount === 1 ? '' : 's'} (~${latestText.length} chars)`
					);
					lastProgressLog = Date.now();
					lastLength = latestText.length;
				}
			}

			if (!firstChunkLogged) {
				throw new Error(`${logPrefix}: stream produced no chunks`);
			}

			const finalText = latestText || finalChunk?.text || '';
			if (!finalText) {
				throw new Error(`${logPrefix}: empty response`);
			}

			const usage =
				latestUsage ??
				(finalChunk as { usageMetadata?: GenerateContentResponseUsageMetadata })?.usageMetadata;
			const elapesMillis = Date.now() - startMillis;
			const speed =
				((usage?.thoughtsTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0)) / elapesMillis;
			console.log(
				`${logPrefix}: done in ${Math.round(elapesMillis) / 1000}s, prompt tokens: ${usage?.promptTokenCount ?? 0}, thinking tokens: ${usage?.thoughtsTokenCount ?? 0}, response tokens: ${usage?.candidatesTokenCount ?? 0}, ${Math.round(speed * 1000)} t/s`
			);

			return { text: finalText, usage };
		});

		await writeFile(rawFilePath, text, 'utf8');
		const attemptPath = rawPathForAttempt(rawFilePath, attempt);
		await writeFile(attemptPath, text, 'utf8');
		console.log(`${logPrefix}: wrote ${attemptPath}.`);

		const trimmed = text.trimStart();
		if (!trimmed.startsWith('{')) {
			console.warn(
				`${logPrefix}: non-JSON response on attempt ${attempt} (first char: ${trimmed.charAt(0) || '∅'})`
			);
			throw Error('non-JSON LLM response');
		}
		try {
			JSON.parse(text);
			return { text, modelId: model };
		} catch (e) {
			console.warn(`${logPrefix}: failed to parse JSON on attempt ${attempt}`);
		}
	}

	throw new Error(`${logPrefix}: failed to produce JSON after ${maxAttempts} attempts`);
}

async function generateQuizPayload(
	job: SampleJob,
	source: InlineSourceFile,
	rawFilePath: string,
	label: string
): Promise<QuizFilePayload> {
	const options: GenerateQuizOptions = {
		questionCount: job.questionCount,
		subject: job.subject,
		sourceFiles: [source]
	};
	const prompt = buildGenerationPrompt(options);
	const parts = [{ text: prompt }, ...buildSourceParts(options.sourceFiles)];
	const { text } = await callModel({
		model: QUIZ_GENERATION_MODEL_ID,
		schema: QUIZ_RESPONSE_SCHEMA,
		parts,
		rawFilePath,
		label
	});
	const quiz = parseQuizFromText(text);
	const generatedAt = new Date().toISOString();
	return {
		id: job.id,
		mode: quiz.mode,
		subject: quiz.subject,
		generatedAt,
		request: {
			model: QUIZ_GENERATION_MODEL_ID,
			questionCount: job.questionCount
		},
		source: {
			relativePath: job.relativeSourcePath,
			displayName: job.displayName
		},
		prompt,
		quiz,
		model: {
			modelId: QUIZ_GENERATION_MODEL_ID
		},
		job
	};
}

async function generateExtensionPayload(
	job: SampleJob,
	source: InlineSourceFile,
	baseQuiz: QuizGeneration,
	rawFilePath: string,
	label: string
): Promise<QuizFilePayload> {
	const prompt = buildExtensionPrompt({
		additionalQuestionCount: DEFAULT_EXTENSION_QUESTION_COUNT,
		subject: baseQuiz.subject ?? job.subject,
	});
	const pastQuizLines = baseQuiz.questions.map(
		(question, index) => `${index + 1}. ${question.prompt}`
	);
	const pastQuizBlock = `<PAST_QUIZES>\n${pastQuizLines.join('\n')}\n</PAST_QUIZES>`;
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([source]),
		{ text: `Previous quiz prompts:\n${pastQuizBlock}` }
	];
	const { text } = await callModel({
		model: QUIZ_GENERATION_MODEL_ID,
		schema: QUIZ_RESPONSE_SCHEMA,
		parts,
		rawFilePath,
		label
	});
	let quiz = parseQuizFromText(text);
	if (quiz.questionCount !== DEFAULT_EXTENSION_QUESTION_COUNT) {
		console.warn(
			`[sample-quizzes] Extension for ${job.id} returned ${quiz.questionCount} questions; trimming to ${DEFAULT_EXTENSION_QUESTION_COUNT}.`
		);
		const trimmedQuestions = quiz.questions.slice(0, DEFAULT_EXTENSION_QUESTION_COUNT);
		quiz = {
			...quiz,
			questions: trimmedQuestions,
			questionCount: trimmedQuestions.length
		};
	}
	const generatedAt = new Date().toISOString();
	return {
		id: job.id,
		mode: quiz.mode,
		subject: quiz.subject,
		generatedAt,
		request: {
			model: QUIZ_GENERATION_MODEL_ID,
			questionCount: DEFAULT_EXTENSION_QUESTION_COUNT
		},
		source: {
			relativePath: job.relativeSourcePath,
			displayName: job.displayName
		},
		prompt,
		quiz,
		model: {
			modelId: QUIZ_GENERATION_MODEL_ID
		},
		job
	};
}

async function judgeQuizPayload(
	job: SampleJob,
	source: InlineSourceFile,
	quiz: QuizGeneration,
	rawFilePath: string,
	label: string
): Promise<JudgeFilePayload> {
	const prompt = buildJudgePrompt({
		sourceFiles: [source],
		candidateQuiz: quiz
	});
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([source]),
		{ text: `Candidate quiz JSON:\n${JSON.stringify(quiz, null, 2)}` }
	];
	const { text, modelId } = await callModel({
		model: QUIZ_EVAL_MODEL_ID,
		schema: JUDGE_RESPONSE_SCHEMA,
		parts,
		rawFilePath,
		label
	});
	const verdict = JSON.parse(text) as unknown;
	const parsedVerdict = JudgeVerdictSchema.parse(verdict);
	const evaluatedAt = new Date().toISOString();
	return {
		id: job.id,
		evaluatedAt,
		prompt,
		source: {
			relativePath: job.relativeSourcePath,
			displayName: job.displayName
		},
		job,
		judge: {
			model: {
				modelId
			},
			verdict: parsedVerdict
		}
	};
}

async function auditJudgeDecisionPayload(
	job: SampleJob,
	source: InlineSourceFile,
	quiz: QuizGeneration,
	judgeVerdict: JudgeVerdict,
	rawFilePath: string,
	label: string
): Promise<JudgeFilePayload['audit']> {
	const prompt = buildAuditPrompt();
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([source]),
		{
			text: `Judge verdict JSON:\n${JSON.stringify(judgeVerdict, null, 2)}\n\nCandidate quiz JSON:\n${JSON.stringify(
				quiz,
				null,
				2
			)}`
		}
	];
	const { text, modelId } = await callModel({
		model: QUIZ_EVAL_MODEL_ID,
		schema: AUDIT_RESPONSE_SCHEMA,
		parts,
		rawFilePath,
		label
	});
	const parsed = JSON.parse(text) as unknown;
	const result = JudgeAuditSchema.parse(parsed);
	return {
		model: {
			modelId
		},
		result
	};
}

async function runSampleGeneration(job: SampleJob, rawDir: string): Promise<GenerationResult> {
	const source = await loadInlineSource(job.sourcePath);
	const baseRawPath = path.join(rawDir, 'quiz.txt');
	const baseJudgeRawPath = path.join(rawDir, 'judge.txt');
	const baseJudgeAuditRawPath = path.join(rawDir, 'judge-audit.txt');
	const extensionRawPath = path.join(rawDir, 'extension.txt');
	const extensionJudgeRawPath = path.join(rawDir, 'extension-judge.txt');
	const extensionJudgeAuditRawPath = path.join(rawDir, 'extension-judge-audit.txt');

	console.log(`   ↳ generating base quiz (${job.id})`);
	const quiz = await generateQuizPayload(job, source, baseRawPath, `base quiz ${job.id}`);
	console.log(`   ↳ judging base quiz (${job.id})`);
	const judge = await judgeQuizPayload(
		job,
		source,
		quiz.quiz,
		baseJudgeRawPath,
		`base judgement ${job.id}`
	);
	const audit = await auditJudgeDecisionPayload(
		job,
		source,
		quiz.quiz,
		judge.judge.verdict,
		baseJudgeAuditRawPath,
		`base audit ${job.id}`
	);
	console.log(`   ↳ generating extension (${job.id})`);
	const extension = await generateExtensionPayload(
		job,
		source,
		quiz.quiz,
		extensionRawPath,
		`extension quiz ${job.id}`
	);
	console.log(`   ↳ judging extension (${job.id})`);
	const extensionJudge = await judgeQuizPayload(
		job,
		source,
		extension.quiz,
		extensionJudgeRawPath,
		`extension judgement ${job.id}`
	);
	const extensionAudit = await auditJudgeDecisionPayload(
		job,
		source,
		extension.quiz,
		extensionJudge.judge.verdict,
		extensionJudgeAuditRawPath,
		`extension audit ${job.id}`
	);
	return {
		job,
		quiz,
		judge: {
			...judge,
			audit
		},
		extension,
		extensionJudge: {
			...extensionJudge,
			audit: extensionAudit
		}
	};
}

type StageSelection = 'all' | 'generate' | 'render';

function parseStageSelection(): StageSelection {
	const stageArg = process.argv.find((value) => value.startsWith('--stage='));
	if (!stageArg) {
		return 'all';
	}
	const value = stageArg.split('=')[1]?.toLowerCase();
	if (value === 'generate' || value === 'render' || value === 'all') {
		return value;
	}
	throw new Error(`Unknown stage selection: ${value}`);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
	await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function readJson<T>(filePath: string): Promise<T> {
	const raw = await readFile(filePath, 'utf8');
	return JSON.parse(raw) as T;
}

type SampleIndexEntry = {
	readonly id: string;
	readonly label: string;
	readonly mode: QuizGeneration['mode'];
	readonly subject?: string;
	readonly questionCount: number;
	readonly request: QuizFilePayload['request'];
	readonly source: QuizFilePayload['source'];
	readonly quizTitle: string;
	readonly summary: string;
	readonly outputPath: string;
	readonly generatedAt: string;
	readonly outputs: {
		readonly quiz: string;
		readonly judge: string;
		readonly extension: string;
		readonly extensionJudge: string;
	};
	readonly extension: {
		readonly quizTitle: string;
		readonly questionCount: number;
		readonly generatedAt: string;
	};
	readonly judge: {
		readonly verdict: JudgeVerdict['verdict'];
		readonly outputPath: string;
	};
	readonly extensionJudge: {
		readonly verdict: JudgeVerdict['verdict'];
		readonly outputPath: string;
	};
};

type SampleIndex = {
	readonly generatedAt: string;
	readonly samples: SampleIndexEntry[];
};

async function runGenerationStage(
	jobs: SampleJob[]
): Promise<{ results: GenerationResult[]; index: SampleIndex }> {
	await rm(OUTPUT_DIR, { recursive: true, force: true });
	await mkdir(OUTPUT_DIR, { recursive: true });

	const results: GenerationResult[] = [];
	for (const job of jobs) {
		console.log(`[sample-quizzes] Generating ${job.id} from ${job.relativeSourcePath}...`);
		const sampleDir = path.join(OUTPUT_DIR, job.id);
		const rawDir = path.join(sampleDir, 'raw');
		await mkdir(sampleDir, { recursive: true });
		await mkdir(rawDir, { recursive: true });
		try {
			const result = await runSampleGeneration(job, rawDir);
			await writeJson(path.join(sampleDir, 'quiz.json'), result.quiz);
			await writeJson(path.join(sampleDir, 'detail.json'), result.quiz);
			await writeJson(path.join(sampleDir, 'quiz-judgement.json'), result.judge);
			await writeJson(path.join(sampleDir, 'quiz-extension.json'), result.extension);
			await writeJson(path.join(sampleDir, 'quiz-extension-judgement.json'), result.extensionJudge);
			results.push(result);
			console.log(`[sample-quizzes] Saved outputs for ${job.id}`);
		} catch (error) {
			console.error(
				`[sample-quizzes] Failed to generate quiz for ${job.id}:`,
				error instanceof Error ? error.message : error
			);
			throw error;
		}
	}

	const indexGeneratedAt = new Date().toISOString();
	const index: SampleIndex = {
		generatedAt: indexGeneratedAt,
		samples: results.map((result, indexPosition) => ({
			id: result.job.id,
			label: `Sample ${indexPosition + 1}: ${result.job.displayName}`,
			mode: result.quiz.quiz.mode,
			subject: result.quiz.quiz.subject,
			questionCount: result.quiz.quiz.questionCount,
			request: result.quiz.request,
			source: result.quiz.source,
			quizTitle: result.quiz.quiz.quizTitle,
			summary: result.quiz.quiz.summary,
			outputPath: `/admin/sample-quizzes/${result.job.id}/detail.json`,
			generatedAt: result.quiz.generatedAt,
			outputs: {
				quiz: `/admin/sample-quizzes/${result.job.id}/quiz.json`,
				judge: `/admin/sample-quizzes/${result.job.id}/quiz-judgement.json`,
				extension: `/admin/sample-quizzes/${result.job.id}/quiz-extension.json`,
				extensionJudge: `/admin/sample-quizzes/${result.job.id}/quiz-extension-judgement.json`
			},
			extension: {
				quizTitle: result.extension.quiz.quizTitle,
				questionCount: result.extension.quiz.questionCount,
				generatedAt: result.extension.generatedAt
			},
			judge: {
				verdict: result.judge.judge.verdict.verdict,
				outputPath: `/admin/sample-quizzes/${result.job.id}/quiz-judgement.json`
			},
			extensionJudge: {
				verdict: result.extensionJudge.judge.verdict.verdict,
				outputPath: `/admin/sample-quizzes/${result.job.id}/quiz-extension-judgement.json`
			}
		}))
	};

	await writeJson(path.join(OUTPUT_DIR, 'index.json'), index);
	console.log(`[sample-quizzes] Wrote index.json with ${results.length} entries.`);

	return { results, index };
}

function buildRepoFileUrl(relativeRepoPath: string, commitHash: string): string {
	const repoSlug = process.env.GITHUB_REPOSITORY ?? 'spark-ai/spark';
	const posixPath = relativeRepoPath.split(path.sep).join('/');
	return `https://github.com/${repoSlug}/blob/${commitHash}/${posixPath}`;
}

function isImageAsset(relativeRepoPath: string): boolean {
	const ext = path.extname(relativeRepoPath).toLowerCase();
	return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
}

function formatQuizMarkdown(payload: QuizFilePayload, heading: string): string {
	const lines: string[] = [];
	lines.push(`# ${heading}`);
	lines.push('');
	lines.push(`**Quiz title:** ${payload.quiz.quizTitle}`);
	lines.push(`**Summary:** ${payload.quiz.summary}`);
	lines.push('');
	lines.push('## Metadata');
	lines.push('');
	lines.push(`- Mode: ${payload.mode}`);
	if (payload.subject) {
		lines.push(`- Subject: ${payload.subject}`);
	}
	lines.push(`- Question count: ${payload.quiz.questionCount}`);
	lines.push(`- Generated at: ${payload.generatedAt}`);
	lines.push(`- Model: ${payload.model.modelId}`);
	lines.push(`- Source: ${payload.source.displayName} (${payload.source.relativePath})`);
	lines.push('');
	lines.push('## Questions');
	lines.push('');
	payload.quiz.questions.forEach((question, index) => {
		lines.push(`### ${index + 1}. ${question.prompt}`);
		lines.push('');
		lines.push(`- Type: ${question.type}`);
		if (question.topic) {
			lines.push(`- Topic: ${question.topic}`);
		}
		if (question.difficulty) {
			lines.push(`- Difficulty: ${question.difficulty}`);
		}
		if (question.skillFocus) {
			lines.push(`- Skill focus: ${question.skillFocus}`);
		}
		if (question.sourceReference) {
			lines.push(`- Source reference: ${question.sourceReference}`);
		}
		lines.push(`- Answer: ${question.answer}`);
		if (question.options && question.options.length > 0) {
			lines.push('- Options:');
			question.options.forEach((option, optionIndex) => {
				const optionLabel = String.fromCharCode(65 + optionIndex);
				lines.push(`  - ${optionLabel}. ${option}`);
			});
		}
		lines.push('');
		lines.push(`> ${question.explanation}`);
		lines.push('');
	});
	lines.push('## Prompt');
	lines.push('');
	lines.push('```');
	lines.push(payload.prompt);
	lines.push('```');
	lines.push('');
	return lines.join('\n');
}

function formatJudgeMarkdown(payload: JudgeFilePayload, heading: string): string {
	const lines: string[] = [];
	lines.push(`# ${heading}`);
	lines.push('');
	lines.push(`**Verdict:** ${payload.judge.verdict.verdict}`);
	lines.push('');
	lines.push('## Summary');
	lines.push('');
	lines.push(payload.judge.verdict.explanation);
	lines.push('');
	lines.push('## Rubric findings');
	lines.push('');
	payload.judge.verdict.rubricFindings.forEach((finding) => {
		lines.push(`- **${finding.criterion}** — score ${finding.score.toFixed(2)}`);
		lines.push(`  - ${finding.justification}`);
	});
	lines.push('');
	lines.push('## Model metadata');
	lines.push('');
	lines.push(`- Model: ${payload.judge.model.modelId}`);
	lines.push(`- Evaluated at: ${payload.evaluatedAt}`);
	lines.push(`- Source: ${payload.source.displayName} (${payload.source.relativePath})`);
	if (payload.audit) {
		lines.push('');
		lines.push('## Audit');
		lines.push('');
		lines.push(`- Model: ${payload.audit.model.modelId}`);
		lines.push(`- Verdict agreement: ${payload.audit.result.verdictAgreement}`);
		lines.push(`- Confidence: ${payload.audit.result.confidence}`);
		lines.push('');
		lines.push(payload.audit.result.explanation);
	}
	lines.push('');
	lines.push('## Prompt');
	lines.push('');
	lines.push('```');
	lines.push(payload.prompt);
	lines.push('```');
	lines.push('');
	return lines.join('\n');
}

async function getCommitHash(): Promise<string> {
	const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
	return stdout.trim();
}

function buildSampleHeading(sample: SampleIndexEntry): string {
	return `${sample.label} (${sample.mode})`;
}

function relativeStaticPath(...segments: string[]): string {
	return ['../../web/static/admin/sample-quizzes', ...segments].join('/');
}

async function renderReports(index?: SampleIndex): Promise<void> {
	const effectiveIndex =
		index ?? (await readJson<SampleIndex>(path.join(OUTPUT_DIR, 'index.json')));
	await mkdir(REPORT_ROOT, { recursive: true });
	await rm(SAMPLE_REPORT_ROOT, { recursive: true, force: true });
	await mkdir(SAMPLE_REPORT_ROOT, { recursive: true });

	const commitHash = await getCommitHash();
	const rootLines: string[] = [];
	rootLines.push('# Sample Quiz Generation Report');
	rootLines.push('');
	rootLines.push(`- Generated at: ${effectiveIndex.generatedAt}`);
	rootLines.push(`- Commit: ${commitHash}`);
	rootLines.push('- Prompts: pulled from production prompt builders at the commit above.');
	rootLines.push('');
	rootLines.push('## Samples');
	rootLines.push('');

	for (const sample of effectiveIndex.samples) {
		const sampleDir = path.join(OUTPUT_DIR, sample.id);
		const quiz = await readJson<QuizFilePayload>(path.join(sampleDir, 'quiz.json'));
		const judge = await readJson<JudgeFilePayload>(path.join(sampleDir, 'quiz-judgement.json'));
		const extension = await readJson<QuizFilePayload>(path.join(sampleDir, 'quiz-extension.json'));
		const extensionJudge = await readJson<JudgeFilePayload>(
			path.join(sampleDir, 'quiz-extension-judgement.json')
		);

		const reportSampleDir = path.join(SAMPLE_REPORT_ROOT, sample.id);
		await mkdir(reportSampleDir, { recursive: true });

		const sampleHeading = buildSampleHeading(sample);
		const baseQuizMd = formatQuizMarkdown(quiz, `${sampleHeading} — Base Quiz`);
		const baseJudgeMd = formatJudgeMarkdown(judge, `${sampleHeading} — Base Quiz Judge`);
		const extensionQuizMd = formatQuizMarkdown(extension, `${sampleHeading} — Extension Quiz`);
		const extensionJudgeMd = formatJudgeMarkdown(
			extensionJudge,
			`${sampleHeading} — Extension Judge`
		);

		await writeFile(path.join(reportSampleDir, 'quiz.md'), baseQuizMd, 'utf8');
		await writeFile(path.join(reportSampleDir, 'quiz-judgement.md'), baseJudgeMd, 'utf8');
		await writeFile(path.join(reportSampleDir, 'quiz-extension.md'), extensionQuizMd, 'utf8');
		await writeFile(
			path.join(reportSampleDir, 'quiz-extension-judgement.md'),
			extensionJudgeMd,
			'utf8'
		);

		// Write source.md with embedded image and GitHub link
		const sourceGithubUrl = buildRepoFileUrl(sample.source.relativePath, commitHash);
		const sourceImgRelative = path.posix.relative(
			`docs/reports/sample-quizzes/${sample.id}`,
			sample.source.relativePath
		);
		const sourceMdLines: string[] = [];
		sourceMdLines.push(`# ${sampleHeading} — Source`);
		sourceMdLines.push('');
		sourceMdLines.push(`File: ${sample.source.displayName}`);
		sourceMdLines.push(`GitHub: ${sourceGithubUrl}`);
		sourceMdLines.push('');
		if (isImageAsset(sample.source.relativePath)) {
			sourceMdLines.push(
				`<img src="${sourceImgRelative}" alt="${sample.source.displayName}" width="1024">`
			);
		} else {
			sourceMdLines.push(`Local: [${sample.source.displayName}](${sourceImgRelative})`);
		}
		sourceMdLines.push('');
		await writeFile(path.join(reportSampleDir, 'source.md'), sourceMdLines.join('\n'), 'utf8');

		rootLines.push(`### ${sampleHeading}`);
		rootLines.push('');
		rootLines.push(`- Source: ${sample.source.displayName} (${sample.source.relativePath})`);
		rootLines.push(`- Base quiz summary: ${sample.summary}`);
		rootLines.push(`- Base verdict: ${sample.judge.verdict}`);
		rootLines.push(`- Extension verdict: ${sample.extensionJudge.verdict}`);
		rootLines.push(
			`- Reports: [Quiz](sample-quizzes/${sample.id}/quiz.md) · [Judge](sample-quizzes/${sample.id}/quiz-judgement.md) · [10 more](sample-quizzes/${sample.id}/quiz-extension.md) · [10 more judge](sample-quizzes/${sample.id}/quiz-extension-judgement.md)`
		);
		rootLines.push(
			`- JSON: [Quiz](${relativeStaticPath(sample.id, 'quiz.json')}) · [Judge](${relativeStaticPath(
				sample.id,
				'quiz-judgement.json'
			)}) · [10 more](${relativeStaticPath(
				sample.id,
				'quiz-extension.json'
			)}) · [10 more judge](${relativeStaticPath(sample.id, 'quiz-extension-judgement.json')})`
		);
		rootLines.push(`- Image: [${sample.source.displayName}](${sourceGithubUrl})`);
		rootLines.push('');
	}

	await writeFile(path.join(REPORT_ROOT, 'sample-quizzes.md'), rootLines.join('\n'), 'utf8');
}

async function main(): Promise<void> {
	const stage = parseStageSelection();

	if (stage !== 'render') {
		const jobs = await collectJobs();
		if (jobs.length === 0) {
			console.warn('[sample-quizzes] No sample files found.');
			return;
		}
		const { index } = await runGenerationStage(jobs);
		if (stage === 'generate') {
			return;
		}
		await renderReports(index);
		return;
	}

	await renderReports();
}

main().catch((error) => {
	console.error('[sample-quizzes] Unhandled error:', error);
	process.exitCode = 1;
});
