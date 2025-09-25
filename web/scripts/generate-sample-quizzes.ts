import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { GoogleGenAI, type Part, type Schema, Type } from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import {
	JudgeAuditSchema,
	JudgeVerdictSchema,
	type InlineSourceFile,
	type JudgeAudit,
	type JudgeVerdict,
	type QuizGeneration,
	type SlopAutoSignals,
	type SlopJudgement
} from '../src/lib/llm/schemas';
import {
	BASE_PROMPT_HEADER,
	QUIZ_RESPONSE_SCHEMA,
	buildGenerationPrompt,
	buildSourceParts,
	parseQuizFromText,
	type GenerateQuizOptions
} from '../src/lib/server/llm/quizPrompts';
import {
	DEFAULT_SLOP_RISK_THRESHOLD,
	buildSlopJudgePrompt,
	computeWeightedRisk as computeSlopWeightedRisk,
	parseSlopJudgement
} from '../src/lib/slop/judge';
import { computeSlopAutoSignals } from '../src/lib/slop/metrics';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data', 'samples');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'static', 'admin', 'sample-quizzes');
const REPORT_ROOT = path.join(REPO_ROOT, 'docs', 'reports');
const SAMPLE_REPORT_ROOT = path.join(REPORT_ROOT, 'sample-quizzes');

const PROMPT_FILE_PATHS = [
	'web/src/lib/server/llm/quizPrompts.ts',
	'web/src/lib/server/llm/quizGenerator.ts',
	'web/src/lib/server/llm/judge.ts',
	'web/src/lib/slop/judge.ts'
];

const MODEL_ID = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.2;
const JUDGE_TEMPERATURE = 0.15;
const EXTENSION_QUESTION_COUNT = 10;
const SLOP_JUDGE_TEMPERATURE = 0.1;

const GENERATE_MODES = ['quiz', 'extension'] as const;
type GenerateMode = (typeof GENERATE_MODES)[number];

const JUDGE_MODES = ['quality', 'slop'] as const;
type JudgeMode = (typeof JUDGE_MODES)[number];

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

type QuizModelRun = {
	readonly modelId: string;
	readonly temperature: number;
};

const JUDGE_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		explanation: { type: Type.STRING },
		rubricFindings: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					criterion: { type: Type.STRING },
					score: { type: Type.NUMBER, minimum: 0, maximum: 1 },
					justification: { type: Type.STRING }
				},
				required: ['criterion', 'score', 'justification'],
				propertyOrdering: ['criterion', 'score', 'justification']
			}
		},
		verdict: { type: Type.STRING, enum: ['approve', 'revise'] }
	},
	required: ['explanation', 'rubricFindings', 'verdict'],
	propertyOrdering: ['explanation', 'rubricFindings', 'verdict']
};

const AUDIT_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		explanation: { type: Type.STRING },
		verdictAgreement: { type: Type.STRING, enum: ['agree', 'needs_review', 'disagree'] },
		confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] }
	},
	required: ['explanation', 'verdictAgreement', 'confidence'],
	propertyOrdering: ['explanation', 'verdictAgreement', 'confidence']
};

