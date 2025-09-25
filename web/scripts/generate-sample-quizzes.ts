import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { GoogleGenAI, Type, type Part, type Schema } from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import {
	type InlineSourceFile,
	type JudgeVerdict,
	type QuizGeneration
} from '../src/lib/llm/schemas';
import { JudgeVerdictSchema } from '../src/lib/llm/schemas';
import {
	BASE_PROMPT_HEADER,
	QUIZ_RESPONSE_SCHEMA,
	buildGenerationPrompt,
	buildSourceParts,
	parseQuizFromText,
	type GenerateQuizOptions
} from '../src/lib/server/llm/quizPrompts';

const execFileAsync = promisify(execFile);

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data', 'samples');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'static', 'admin', 'sample-quizzes');
const REPORTS_DIR = path.join(REPO_ROOT, 'docs', 'reports');

const MODEL_ID = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.2;
const TEN_MORE_QUESTION_COUNT = 10;

const QUIZ_FILE_NAME = 'quiz.json';
const QUIZ_JUDGE_FILE_NAME = 'quiz-judge.json';
const TEN_MORE_QUIZ_FILE_NAME = 'ten-more-quiz.json';
const TEN_MORE_JUDGE_FILE_NAME = 'ten-more-judge.json';
const MANIFEST_FILE_NAME = 'manifest.json';

const JUDGE_MODELS: readonly string[] = ['gemini-2.5-flash', 'gemini-2.5-pro'];

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

type StageSelection = {
	readonly generate: boolean;
	readonly render: boolean;
};

type CategoryConfig = Omit<GenerateQuizOptions, 'sourceFiles'>;

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

type QuizFilePayload = {
	readonly id: string;
	readonly mode: 'extraction' | 'synthesis';
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
};

type TenMoreQuizPayload = {
	readonly id: string;
	readonly variant: 'ten-more';
	readonly mode: 'extension';
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
	readonly baseQuizPath: string;
	readonly quiz: QuizGeneration;
};

type JudgeFilePayload = {
	readonly id: string;
	readonly variant: 'primary' | 'ten-more';
	readonly model: string;
	readonly evaluatedAt: string;
	readonly prompt: string;
	readonly source: {
		readonly relativePath: string;
		readonly displayName: string;
	};
	readonly quizPath: string;
	readonly verdict: JudgeVerdict;
};

type SampleManifest = {
	readonly id: string;
	readonly label: string;
	readonly category: string;
	readonly mode: 'extraction' | 'synthesis';
	readonly subject?: string;
	readonly board?: string;
	readonly questionCount: number;
	readonly tenMoreQuestionCount: number;
	readonly source: {
		readonly relativePath: string;
		readonly displayName: string;
	};
	readonly files: {
		readonly quiz: string;
		readonly quizJudge: string;
		readonly tenMoreQuiz: string;
		readonly tenMoreJudge: string;
		readonly report: string;
	};
};

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

type GeneratedQuiz = {
	readonly quiz: QuizGeneration;
	readonly prompt: string;
	readonly generatedAt: string;
};

