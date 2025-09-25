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
	type QuizGeneration
} from '../src/lib/llm/schemas';
import {
	BASE_PROMPT_HEADER,
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
const REPORT_ROOT = path.join(REPO_ROOT, 'docs', 'reports');
const SAMPLE_REPORT_ROOT = path.join(REPORT_ROOT, 'sample-quizzes');

const PROMPT_FILE_PATHS = [
	'web/src/lib/server/llm/quizPrompts.ts',
	'web/src/lib/server/llm/quizGenerator.ts',
	'web/src/lib/server/llm/judge.ts'
];

const MODEL_ID = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.2;
const JUDGE_TEMPERATURE = 0.15;
const EXTENSION_QUESTION_COUNT = 10;

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
	schema: Schema;
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
			responseSchema: schema,
			temperature
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
		mode: 'extension',
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

async function judgeQuizPayload(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile,
	quiz: QuizGeneration
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

async function runSampleGeneration(client: GoogleGenAI, job: SampleJob): Promise<GenerationResult> {
	const source = await loadInlineSource(job.sourcePath);
	console.log(`   ↳ generating base quiz (${job.id})`);
	const quiz = await generateQuizPayload(client, job, source);
	console.log(`   ↳ judging base quiz (${job.id})`);
	const judge = await judgeQuizPayload(client, job, source, quiz.quiz);
	const audit = await auditJudgeDecisionPayload(
		client,
		job,
		source,
		quiz.quiz,
		judge.judge.verdict
	);
	console.log(`   ↳ generating extension (${job.id})`);
	const extension = await generateExtensionPayload(client, job, source, quiz.quiz);
	console.log(`   ↳ judging extension (${job.id})`);
	const extensionJudge = await judgeQuizPayload(client, job, source, extension.quiz);
	const extensionAudit = await auditJudgeDecisionPayload(
		client,
		job,
		source,
		extension.quiz,
		extensionJudge.judge.verdict
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
	readonly mode: SampleJob['mode'];
	readonly subject?: string;
	readonly board?: string;
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
	client: GoogleGenAI,
	jobs: SampleJob[]
): Promise<{ results: GenerationResult[]; index: SampleIndex }> {
	await rm(OUTPUT_DIR, { recursive: true, force: true });
	await mkdir(OUTPUT_DIR, { recursive: true });

	const results: GenerationResult[] = [];
	for (const job of jobs) {
		console.log(
			`[sample-quizzes] Generating ${job.id} (${job.mode}) from ${job.relativeSourcePath}...`
		);
		try {
			const result = await runSampleGeneration(client, job);
			const sampleDir = path.join(OUTPUT_DIR, job.id);
			await mkdir(sampleDir, { recursive: true });
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
			mode: result.job.mode,
			subject: result.job.subject,
			board: result.job.board,
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
		rootLines.push('');
	}

	await writeFile(path.join(REPORT_ROOT, 'sample-quizzes.md'), rootLines.join('\n'), 'utf8');
}

async function main(): Promise<void> {
	const stage = parseStageSelection();

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
		const client = new GoogleGenAI({ apiKey });
		const { index } = await runGenerationStage(client, jobs);
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