type QuizFilePayload = {
	readonly id: string;
	readonly mode: SampleJob['mode'];
	readonly subject?: string;
	readonly board?: string;
	readonly generatedAt: string;
	readonly request: {
		readonly model: string;
		readonly questionCount: number;
		readonly temperature: number;
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

type QualityJudgeFilePayload = {
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

type SlopJudgeFilePayload = {
	readonly id: string;
	readonly evaluatedAt: string;
	readonly prompt: string;
	readonly domain: 'news' | 'qa' | 'other';
	readonly context: string | null;
	readonly text: string;
	readonly autoSignals: SlopAutoSignals;
	readonly judgement: SlopJudgement;
	readonly model: QuizModelRun;
	readonly riskScore: number;
	readonly recommendedLabel: 0 | 1;
	readonly threshold: number;
	readonly contributions: ReturnType<typeof computeSlopWeightedRisk>['contributions'];
};

type GenerationResult = {
	readonly job: SampleJob;
	readonly quiz?: QuizFilePayload;
	readonly extension?: QuizFilePayload;
	readonly quality?: {
		readonly quiz?: QualityJudgeFilePayload;
		readonly extension?: QualityJudgeFilePayload;
	};
	readonly slop?: {
		readonly quiz?: SlopJudgeFilePayload;
		readonly extension?: SlopJudgeFilePayload;
	};
};

type JudgePromptOptions = {
	readonly rubricSummary?: string;
	readonly candidateQuiz: QuizGeneration;
	readonly sourceFiles: InlineSourceFile[];
};

type ExtendQuizOptions = {
	readonly sourceFiles: InlineSourceFile[];
	readonly baseQuiz: QuizGeneration;
	readonly additionalQuestionCount: number;
};

function buildJudgePrompt(options: JudgePromptOptions): string {
	return [
		`You are Spark's internal GCSE quiz quality judge. Review the proposed quiz objectively.`,
		'Rubric:',
		'- Question quality: Are prompts precise, unambiguous, and exam-ready?',
		'- Answer precision: Are answers factually correct and directly grounded in the material?',
		'- Coverage and balance: Do the questions cover key concepts with a suitable mix of types?',
		'- Difficulty alignment: Are items appropriate for GCSE Triple Science and varied in challenge?',
		'- Safety & tone: Avoid misinformation, harmful or off-spec content.',
		options.rubricSummary
			? `Additional notes: ${options.rubricSummary}`
			: 'Use the GCSE Triple Science context and ensure UK English spelling.',
		'Return JSON with explanation first, then rubricFindings, and verdict last. Explanation must cite rubric dimensions.',
		'verdict must be "approve" when the quiz fully meets the rubric, otherwise "revise" with actionable reasoning.',
		'Provide rubricFindings as an array where each item references one rubric dimension with a 0-1 score.'
	]
		.filter(Boolean)
		.join('\n');
}

function buildAuditPrompt(): string {
	return [
		`You are Spark's senior reviewer using gemini-2.5-pro to audit another model's judgement.`,
		'Assess whether the judge verdict is reasonable given the quiz and rubric. Focus on factual accuracy and rubric fit.',
		'Return JSON with explanation first, then verdictAgreement, then confidence.',
		'If the verdict is defensible and reasoning is sound, respond with verdictAgreement="agree".',
		'Use "needs_review" when the judge raised valid concerns but missed some nuance. Use "disagree" only if the verdict is demonstrably wrong.'
	].join('\n');
}

function buildExtensionPrompt(options: ExtendQuizOptions): string {
	return [
		BASE_PROMPT_HEADER,
		'The learner already received an initial quiz, provided below as JSON. They now want additional questions.',
		'Requirements:',
		`- Produce exactly ${options.additionalQuestionCount} new questions.`,
		'- Avoid duplicating any prompt ideas, answer wording, or explanation themes present in the base quiz.',
		'- Continue to ground every item strictly in the supplied material.',
		'- Highlight fresh angles or subtopics that were underrepresented previously.',
		'- Multiple choice responses must include four options labelled A, B, C, and D.',
		'- Difficulty must be mapped to foundation, intermediate, or higher for every question.',
		'Return JSON following the schema. Set mode to "extension" and update questionCount accordingly.',
		'Do not restate the previous questions in the response. Only include the new items.'
	].join('\n');
}

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

async function callModel<T>({
	client,
	model,
	schema,
	parts,
	temperature
}: {
	client: GoogleGenAI;
	model: string;
	schema?: Schema;
	parts: Part[];
	temperature: number;
}): Promise<{ text: string; modelId: string }> {
	const response = await client.models.generateContent({
		model,
		contents: [
			{
				role: 'user',
				parts
			}
		],
		config: {
			responseMimeType: 'application/json',
			temperature,
			...(schema ? { responseSchema: schema } : {})
		}
	});
	const text = response.text;
	if (!text) {
		throw new Error(`Gemini ${model} returned an empty response`);
	}
	return { text, modelId: model };
}

async function generateQuizPayload(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile
): Promise<QuizFilePayload> {
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
	const { text } = await callModel({
		client,
		model: MODEL_ID,
		schema: QUIZ_RESPONSE_SCHEMA,
		parts,
		temperature: options.temperature ?? DEFAULT_TEMPERATURE
	});
	const quiz = parseQuizFromText(text);
	const generatedAt = new Date().toISOString();
	return {
		id: job.id,
		mode: job.mode,
		subject: job.subject,
		board: job.board,
		generatedAt,
		request: {
			model: MODEL_ID,
			questionCount: job.questionCount,
			temperature: options.temperature ?? DEFAULT_TEMPERATURE
		},
		source: {
			relativePath: job.relativeSourcePath,
			displayName: job.displayName
		},
		prompt,
		quiz,
		model: {
			modelId: MODEL_ID,
			temperature: options.temperature ?? DEFAULT_TEMPERATURE
		},
		job
	};
}

async function generateExtensionPayload(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile,
	baseQuiz: QuizGeneration
): Promise<QuizFilePayload> {
	const prompt = buildExtensionPrompt({
		sourceFiles: [source],
		baseQuiz,
		additionalQuestionCount: EXTENSION_QUESTION_COUNT
	});
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([source]),
		{ text: `Existing quiz JSON:\n${JSON.stringify(baseQuiz, null, 2)}` }
	];
	const { text } = await callModel({
		client,
		model: MODEL_ID,
		schema: QUIZ_RESPONSE_SCHEMA,
		parts,
		temperature: DEFAULT_TEMPERATURE
	});
	let quiz = parseQuizFromText(text);
	if (quiz.questionCount !== EXTENSION_QUESTION_COUNT) {
		console.warn(
			`[sample-quizzes] Extension for ${job.id} returned ${quiz.questionCount} questions; trimming to ${EXTENSION_QUESTION_COUNT}.`
		);
		const trimmedQuestions = quiz.questions.slice(0, EXTENSION_QUESTION_COUNT);
		quiz = {
			...quiz,
			questions: trimmedQuestions,
			questionCount: trimmedQuestions.length
		};
	}
	const generatedAt = new Date().toISOString();
	return {
		id: job.id,
		mode: job.mode,
		subject: job.subject,
		board: job.board,
		generatedAt,
		request: {
			model: MODEL_ID,
			questionCount: EXTENSION_QUESTION_COUNT,
			temperature: DEFAULT_TEMPERATURE
		},
		source: {
			relativePath: job.relativeSourcePath,
			displayName: job.displayName
		},
		prompt,
		quiz,
		model: {
			modelId: MODEL_ID,
			temperature: DEFAULT_TEMPERATURE
		},
		job
	};
}

function serialiseQuizForSlop(quiz: QuizGeneration): string {
	const lines: string[] = [];
	lines.push(`Quiz title: ${quiz.quizTitle}`);
	lines.push(`Summary: ${quiz.summary}`);
	lines.push(`Mode: ${quiz.mode}`);
	if (quiz.subject) {
		lines.push(`Subject: ${quiz.subject}`);
	}
	if (quiz.board) {
		lines.push(`Board: ${quiz.board}`);
	}
	lines.push(`Question count: ${quiz.questionCount}`);
	lines.push('');
	quiz.questions.forEach((question, index) => {
		lines.push(`Q${index + 1}: ${question.prompt}`);
		if (question.topic) {
			lines.push(`Topic: ${question.topic}`);
		}
		if (question.difficulty) {
			lines.push(`Difficulty: ${question.difficulty}`);
		}
		if (question.skillFocus) {
			lines.push(`Skill focus: ${question.skillFocus}`);
		}
		lines.push(`Answer: ${question.answer}`);
		if (question.options && question.options.length > 0) {
			lines.push('Options:');
			question.options.forEach((option, optionIndex) => {
				const label = String.fromCharCode(65 + optionIndex);
				lines.push(`- ${label}. ${option}`);
			});
		}
		lines.push(`Explanation: ${question.explanation}`);
		if (question.sourceReference) {
			lines.push(`Source reference: ${question.sourceReference}`);
		}
		lines.push('');
	});
	return lines.join('\n');
}

async function slopJudgeQuizPayload(
	client: GoogleGenAI,
	job: SampleJob,
	quiz: QuizGeneration,
	variant: 'quiz' | 'extension'
): Promise<SlopJudgeFilePayload> {
	const text = serialiseQuizForSlop(quiz);
	const autoSignals = computeSlopAutoSignals(text);
	const prompt = buildSlopJudgePrompt({
		domain: 'qa',
		text,
		context: quiz.summary,
		autoSignals,
		requestId: `${job.id}-${variant}-slop`
	});
	const parts: Part[] = [{ text: prompt }];
	const { text: responseText, modelId } = await callModel({
		client,
		model: 'gemini-2.5-pro',
		schema: undefined,
		parts,
		temperature: SLOP_JUDGE_TEMPERATURE
	});
	let parsed: SlopJudgement;
	try {
		parsed = parseSlopJudgement(responseText);
	} catch (error) {
		console.error('Invalid slop judgement payload', {
			responseText,
			error
		});
		throw error;
	}
	const { riskScore, contributions } = computeSlopWeightedRisk(parsed, 'qa');
	const evaluatedAt = new Date().toISOString();
	const recommendedLabel: 0 | 1 = riskScore >= DEFAULT_SLOP_RISK_THRESHOLD ? 1 : 0;
	return {
		id: job.id,
		evaluatedAt,
		prompt,
		domain: 'qa',
		context: quiz.summary ?? null,
		text,
		autoSignals,
		judgement: parsed,
		model: {
			modelId,
			temperature: SLOP_JUDGE_TEMPERATURE
		},
		riskScore: Number(riskScore.toFixed(4)),
		recommendedLabel,
		threshold: DEFAULT_SLOP_RISK_THRESHOLD,
		contributions
	};
}

async function judgeQuizPayload(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile,
	quiz: QuizGeneration
): Promise<QualityJudgeFilePayload> {
	const prompt = buildJudgePrompt({
		sourceFiles: [source],
		candidateQuiz: quiz
	});
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([source]),
		{ text: `Candidate quiz JSON:\n${JSON.stringify(quiz, null, 2)}` }
	];
	const models: string[] = ['gemini-2.5-flash', 'gemini-2.5-pro'];
	let lastError: unknown;
	for (const model of models) {
		try {
			const { text, modelId } = await callModel({
				client,
				model,
				schema: JUDGE_RESPONSE_SCHEMA,
				parts,
				temperature: JUDGE_TEMPERATURE
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
						modelId,
						temperature: JUDGE_TEMPERATURE
					},
					verdict: parsedVerdict
				}
			};
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`Unable to judge quiz for ${job.id}`);
}

async function auditJudgeDecisionPayload(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile,
	quiz: QuizGeneration,
	judgeVerdict: JudgeVerdict
): Promise<QualityJudgeFilePayload['audit']> {
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
		client,
		model: 'gemini-2.5-pro',
		schema: AUDIT_RESPONSE_SCHEMA,
		parts,
		temperature: JUDGE_TEMPERATURE
	});
	const parsed = JSON.parse(text) as unknown;
	const result = JudgeAuditSchema.parse(parsed);
	return {
		model: {
			modelId,
			temperature: JUDGE_TEMPERATURE
		},
		result
	};
}