type GeneratedJudge = {
	readonly verdict: JudgeVerdict;
	readonly prompt: string;
	readonly evaluatedAt: string;
	readonly modelUsed: string;
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

function buildJudgePrompt(options: { readonly rubricSummary?: string }): string {
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

function buildExtensionPrompt(additionalQuestionCount: number): string {
	return [
		BASE_PROMPT_HEADER,
		'The learner already received an initial quiz, provided below as JSON. They now want additional questions.',
		'Requirements:',
		`- Produce exactly ${additionalQuestionCount} new questions.`,
		'- Avoid duplicating any prompt ideas, answer wording, or explanation themes present in the base quiz.',
		'- Continue to ground every item strictly in the supplied material.',
		'- Highlight fresh angles or subtopics that were underrepresented previously.',
		'- Multiple choice responses must include four options labelled A, B, C, and D.',
		'- Difficulty must be mapped to foundation, intermediate, or higher for every question.',
		'Return JSON following the schema. Set mode to "extension" and update questionCount accordingly.',
		'Do not restate the previous questions in the response. Only include the new items.'
	].join('\n');
}

function parseStageSelection(): StageSelection {
	const stageArg = process.argv.find((value) => value.startsWith('--stage='));
	const stageValue = stageArg ? stageArg.split('=')[1] : 'all';
	switch (stageValue) {
		case 'generate':
			return { generate: true, render: false };
		case 'render':
			return { generate: false, render: true };
		case 'all':
			return { generate: true, render: true };
		default:
			throw new Error(`Unknown --stage value: ${stageValue}`);
	}
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

async function generateQuiz(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile
): Promise<GeneratedQuiz> {
	const options: GenerateQuizOptions = {
		mode: job.mode,
		questionCount: job.questionCount,
		subject: job.subject,
		board: job.board,
		sourceFiles: [source],
		temperature: job.temperature
	};
	const prompt = buildGenerationPrompt(options);
	const parts: Part[] = [{ text: prompt }, ...buildSourceParts(options.sourceFiles)];
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
	return {
		quiz,
		prompt,
		generatedAt: new Date().toISOString()
	};
}

async function generateTenMoreQuiz(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile,
	baseQuiz: QuizGeneration
): Promise<GeneratedQuiz> {
	const prompt = buildExtensionPrompt(TEN_MORE_QUESTION_COUNT);
	const baseQuizJson = JSON.stringify(baseQuiz, null, 2);
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([{ ...source }]),
		{
			text: `Existing quiz JSON:\n${baseQuizJson}`
		}
	];
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
			temperature: job.temperature ?? DEFAULT_TEMPERATURE
		}
	});
	const text = response.text;
	if (!text) {
		throw new Error(`Gemini returned an empty response for ten-more variant of ${job.id}`);
	}
	const quiz = parseQuizFromText(text);
	return {
		quiz,
		prompt,
		generatedAt: new Date().toISOString()
	};
}

async function judgeQuiz(
	client: GoogleGenAI,
	job: SampleJob,
	source: InlineSourceFile,
	quiz: QuizGeneration
): Promise<GeneratedJudge> {
	const prompt = buildJudgePrompt({});
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts([{ ...source }]),
		{
			text: `Candidate quiz JSON:\n${JSON.stringify(quiz, null, 2)}`
		}
	];
	let lastError: unknown;
	for (const model of JUDGE_MODELS) {
		try {
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
					responseSchema: JUDGE_RESPONSE_SCHEMA,
					temperature: 0.15
				}
			});
			const text = response.text;
			if (!text) {
				throw new Error(`Gemini ${model} returned an empty response for judge ${job.id}`);
			}
			const parsed = JSON.parse(text);
			const verdict = JudgeVerdictSchema.parse(parsed);
			return {
				verdict,
				prompt,
				evaluatedAt: new Date().toISOString(),
				modelUsed: model
			};
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`Failed to judge quiz for ${job.id}`);
}

async function writeQuizFiles({
	job,
	label,
	source,
	quizResult,
	judgeResult,
	tenMoreResult,
	tenMoreJudgeResult,
	sampleDir
}: {
	job: SampleJob;
	label: string;
	source: InlineSourceFile;
	quizResult: GeneratedQuiz;
	judgeResult: GeneratedJudge;
	tenMoreResult: GeneratedQuiz;
	tenMoreJudgeResult: GeneratedJudge;
	sampleDir: string;
}): Promise<void> {
	const quizPayload: QuizFilePayload = {
		id: job.id,
		mode: job.mode,
		subject: job.subject,
		board: job.board,
		generatedAt: quizResult.generatedAt,
		request: {
			model: MODEL_ID,
			questionCount: job.questionCount,
			temperature: job.temperature ?? DEFAULT_TEMPERATURE
		},
		source: {
			relativePath: job.relativeSourcePath,
			displayName: source.displayName
		},
		prompt: quizResult.prompt,
		quiz: quizResult.quiz
	};

	const judgePayload: JudgeFilePayload = {
		id: job.id,
		variant: 'primary',
		model: judgeResult.modelUsed,
		evaluatedAt: judgeResult.evaluatedAt,
		prompt: judgeResult.prompt,
		source: {
			relativePath: job.relativeSourcePath,
			displayName: source.displayName
		},
		quizPath: QUIZ_FILE_NAME,
		verdict: judgeResult.verdict
	};

	const tenMoreQuizPayload: TenMoreQuizPayload = {
		id: job.id,
		variant: 'ten-more',
		mode: 'extension',
		generatedAt: tenMoreResult.generatedAt,
		request: {
			model: MODEL_ID,
			questionCount: TEN_MORE_QUESTION_COUNT,
			temperature: job.temperature ?? DEFAULT_TEMPERATURE
		},
		source: {
			relativePath: job.relativeSourcePath,
			displayName: source.displayName
		},
		prompt: tenMoreResult.prompt,
		baseQuizPath: QUIZ_FILE_NAME,
		quiz: tenMoreResult.quiz
	};

	const tenMoreJudgePayload: JudgeFilePayload = {
		id: job.id,
		variant: 'ten-more',
		model: tenMoreJudgeResult.modelUsed,
		evaluatedAt: tenMoreJudgeResult.evaluatedAt,
		prompt: tenMoreJudgeResult.prompt,
		source: {
			relativePath: job.relativeSourcePath,
			displayName: source.displayName
		},
		quizPath: TEN_MORE_QUIZ_FILE_NAME,
		verdict: tenMoreJudgeResult.verdict
	};

	const manifest: SampleManifest = {
		id: job.id,
		label,
		category: job.category,
		mode: job.mode,
		subject: job.subject,
		board: job.board,
		questionCount: job.questionCount,
		tenMoreQuestionCount: TEN_MORE_QUESTION_COUNT,
		source: {
			relativePath: job.relativeSourcePath,
			displayName: source.displayName
		},
		files: {
			quiz: QUIZ_FILE_NAME,
			quizJudge: QUIZ_JUDGE_FILE_NAME,
			tenMoreQuiz: TEN_MORE_QUIZ_FILE_NAME,
			tenMoreJudge: TEN_MORE_JUDGE_FILE_NAME,
			report: 'report.md'
		}
	};

	await writeFile(
		path.join(sampleDir, QUIZ_FILE_NAME),
		JSON.stringify(quizPayload, null, 2),
		'utf8'
	);
	await writeFile(
		path.join(sampleDir, QUIZ_JUDGE_FILE_NAME),
		JSON.stringify(judgePayload, null, 2),
		'utf8'
	);
	await writeFile(
		path.join(sampleDir, TEN_MORE_QUIZ_FILE_NAME),
		JSON.stringify(tenMoreQuizPayload, null, 2),
		'utf8'
	);
	await writeFile(
		path.join(sampleDir, TEN_MORE_JUDGE_FILE_NAME),
		JSON.stringify(tenMoreJudgePayload, null, 2),
		'utf8'
	);
	await writeFile(
		path.join(sampleDir, MANIFEST_FILE_NAME),
		JSON.stringify(manifest, null, 2),
		'utf8'
	);
}