async function runSampleGeneration(
	client: GoogleGenAI,
	job: SampleJob,
	generateModes: Set<GenerateMode>,
	judgeModes: Set<JudgeMode>
): Promise<GenerationResult> {
	if (generateModes.has('extension') && !generateModes.has('quiz')) {
		throw new Error(
			'Extension generation requires base quiz generation. Include "quiz" in --generate.'
		);
	}

	const source = await loadInlineSource(job.sourcePath);
	const result: GenerationResult = { job };

	if (generateModes.has('quiz')) {
		console.log(`   ↳ generating base quiz (${job.id})`);
		const quiz = await generateQuizPayload(client, job, source);
		result.quiz = quiz;

		if (judgeModes.has('quality')) {
			console.log(`   ↳ judging base quiz (${job.id})`);
			const judge = await judgeQuizPayload(client, job, source, quiz.quiz);
			const audit = await auditJudgeDecisionPayload(
				client,
				job,
				source,
				quiz.quiz,
				judge.judge.verdict
			);
			result.quality = {
				...(result.quality ?? {}),
				quiz: {
					...judge,
					audit
				}
			};
		}

		if (judgeModes.has('slop')) {
			console.log(`   ↳ slop detection (base quiz ${job.id})`);
			const slop = await slopJudgeQuizPayload(client, job, quiz.quiz, 'quiz');
			result.slop = {
				...(result.slop ?? {}),
				quiz: slop
			};
		}

		if (generateModes.has('extension')) {
			console.log(`   ↳ generating extension (${job.id})`);
			const extension = await generateExtensionPayload(client, job, source, quiz.quiz);
			result.extension = extension;

			if (judgeModes.has('quality')) {
				console.log(`   ↳ judging extension (${job.id})`);
				const extensionJudge = await judgeQuizPayload(client, job, source, extension.quiz);
				const extensionAudit = await auditJudgeDecisionPayload(
					client,
					job,
					source,
					extension.quiz,
					extensionJudge.judge.verdict
				);
				result.quality = {
					...(result.quality ?? {}),
					extension: {
						...extensionJudge,
						audit: extensionAudit
					}
				};
			}

			if (judgeModes.has('slop')) {
				console.log(`   ↳ slop detection (extension ${job.id})`);
				const extensionSlop = await slopJudgeQuizPayload(client, job, extension.quiz, 'extension');
				result.slop = {
					...(result.slop ?? {}),
					extension: extensionSlop
				};
			}
		}
	}

	return result;
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

function parseModeArg<T extends string>(
	prefix: string,
	allowed: readonly T[],
	defaults: readonly T[]
): Set<T> {
	const arg = process.argv.find((value) => value.startsWith(prefix));
	if (!arg) {
		return new Set(defaults);
	}
	const raw = arg.split('=')[1]?.trim();
	if (!raw) {
		return new Set();
	}
	const values = raw
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	if (values.length === 0) {
		return new Set();
	}
	const allowedSet = new Set(allowed);
	const result = new Set<T>();
	for (const value of values) {
		if (!allowedSet.has(value as T)) {
			throw new Error(`Unknown option for ${prefix.slice(2, -1)}: ${value}`);
		}
		result.add(value as T);
	}
	return result;
}

function parseGenerateModes(): Set<GenerateMode> {
	return parseModeArg('--generate=', GENERATE_MODES, GENERATE_MODES);
}

function parseJudgeModes(): Set<JudgeMode> {
	return parseModeArg('--judges=', JUDGE_MODES, ['quality']);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
	await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function readJson<T>(filePath: string): Promise<T> {
	const raw = await readFile(filePath, 'utf8');
	return JSON.parse(raw) as T;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
	try {
		return await readJson<T>(filePath);
	} catch (error) {
		if (
			error instanceof Error &&
			'code' in error &&
			(error as { code?: string }).code === 'ENOENT'
		) {
			return null;
		}
		throw error;
	}
}

type SampleIndexEntry = {
	readonly id: string;
	readonly label: string;
	readonly mode: SampleJob['mode'];
	readonly subject?: string;
	readonly board?: string;
	readonly questionCount?: number;
	readonly request?: QuizFilePayload['request'];
	readonly source: QuizFilePayload['source'];
	readonly quizTitle?: string;
	readonly summary?: string;
	readonly outputPath?: string;
	readonly generatedAt?: string;
	readonly outputs: {
		readonly quiz?: string;
		readonly qualityJudge?: string;
		readonly slop?: string;
		readonly extension?: string;
		readonly extensionQualityJudge?: string;
		readonly extensionSlop?: string;
	};
	readonly extension?: {
		readonly quizTitle: string;
		readonly questionCount: number;
		readonly generatedAt: string;
	} | null;
	readonly quality?: {
		readonly baseVerdict?: JudgeVerdict['verdict'];
		readonly extensionVerdict?: JudgeVerdict['verdict'];
	};
	readonly slop?: {
		readonly base?: { readonly label: 0 | 1; readonly riskScore: number };
		readonly extension?: { readonly label: 0 | 1; readonly riskScore: number };
	};
};

type SampleIndex = {
	readonly generatedAt: string;
	readonly samples: SampleIndexEntry[];
};

async function runGenerationStage(
	client: GoogleGenAI,
	jobs: SampleJob[],
	generateModes: Set<GenerateMode>,
	judgeModes: Set<JudgeMode>
): Promise<{ results: GenerationResult[]; index: SampleIndex }> {
	await rm(OUTPUT_DIR, { recursive: true, force: true });
	await mkdir(OUTPUT_DIR, { recursive: true });

	const results: GenerationResult[] = [];
	for (const job of jobs) {
		console.log(
			`[sample-quizzes] Generating ${job.id} (${job.mode}) from ${job.relativeSourcePath}...`
		);
		try {
			const result = await runSampleGeneration(client, job, generateModes, judgeModes);
			const sampleDir = path.join(OUTPUT_DIR, job.id);
			await mkdir(sampleDir, { recursive: true });
			if (result.quiz) {
				await writeJson(path.join(sampleDir, 'quiz.json'), result.quiz);
				await writeJson(path.join(sampleDir, 'detail.json'), result.quiz);
			}
			if (result.quality?.quiz) {
				await writeJson(path.join(sampleDir, 'quiz-judgement.json'), result.quality.quiz);
			}
			if (result.slop?.quiz) {
				await writeJson(path.join(sampleDir, 'quiz-slop.json'), result.slop.quiz);
			}
			if (result.extension) {
				await writeJson(path.join(sampleDir, 'quiz-extension.json'), result.extension);
			}
			if (result.quality?.extension) {
				await writeJson(
					path.join(sampleDir, 'quiz-extension-judgement.json'),
					result.quality.extension
				);
			}
			if (result.slop?.extension) {
				await writeJson(path.join(sampleDir, 'quiz-extension-slop.json'), result.slop.extension);
			}
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
			mode: result.job.mode,
			subject: result.job.subject,
			board: result.job.board,
			questionCount: result.quiz?.quiz.questionCount,
			request: result.quiz?.request,
			source: result.quiz?.source ?? {
				relativePath: result.job.relativeSourcePath,
				displayName: result.job.displayName
			},
			quizTitle: result.quiz?.quiz.quizTitle,
			summary: result.quiz?.quiz.summary,
			outputPath: result.quiz ? `/admin/sample-quizzes/${result.job.id}/detail.json` : undefined,
			generatedAt: result.quiz?.generatedAt,
			outputs: {
				quiz: result.quiz ? `/admin/sample-quizzes/${result.job.id}/quiz.json` : undefined,
				qualityJudge: result.quality?.quiz
					? `/admin/sample-quizzes/${result.job.id}/quiz-judgement.json`
					: undefined,
				slop: result.slop?.quiz
					? `/admin/sample-quizzes/${result.job.id}/quiz-slop.json`
					: undefined,
				extension: result.extension
					? `/admin/sample-quizzes/${result.job.id}/quiz-extension.json`
					: undefined,
				extensionQualityJudge: result.quality?.extension
					? `/admin/sample-quizzes/${result.job.id}/quiz-extension-judgement.json`
					: undefined,
				extensionSlop: result.slop?.extension
					? `/admin/sample-quizzes/${result.job.id}/quiz-extension-slop.json`
					: undefined
			},
			extension: result.extension
				? {
						quizTitle: result.extension.quiz.quizTitle,
						questionCount: result.extension.quiz.questionCount,
						generatedAt: result.extension.generatedAt
					}
				: null,
			quality: result.quality
				? {
						baseVerdict: result.quality.quiz?.judge.verdict.verdict,
						extensionVerdict: result.quality.extension?.judge.verdict.verdict
					}
				: undefined,
			slop: result.slop
				? {
						base: result.slop.quiz
							? {
									label: result.slop.quiz.recommendedLabel,
									riskScore: result.slop.quiz.riskScore
								}
							: undefined,
						extension: result.slop.extension
							? {
									label: result.slop.extension.recommendedLabel,
									riskScore: result.slop.extension.riskScore
								}
							: undefined
					}
				: undefined
		}))
	};

	await writeJson(path.join(OUTPUT_DIR, 'index.json'), index);
	console.log(`[sample-quizzes] Wrote index.json with ${results.length} entries.`);

	return { results, index };
}

function buildPromptLinks(commitHash: string): Array<{ label: string; url: string }> {
	const repoSlug = process.env.GITHUB_REPOSITORY ?? 'spark-ai/spark';
	return PROMPT_FILE_PATHS.map((relativePath) => {
		const posixPath = relativePath.split(path.sep).join('/');
		return {
			label: relativePath,
			url: `https://github.com/${repoSlug}/blob/${commitHash}/${posixPath}`
		};
	});
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
	if (payload.board) {
		lines.push(`- Exam board: ${payload.board}`);
	}
	lines.push(`- Question count: ${payload.quiz.questionCount}`);
	lines.push(`- Generated at: ${payload.generatedAt}`);
	lines.push(
		`- Model: ${payload.model.modelId} (temperature ${payload.model.temperature.toFixed(2)})`
	);
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

function formatJudgeMarkdown(payload: QualityJudgeFilePayload, heading: string): string {
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
	lines.push(
		`- Model: ${payload.judge.model.modelId} (temperature ${payload.judge.model.temperature.toFixed(2)})`
	);
	lines.push(`- Evaluated at: ${payload.evaluatedAt}`);
	lines.push(`- Source: ${payload.source.displayName} (${payload.source.relativePath})`);
	if (payload.audit) {
		lines.push('');
		lines.push('## Audit');
		lines.push('');
		lines.push(
			`- Model: ${payload.audit.model.modelId} (temperature ${payload.audit.model.temperature.toFixed(2)})`
		);
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

function formatSlopMarkdown(payload: SlopJudgeFilePayload, heading: string): string {
	const lines: string[] = [];
	lines.push(`# ${heading}`);
	lines.push('');
	lines.push(`**Model risk label:** ${payload.recommendedLabel === 1 ? 'slop' : 'clean'}`);
	lines.push(
		`**Weighted risk:** ${payload.riskScore.toFixed(3)} (threshold ${payload.threshold.toFixed(2)})`
	);
	lines.push(
		`**Model confidence:** ${payload.judgement.overall_slop.confidence.toFixed(2)} (${payload.judgement.overall_slop.label === 1 ? 'LLM flagged slop' : 'LLM marked clean'})`
	);
	lines.push(`**Annoyance rating:** ${payload.judgement.annoyance}/5`);
	lines.push('');
	lines.push('## Top fixes');
	lines.push('');
	if (payload.judgement.top_fixes.length === 0) {
		lines.push('- (none reported)');
	} else {
		payload.judgement.top_fixes.forEach((fix) => {
			lines.push(`- ${fix}`);
		});
	}
	lines.push('');
	lines.push('## Axis scores');
	lines.push('');
	payload.judgement.axes.forEach((axis) => {
		lines.push(`- **${axis.code}** — score ${axis.score_0_to_4.toFixed(1)}`);
		lines.push(`  - ${axis.rationale}`);
		if (axis.spans.length > 0) {
			lines.push('  - Spans:');
			axis.spans.forEach((span) => {
				lines.push(`    - [${span.char_start}, ${span.char_end}) “${span.quote.trim()}”`);
			});
		}
	});
	lines.push('');
	lines.push('## Auto signals');
	lines.push('');
	Object.entries(payload.autoSignals).forEach(([key, value]) => {
		lines.push(`- ${key}: ${value}`);
	});
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
	const promptLinks = buildPromptLinks(commitHash);
	const rootLines: string[] = [];
	rootLines.push('# Sample Quiz Generation Report');
	rootLines.push('');
	rootLines.push(`- Generated at: ${effectiveIndex.generatedAt}`);
	rootLines.push(`- Commit: ${commitHash}`);
	rootLines.push('- Prompt sources:');
	promptLinks.forEach((link) => {
		rootLines.push(`  - [${link.label}](${link.url})`);
	});
	rootLines.push('');
	rootLines.push('## Samples');
	rootLines.push('');

	for (const sample of effectiveIndex.samples) {
		const sampleDir = path.join(OUTPUT_DIR, sample.id);
		const quiz = sample.outputs.quiz
			? await readJsonIfExists<QuizFilePayload>(path.join(sampleDir, 'quiz.json'))
			: null;
		const quality = sample.outputs.qualityJudge
			? await readJsonIfExists<QualityJudgeFilePayload>(path.join(sampleDir, 'quiz-judgement.json'))
			: null;
		const slop = sample.outputs.slop
			? await readJsonIfExists<SlopJudgeFilePayload>(path.join(sampleDir, 'quiz-slop.json'))
			: null;
		const extension = sample.outputs.extension
			? await readJsonIfExists<QuizFilePayload>(path.join(sampleDir, 'quiz-extension.json'))
			: null;
		const extensionQuality = sample.outputs.extensionQualityJudge
			? await readJsonIfExists<QualityJudgeFilePayload>(
					path.join(sampleDir, 'quiz-extension-judgement.json')
				)
			: null;
		const extensionSlop = sample.outputs.extensionSlop
			? await readJsonIfExists<SlopJudgeFilePayload>(
					path.join(sampleDir, 'quiz-extension-slop.json')
				)
			: null;

		const reportSampleDir = path.join(SAMPLE_REPORT_ROOT, sample.id);
		await mkdir(reportSampleDir, { recursive: true });

		const sampleHeading = buildSampleHeading(sample);
		if (quiz) {
			await writeFile(
				path.join(reportSampleDir, 'quiz.md'),
				formatQuizMarkdown(quiz, `${sampleHeading} — Base Quiz`),
				'utf8'
			);
		}
		if (quality) {
			await writeFile(
				path.join(reportSampleDir, 'quiz-judgement.md'),
				formatJudgeMarkdown(quality, `${sampleHeading} — Base Quiz Judge`),
				'utf8'
			);
		}
		if (slop) {
			await writeFile(
				path.join(reportSampleDir, 'quiz-slop.md'),
				formatSlopMarkdown(slop, `${sampleHeading} — Base Quiz Slop Detection`),
				'utf8'
			);
		}
		if (extension) {
			await writeFile(
				path.join(reportSampleDir, 'quiz-extension.md'),
				formatQuizMarkdown(extension, `${sampleHeading} — Extension Quiz`),
				'utf8'
			);
		}
		if (extensionQuality) {
			await writeFile(
				path.join(reportSampleDir, 'quiz-extension-judgement.md'),
				formatJudgeMarkdown(extensionQuality, `${sampleHeading} — Extension Quality Judge`),
				'utf8'
			);
		}
		if (extensionSlop) {
			await writeFile(
				path.join(reportSampleDir, 'quiz-extension-slop.md'),
				formatSlopMarkdown(extensionSlop, `${sampleHeading} — Extension Slop Detection`),
				'utf8'
			);
		}

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
		if (sample.summary) {
			rootLines.push(`- Base quiz summary: ${sample.summary}`);
		}
		if (sample.quality?.baseVerdict) {
			rootLines.push(`- Quality verdict: ${sample.quality.baseVerdict}`);
		}
		if (sample.slop?.base) {
			rootLines.push(
				`- Slop risk: ${sample.slop.base.riskScore.toFixed(3)} (${sample.slop.base.label === 1 ? 'flagged' : 'clean'})`
			);
		}
		if (sample.extension) {
			rootLines.push(
				`- Extension: ${sample.extension.questionCount} questions (generated ${sample.extension.generatedAt})`
			);
		}
		if (sample.quality?.extensionVerdict) {
			rootLines.push(`- Extension quality verdict: ${sample.quality.extensionVerdict}`);
		}
		if (sample.slop?.extension) {
			rootLines.push(
				`- Extension slop risk: ${sample.slop.extension.riskScore.toFixed(3)} (${sample.slop.extension.label === 1 ? 'flagged' : 'clean'})`
			);
		}

		const reportLinks: string[] = [];
		if (quiz) {
			reportLinks.push(`[Quiz](sample-quizzes/${sample.id}/quiz.md)`);
		}
		if (quality) {
			reportLinks.push(`[Quality judge](sample-quizzes/${sample.id}/quiz-judgement.md)`);
		}
		if (slop) {
			reportLinks.push(`[Slop](sample-quizzes/${sample.id}/quiz-slop.md)`);
		}
		if (extension) {
			reportLinks.push(`[Extension quiz](sample-quizzes/${sample.id}/quiz-extension.md)`);
		}
		if (extensionQuality) {
			reportLinks.push(
				`[Extension judge](sample-quizzes/${sample.id}/quiz-extension-judgement.md)`
			);
		}
		if (extensionSlop) {
			reportLinks.push(`[Extension slop](sample-quizzes/${sample.id}/quiz-extension-slop.md)`);
		}
		if (reportLinks.length > 0) {
			rootLines.push(`- Reports: ${reportLinks.join(' · ')}`);
		}

		const jsonLinks: string[] = [];
		if (quiz) {
			jsonLinks.push(`[Quiz](${relativeStaticPath(sample.id, 'quiz.json')})`);
		}
		if (quality) {
			jsonLinks.push(`[Quality judge](${relativeStaticPath(sample.id, 'quiz-judgement.json')})`);
		}
		if (slop) {
			jsonLinks.push(`[Slop](${relativeStaticPath(sample.id, 'quiz-slop.json')})`);
		}
		if (extension) {
			jsonLinks.push(`[Extension](${relativeStaticPath(sample.id, 'quiz-extension.json')})`);
		}
		if (extensionQuality) {
			jsonLinks.push(
				`[Extension judge](${relativeStaticPath(sample.id, 'quiz-extension-judgement.json')})`
			);
		}
		if (extensionSlop) {
			jsonLinks.push(
				`[Extension slop](${relativeStaticPath(sample.id, 'quiz-extension-slop.json')})`
			);
		}
		if (jsonLinks.length > 0) {
			rootLines.push(`- JSON: ${jsonLinks.join(' · ')}`);
		}

		rootLines.push(`- Image: [${sample.source.displayName}](${sourceGithubUrl})`);
		rootLines.push('');
	}

	await writeFile(path.join(REPORT_ROOT, 'sample-quizzes.md'), rootLines.join('\n'), 'utf8');
}

async function main(): Promise<void> {
	const stage = parseStageSelection();
	const generateModes = parseGenerateModes();
	const judgeModes = parseJudgeModes();

	if (stage !== 'render') {
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
		if (generateModes.size === 0) {
			console.error('[sample-quizzes] No generation modes selected.');
			process.exitCode = 1;
			return;
		}
		const client = new GoogleGenAI({ apiKey });
		const { index } = await runGenerationStage(client, jobs, generateModes, judgeModes);
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