async function runGenerationStage(): Promise<void> {
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
	const indexEntries: Array<{
		readonly job: SampleJob;
		readonly label: string;
		readonly quiz: GeneratedQuiz;
	}> = [];

	for (const [index, job] of jobs.entries()) {
		const label = `Sample ${index + 1}: ${job.displayName}`;
		console.log(
			`[sample-quizzes] Generating primary quiz for ${job.id} (${job.mode}) from ${job.relativeSourcePath}...`
		);
		const sampleDir = path.join(OUTPUT_DIR, job.id);
		await mkdir(sampleDir, { recursive: true });

		const source = await loadInlineSource(job.sourcePath);
		const quizResult = await generateQuiz(client, job, source);
		console.log(`[sample-quizzes] Generated primary quiz for ${job.id}.`);

		const judgeResult = await judgeQuiz(client, job, source, quizResult.quiz);
		console.log(`[sample-quizzes] Judge verdict ready for ${job.id}.`);

		console.log(`[sample-quizzes] Generating ten-more quiz for ${job.id}...`);
		const tenMoreResult = await generateTenMoreQuiz(client, job, source, quizResult.quiz);
		console.log(`[sample-quizzes] Ten-more quiz ready for ${job.id}.`);

		const tenMoreJudgeResult = await judgeQuiz(client, job, source, tenMoreResult.quiz);
		console.log(`[sample-quizzes] Ten-more judge verdict ready for ${job.id}.`);

		await writeQuizFiles({
			job,
			label,
			source,
			quizResult,
			judgeResult,
			tenMoreResult,
			tenMoreJudgeResult,
			sampleDir
		});
		console.log(`[sample-quizzes] Saved outputs for ${job.id}.`);

		indexEntries.push({ job, label, quiz: quizResult });
	}

	const indexPayload = {
		generatedAt: indexGeneratedAt,
		samples: indexEntries.map(({ job, label, quiz }) => ({
			id: job.id,
			label,
			mode: job.mode,
			subject: job.subject,
			board: job.board,
			questionCount: quiz.quiz.questionCount,
			request: {
				model: MODEL_ID,
				questionCount: job.questionCount,
				temperature: job.temperature ?? DEFAULT_TEMPERATURE
			},
			source: {
				relativePath: job.relativeSourcePath,
				displayName: job.displayName
			},
			quizTitle: quiz.quiz.quizTitle,
			summary: quiz.quiz.summary,
			outputPath: `/admin/sample-quizzes/${job.id}/${QUIZ_FILE_NAME}`,
			generatedAt: quiz.generatedAt
		}))
	};

	await writeFile(
		path.join(OUTPUT_DIR, 'index.json'),
		JSON.stringify(indexPayload, null, 2),
		'utf8'
	);
	console.log(`[sample-quizzes] Wrote index.json with ${indexEntries.length} entries.`);
}

function formatRubricFinding(criterion: string, score: number, justification: string): string {
	const rounded = score.toFixed(2);
	const safeJustification = justification.replace(/\|/g, '\\|');
	return `  - **${criterion}** — score ${rounded}: ${safeJustification}`;
}

function formatPromptSection(title: string, prompt: string): string[] {
	return [`### ${title}`, '```text', prompt.trim(), '```', ''];
}

async function getGitHead(): Promise<string> {
	const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
	return stdout.trim();
}

function parseGitHubSlug(remote: string): string | undefined {
	const httpsMatch = /https:\/\/github.com\/(.+?)\.git$/i.exec(remote.trim());
	if (httpsMatch?.[1]) {
		return httpsMatch[1];
	}
	const sshMatch = /git@github.com:(.+?)\.git$/i.exec(remote.trim());
	if (sshMatch?.[1]) {
		return sshMatch[1];
	}
	return undefined;
}

async function getGitHubRepoSlug(): Promise<string | undefined> {
	if (process.env.GITHUB_REPOSITORY) {
		return process.env.GITHUB_REPOSITORY.trim();
	}
	try {
		const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
			cwd: REPO_ROOT
		});
		const slug = parseGitHubSlug(stdout.trim());
		if (slug) {
			return slug;
		}
	} catch (error) {
		console.warn('[sample-quizzes] Unable to determine GitHub remote:', error);
	}
	return undefined;
}

function buildGitHubLink(
	repo: string | undefined,
	commit: string,
	filePath: string
): string | undefined {
	if (!repo) {
		return undefined;
	}
	const normalisedPath = filePath.split(path.sep).join('/');
	return `https://github.com/${repo}/blob/${commit}/${normalisedPath}`;
}

function pushMultilineField(lines: string[], label: string, value: string): void {
	lines.push(`   - ${label}:`);
	const trimmed = value.trim();
	if (!trimmed) {
		lines.push('     —');
		return;
	}
	trimmed.split(/\r?\n/).forEach((line) => {
		lines.push(`     ${line}`);
	});
}

function formatQuestion(question: QuizGeneration['questions'][number], index: number): string[] {
	const lines: string[] = [];
	lines.push(`${index + 1}. **${question.prompt.trim()}**`);
	lines.push(`   - Type: \`${question.type}\``);
	if (question.topic) {
		lines.push(`   - Topic: ${question.topic}`);
	}
	if (question.difficulty) {
		lines.push(`   - Difficulty: ${question.difficulty}`);
	}
	if (question.skillFocus) {
		lines.push(`   - Skill focus: ${question.skillFocus}`);
	}
	if (question.sourceReference) {
		lines.push(`   - Source reference: ${question.sourceReference}`);
	}
	if (question.options && question.options.length > 0) {
		lines.push('   - Options:');
		question.options.forEach((option, optionIndex) => {
			const label = String.fromCharCode(65 + optionIndex);
			lines.push(`     - ${label}. ${option}`);
		});
	}
	pushMultilineField(lines, 'Answer', question.answer);
	pushMultilineField(lines, 'Explanation', question.explanation);
	lines.push('');
	return lines;
}

function formatJudgeSection(title: string, payload: JudgeFilePayload): string[] {
	const lines: string[] = [];
	lines.push(`### ${title}`);
	lines.push(`- Model: ${payload.model}`);
	lines.push(`- Evaluated at: ${payload.evaluatedAt}`);
	lines.push(`- Verdict: **${payload.verdict.verdict.toUpperCase()}**`);
	lines.push('');
	lines.push('**Explanation**');
	lines.push('');
	lines.push(payload.verdict.explanation.trim());
	lines.push('');
	lines.push('**Rubric findings**');
	for (const finding of payload.verdict.rubricFindings) {
		lines.push(formatRubricFinding(finding.criterion, finding.score, finding.justification));
	}
	lines.push('');
	lines.push('#### Judge prompt');
	lines.push('```text');
	lines.push(payload.prompt.trim());
	lines.push('```');
	lines.push('');
	return lines;
}

async function renderSampleReport({
	sampleDir,
	manifest,
	commitHash,
	githubRepo
}: {
	sampleDir: string;
	manifest: SampleManifest;
	commitHash: string;
	githubRepo: string | undefined;
}): Promise<void> {
	const readJson = async <T>(fileName: string): Promise<T> => {
		const filePath = path.join(sampleDir, fileName);
		const buffer = await readFile(filePath, 'utf8');
		return JSON.parse(buffer) as T;
	};

	const quiz = await readJson<QuizFilePayload>(manifest.files.quiz);
	const judge = await readJson<JudgeFilePayload>(manifest.files.quizJudge);
	const tenMoreQuiz = await readJson<TenMoreQuizPayload>(manifest.files.tenMoreQuiz);
	const tenMoreJudge = await readJson<JudgeFilePayload>(manifest.files.tenMoreJudge);

	const promptFiles = [
		'web/src/lib/server/llm/quizPrompts.ts',
		'web/src/lib/server/llm/quizGenerator.ts',
		'web/src/lib/server/llm/judge.ts'
	];

	const promptLines = promptFiles.map((filePath) => {
		const link = buildGitHubLink(githubRepo, commitHash, filePath);
		if (link) {
			return `- ${filePath} ([view on GitHub](${link}))`;
		}
		return `- ${filePath}`;
	});

	const lines: string[] = [];
	lines.push(`# ${manifest.label}`);
	lines.push('');
	lines.push('## Context');
	lines.push(`- Sample ID: \`${manifest.id}\``);
	lines.push(`- Category: ${manifest.category}`);
	lines.push(`- Source: ${manifest.source.displayName} (${manifest.source.relativePath})`);
	lines.push(`- Primary mode: ${manifest.mode}`);
	lines.push(`- Subject: ${manifest.subject ?? '—'}`);
	lines.push(`- Board: ${manifest.board ?? '—'}`);
	lines.push(`- Primary model: ${quiz.request.model} (temperature ${quiz.request.temperature})`);
	lines.push(
		`- Ten-more model: ${tenMoreQuiz.request.model} (temperature ${tenMoreQuiz.request.temperature})`
	);
	lines.push(`- Primary generated at: ${quiz.generatedAt}`);
	lines.push(`- Ten-more generated at: ${tenMoreQuiz.generatedAt}`);
	lines.push(`- Primary judge model: ${judge.model}`);
	lines.push(`- Ten-more judge model: ${tenMoreJudge.model}`);
	lines.push(`- Judge evaluations at: ${judge.evaluatedAt} / ${tenMoreJudge.evaluatedAt}`);
	lines.push('');
	lines.push('## Prompt references');
	lines.push(`- Prompt commit: \`${commitHash}\``);
	lines.push(...promptLines);
	lines.push('');
	lines.push('## Primary quiz set');
	lines.push('### Summary');
	lines.push(`- Quiz title: ${quiz.quiz.quizTitle}`);
	lines.push(`- Summary: ${quiz.quiz.summary}`);
	lines.push(`- Question count: ${quiz.quiz.questionCount}`);
	lines.push('');
	lines.push(...formatPromptSection('Generation prompt', quiz.prompt));
	lines.push('### Questions');
	lines.push('');
	quiz.quiz.questions.forEach((question, index) => {
		lines.push(...formatQuestion(question, index));
	});
	lines.push(...formatJudgeSection('Judge verdict', judge));

	lines.push('## Ten-more quiz set');
	lines.push('### Summary');
	lines.push(`- Quiz title: ${tenMoreQuiz.quiz.quizTitle}`);
	lines.push(`- Summary: ${tenMoreQuiz.quiz.summary}`);
	lines.push(`- Question count: ${tenMoreQuiz.quiz.questionCount}`);
	lines.push('');
	lines.push(...formatPromptSection('Ten-more generation prompt', tenMoreQuiz.prompt));
	lines.push('### Questions');
	lines.push('');
	tenMoreQuiz.quiz.questions.forEach((question, index) => {
		lines.push(...formatQuestion(question, index));
	});
	lines.push(...formatJudgeSection('Ten-more judge verdict', tenMoreJudge));

	const reportDir = path.join(REPORTS_DIR, manifest.id);
	await mkdir(reportDir, { recursive: true });
	await writeFile(path.join(reportDir, manifest.files.report), lines.join('\n'), 'utf8');
}

async function runRenderStage(): Promise<void> {
	const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
	await rm(REPORTS_DIR, { recursive: true, force: true });
	await mkdir(REPORTS_DIR, { recursive: true });

	const commitHash = await getGitHead();
	const githubRepo = await getGitHubRepoSlug();

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const sampleDir = path.join(OUTPUT_DIR, entry.name);
		const manifestPath = path.join(sampleDir, MANIFEST_FILE_NAME);
		try {
			const manifestBuffer = await readFile(manifestPath, 'utf8');
			const manifest = JSON.parse(manifestBuffer) as SampleManifest;
			await renderSampleReport({
				sampleDir,
				manifest,
				commitHash,
				githubRepo
			});
			console.log(`[sample-quizzes] Rendered markdown report for ${manifest.id}.`);
		} catch (error) {
			console.error(`[sample-quizzes] Failed to render report for ${entry.name}:`, error);
			throw error;
		}
	}
}

async function main(): Promise<void> {
	const stage = parseStageSelection();
	if (stage.generate) {
		await runGenerationStage();
	}
	if (stage.render) {
		await runRenderStage();
	}
}

main().catch((error) => {
	console.error('[sample-quizzes] Unhandled error:', error);
	process.exitCode = 1;
});
