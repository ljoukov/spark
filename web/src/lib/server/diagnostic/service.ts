import { env } from '$env/dynamic/private';
import {
	isDiagnosticLevelForCountry,
	resolveDiagnosticPaperSubject,
	resolveDiagnosticTopicLabel,
	type DiagnosticCountry,
	type DiagnosticStartMode,
	type DiagnosticTopic
} from '$lib/diagnostic/options';
import {
	listFirestoreDocuments,
	getFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import {
	generateJson,
	resolveWorkspacePathContentType,
	upsertWorkspaceTextFileDoc,
	type LlmTextModelId
} from '@spark/llm';
import {
	SparkGraderWorksheetReportSchema,
	applyPaperSheetSubjectTheme,
	type PaperSheetAnswers,
	type PaperSheetData,
	type PaperSheetQuestionReview,
	type SparkGraderWorksheetReport
} from '@spark/schemas';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createGraderRun, listGraderRuns } from '$lib/server/grader/repo';

const DIAGNOSTIC_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';
const MCQ_COUNT = 5;
const FILL_COUNT = 6;
const EXTENSION_COUNT = 3;
const MCQ_MARKS = 1;
const FILL_MARKS = 1;
const EXTENSION_MARKS = 4;
const EXTENSION_STOP_WORDS = new Set([
	'about',
	'after',
	'also',
	'answer',
	'because',
	'before',
	'being',
	'could',
	'each',
	'from',
	'have',
	'into',
	'more',
	'only',
	'question',
	'should',
	'show',
	'shows',
	'that',
	'their',
	'then',
	'there',
	'these',
	'this',
	'using',
	'when',
	'where',
	'which',
	'with',
	'would',
	'your'
]);

const diagnosticTopicSchema = z.enum(['olympiad_math', 'physics', 'biology', 'chemistry']);
const diagnosticCountrySchema = z.enum(['UK', 'USA', 'Canada', 'Australia', 'Singapore']);
const schoolYearSchema = z.string().trim().min(1).max(40);
const diagnosticStartModeSchema = z.enum(['fresh', 'progress']);

const trimmedString = z.string().trim().min(1);
const maybeEmptyString = z.string().trim();

const firestoreTimestampSchema = z.preprocess((value) => {
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date;
		}
		return value;
	}
	if (
		value &&
		typeof value === 'object' &&
		'seconds' in value &&
		'nanoseconds' in value &&
		typeof (value as { seconds: unknown }).seconds === 'number' &&
		typeof (value as { nanoseconds: unknown }).nanoseconds === 'number'
	) {
		const seconds = (value as { seconds: number }).seconds;
		const nanoseconds = (value as { nanoseconds: number }).nanoseconds;
		return new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
	}
	return value;
}, z.date());

const generatedMcqQuestionSchema = z
	.object({
		prompt: trimmedString.max(900),
		options: z
			.array(
				z.object({
					label: z.enum(['A', 'B', 'C', 'D']),
					text: trimmedString.max(260)
				})
			)
			.length(4),
		answerLabel: z.enum(['A', 'B', 'C', 'D']),
		explanation: trimmedString.max(500),
		skill: trimmedString.max(120)
	})
	.superRefine((question, ctx) => {
		const labels = new Set(question.options.map((option) => option.label));
		for (const label of ['A', 'B', 'C', 'D'] as const) {
			if (!labels.has(label)) {
				ctx.addIssue({
					code: 'custom',
					path: ['options'],
					message: `MCQ options must include label ${label}.`
				});
			}
		}
	});

const generatedFillQuestionSchema = z.object({
	beforeBlank: maybeEmptyString.max(500),
	afterBlank: maybeEmptyString.max(500),
	answer: trimmedString.max(120),
	acceptedAnswers: z.array(trimmedString.max(120)).max(5).default([]),
	explanation: trimmedString.max(500),
	skill: trimmedString.max(120)
});

const generatedExtensionQuestionSchema = z.object({
	prompt: trimmedString.max(900),
	modelAnswer: trimmedString.max(1400),
	rubric: z.array(trimmedString.max(220)).length(4),
	skill: trimmedString.max(120)
});

const generatedSheetPayloadSchema = z.object({
	title: trimmedString.max(120),
	subtitle: trimmedString.max(180),
	levelLabel: trimmedString.max(80),
	rationale: trimmedString.max(900),
	mcq: z.array(generatedMcqQuestionSchema).length(MCQ_COUNT),
	fill: z.array(generatedFillQuestionSchema).length(FILL_COUNT),
	extension: z.array(generatedExtensionQuestionSchema).length(EXTENSION_COUNT)
});

const diagnosticMcqQuestionSchema = generatedMcqQuestionSchema.extend({
	id: trimmedString,
	type: z.literal('mcq')
});

const diagnosticFillQuestionSchema = generatedFillQuestionSchema.extend({
	id: trimmedString,
	type: z.literal('fill')
});

const diagnosticExtensionQuestionSchema = generatedExtensionQuestionSchema.extend({
	id: trimmedString,
	type: z.literal('extension')
});

const diagnosticAnswersSchema = z
	.object({
		mcq: z.record(trimmedString, z.string().trim().max(20)).optional().default({}),
		fill: z.record(trimmedString, z.string().trim().max(240)).optional().default({}),
		extension: z.record(trimmedString, z.string().trim().max(3000)).optional().default({})
	})
	.transform(({ mcq, fill, extension }) => ({ mcq, fill, extension }));

const diagnosticQuestionGradeSchema = z.object({
	status: z.enum(['correct', 'partial', 'incorrect']),
	score: z.number().min(0),
	maxScore: z.number().min(0),
	note: maybeEmptyString.max(600),
	modelAnswer: z.string().trim().max(1600).optional()
});

const diagnosticSheetGradingSchema = z.object({
	totalScore: z.number().min(0),
	maxScore: z.number().min(0),
	percentage: z.number().min(0).max(100),
	summary: trimmedString.max(900),
	inferredLevel: trimmedString.max(120),
	recommendation: trimmedString.max(900),
	questionGrades: z.record(trimmedString, diagnosticQuestionGradeSchema)
});

const diagnosticResultsSchema = z.object({
	title: trimmedString.max(120),
	levelBand: trimmedString.max(120),
	summary: trimmedString.max(1200),
	strengths: z.array(trimmedString.max(180)).min(1).max(5),
	focusAreas: z.array(trimmedString.max(220)).min(1).max(5),
	nextSteps: z.array(trimmedString.max(220)).min(1).max(5),
	recommendedPath: trimmedString.max(900),
	generatedAt: firestoreTimestampSchema
});
const diagnosticResultsPayloadSchema = diagnosticResultsSchema.omit({ generatedAt: true });

const diagnosticSheetSchema = z.object({
	index: z.number().int().min(1).max(3),
	title: trimmedString,
	subtitle: trimmedString,
	levelLabel: trimmedString,
	rationale: trimmedString,
	questions: z.object({
		mcq: z.array(diagnosticMcqQuestionSchema).length(MCQ_COUNT),
		fill: z.array(diagnosticFillQuestionSchema).length(FILL_COUNT),
		extension: z.array(diagnosticExtensionQuestionSchema).length(EXTENSION_COUNT)
	}),
	createdAt: firestoreTimestampSchema,
	submittedAt: firestoreTimestampSchema.optional(),
	answers: diagnosticAnswersSchema.optional(),
	grading: diagnosticSheetGradingSchema.optional(),
	runId: trimmedString.optional()
});

export const DiagnosticTestDocSchema = z.object({
	id: trimmedString,
	status: z.enum(['in_progress', 'complete']),
	topic: diagnosticTopicSchema,
	topicLabel: trimmedString,
	subjectLabel: trimmedString,
	country: diagnosticCountrySchema,
	schoolYear: schoolYearSchema,
	mode: diagnosticStartModeSchema.default('fresh'),
	priorEvidence: z.string().trim().max(8000).optional(),
	currentSheetIndex: z.number().int().min(1).max(3),
	sheets: z.array(diagnosticSheetSchema).min(1).max(3),
	createdAt: firestoreTimestampSchema,
	updatedAt: firestoreTimestampSchema,
	completedAt: firestoreTimestampSchema.optional(),
	results: diagnosticResultsSchema.optional()
});

export type DiagnosticAnswers = z.infer<typeof diagnosticAnswersSchema>;
export type DiagnosticTestDoc = z.infer<typeof DiagnosticTestDocSchema>;
type DiagnosticSheet = z.infer<typeof diagnosticSheetSchema>;
type DiagnosticQuestionGrade = z.infer<typeof diagnosticQuestionGradeSchema>;

const extensionGradeSchema = z.object({
	questionId: trimmedString,
	score: z.number().min(0).max(EXTENSION_MARKS),
	note: trimmedString.max(600)
});

const extensionGradingPayloadSchema = z.object({
	summary: trimmedString.max(900),
	inferredLevel: trimmedString.max(120),
	recommendation: trimmedString.max(900),
	extensionGrades: z.array(extensionGradeSchema).max(EXTENSION_COUNT)
});
type ExtensionGradingPayload = z.infer<typeof extensionGradingPayloadSchema>;

export const DiagnosticStartRequestSchema = z.object({
	topic: diagnosticTopicSchema,
	country: diagnosticCountrySchema,
	schoolYear: schoolYearSchema,
	mode: diagnosticStartModeSchema.optional().default('fresh')
}).superRefine((input, ctx) => {
	if (!isDiagnosticLevelForCountry(input.country, input.schoolYear)) {
		ctx.addIssue({
			code: 'custom',
			path: ['schoolYear'],
			message: 'Unsupported school stage for the selected country'
		});
	}
});

export const DiagnosticSubmitRequestSchema = z.object({
	sheetIndex: z.number().int().min(1).max(3),
	answers: diagnosticAnswersSchema
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return unwrapQuotedJson(value);
}

function unwrapQuotedJson(value: string): string {
	const trimmed = value.trim();
	if (
		((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
			(trimmed.startsWith('"') && trimmed.endsWith('"'))) &&
		trimmed.length >= 2
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function preferGoogleServiceAccountAuthForDiagnostic(): void {
	const serviceAccountJson = (
		env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON
	)?.trim();
	if (!serviceAccountJson) {
		return;
	}
	process.env.GOOGLE_SERVICE_ACCOUNT_JSON = unwrapQuotedJson(serviceAccountJson);
	process.env.GOOGLE_API_KEY = '';
	process.env.GEMINI_API_KEY = '';
}

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

function diagnosticTestsCollectionPath(userId: string): string {
	return `spark/${userId}/diagnosticTests`;
}

function diagnosticTestDocPath(userId: string, testId: string): string {
	return `${diagnosticTestsCollectionPath(userId)}/${testId}`;
}

function nowIso(date: Date): string {
	return date.toISOString();
}

function normalizeAnswerText(value: string | undefined): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/[`"'\u2019]/g, '')
		.replace(/[^\p{L}\p{N}\s.+\-=/]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripFillBlankPlaceholder(value: string): string {
	return value
		.replace(/\$?\s*\\sqrt\s*\{\s*(?:\\text\s*\{\s*\}|\\mathrm\s*\{\s*\}|_{2,})\s*\}\s*\$?/g, '')
		.replace(/\$?\s*\\boxed\s*\{\s*(?:\\text\s*\{\s*\}|\\mathrm\s*\{\s*\}|_{2,})\s*\}\s*\$?/g, '')
		.replace(/\$?\s*\\text\s*\{\s*_{2,}\s*\}\s*\$?/g, '')
		.replace(/\$?\s*\\text\s*\{\s*\}\s*\$?/g, '')
		.replace(/\$?\s*\\mathrm\s*\{\s*_{2,}\s*\}\s*\$?/g, '')
		.replace(/\$?\s*\\mathrm\s*\{\s*\}\s*\$?/g, '')
		.replace(/_{3,}/g, '')
		.replace(/\s+([.,;:!?])/g, '$1')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

function sanitizeGeneratedFillQuestion(
	question: z.infer<typeof generatedFillQuestionSchema>
): z.infer<typeof generatedFillQuestionSchema> {
	return {
		...question,
		beforeBlank: stripFillBlankPlaceholder(question.beforeBlank),
		afterBlank: stripFillBlankPlaceholder(question.afterBlank)
	};
}

function percentage(score: number, maxScore: number): number {
	if (maxScore <= 0) {
		return 0;
	}
	return Math.round((score / maxScore) * 1000) / 10;
}

function gradeStatus(score: number, maxScore: number): DiagnosticQuestionGrade['status'] {
	if (score >= maxScore) {
		return 'correct';
	}
	if (score <= 0) {
		return 'incorrect';
	}
	return 'partial';
}

function clampExtensionScore(score: number): number {
	if (!Number.isFinite(score)) {
		return 0;
	}
	return Math.max(0, Math.min(EXTENSION_MARKS, Math.round(score)));
}

function tokenizeExtensionSignal(value: string): string[] {
	return normalizeAnswerText(value)
		.split(' ')
		.filter((token) => {
			if (token.length === 0) {
				return false;
			}
			if (EXTENSION_STOP_WORDS.has(token)) {
				return false;
			}
			return token.length >= 4 || /^\d+$/.test(token);
		});
}

function countExtensionKeywordOverlap(answer: string, target: string): number {
	const answerTokens = new Set(tokenizeExtensionSignal(answer));
	const targetTokens = new Set(tokenizeExtensionSignal(target));
	let overlap = 0;
	for (const token of answerTokens) {
		if (targetTokens.has(token)) {
			overlap += 1;
		}
	}
	return overlap;
}

function gradeExtensionQuestionLocally(
	question: DiagnosticSheet['questions']['extension'][number],
	answer: string | undefined
): z.infer<typeof extensionGradeSchema> {
	const rawAnswer = answer?.trim() ?? '';
	if (rawAnswer.length === 0) {
		return {
			questionId: question.id,
			score: 0,
			note: 'No response was submitted for this extension question.'
		};
	}

	const normalizedAnswer = normalizeAnswerText(rawAnswer);
	const targetText = [question.prompt, question.modelAnswer, ...question.rubric].join(' ');
	const overlap = countExtensionKeywordOverlap(normalizedAnswer, targetText);
	const hasSpecificNotation =
		/[=<>+\-*/^]/.test(rawAnswer) || /\b\d+(?:\.\d+)?\b/.test(rawAnswer);
	const hasReasoning =
		/\b(because|therefore|since|hence|so|if|then|case|cases|counterexample|prove|shows|means|implies|deduce|compare|calculate|substitute)\b/.test(
			normalizedAnswer
		);
	const hasSubstance = normalizedAnswer.length >= 70;
	const hasDomainSignal =
		overlap >= 3 ||
		/\b(area|angle|atom|cell|charge|chemical|conservation|equation|energy|enzyme|force|gene|graph|mass|mole|number|probability|ratio|reaction|speed|variable|volume)\b/.test(
			normalizedAnswer
		);

	let score = 0;
	if (hasSubstance) {
		score += 1;
	}
	if (hasSpecificNotation || hasDomainSignal) {
		score += 1;
	}
	if (hasReasoning) {
		score += 1;
	}
	if (overlap >= 5) {
		score += 1;
	}
	if (normalizedAnswer.length < 35 && !hasSpecificNotation && overlap < 2) {
		score = 0;
	}

	const clampedScore = clampExtensionScore(score);
	const note =
		clampedScore >= 4
			? 'Strong response: the reasoning is specific and aligns with several rubric points.'
			: clampedScore >= 2
				? 'Partial credit: the response gives relevant reasoning, but it does not fully establish the model answer.'
				: clampedScore === 1
					? 'Limited credit: the response contains one useful idea, but the reasoning is too brief or incomplete.'
					: 'This response does not include enough specific reasoning to satisfy the extension rubric.';
	return {
		questionId: question.id,
		score: clampedScore,
		note
	};
}

function gradeExtensionQuestionsLocally(options: {
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
}): ExtensionGradingPayload {
	const extensionGrades = options.sheet.questions.extension.map((question) =>
		gradeExtensionQuestionLocally(question, options.answers.extension[question.id])
	);
	const attemptedCount = extensionGrades.filter(
		(grade) => grade.note !== 'No response was submitted for this extension question.'
	).length;
	const extensionScore = extensionGrades.reduce((sum, grade) => sum + grade.score, 0);
	const extensionMax = EXTENSION_COUNT * EXTENSION_MARKS;
	if (attemptedCount === 0) {
		return {
			summary: 'The objective questions were scored, but no extension answers were submitted.',
			inferredLevel: options.sheet.levelLabel,
			recommendation: 'Use the next sheet to check core understanding before extending difficulty.',
			extensionGrades
		};
	}

	const recommendation =
		extensionScore >= Math.ceil(extensionMax * 0.7)
			? 'Probe at a higher level on the next sheet while checking that written reasoning stays precise.'
			: extensionScore >= Math.ceil(extensionMax * 0.35)
				? 'Use the next sheet to separate secure method knowledge from gaps in written reasoning.'
				: 'Use the next sheet to check prerequisite ideas before increasing extension difficulty.';
	return {
		summary: `The objective questions were scored and the extension responses earned ${extensionScore}/${extensionMax} rubric marks.`,
		inferredLevel: options.sheet.levelLabel,
		recommendation,
		extensionGrades
	};
}

function toPaperReviewStatus(
	status: DiagnosticQuestionGrade['status']
): PaperSheetQuestionReview['status'] {
	if (status === 'correct') {
		return 'correct';
	}
	if (status === 'incorrect') {
		return 'incorrect';
	}
	return 'teacher-review';
}

function mcqOptionId(questionId: string, label: string): string {
	return `${questionId}-${label.toLowerCase()}`;
}

function resolveMcqPaperAnswer(
	question: DiagnosticSheet['questions']['mcq'][number],
	answerLabel: string | undefined
): string {
	const normalizedAnswer = answerLabel?.trim().toUpperCase() ?? '';
	if (!question.options.some((option) => option.label === normalizedAnswer)) {
		return '';
	}
	return mcqOptionId(question.id, normalizedAnswer);
}

function createDiagnosticSheet(options: {
	index: number;
	payload: z.infer<typeof generatedSheetPayloadSchema>;
	now: Date;
}): DiagnosticSheet {
	const { index, payload, now } = options;
	return {
		index,
		title: payload.title,
		subtitle: payload.subtitle,
		levelLabel: payload.levelLabel,
		rationale: payload.rationale,
		questions: {
			mcq: payload.mcq.map((question, questionIndex) => ({
				...question,
				id: `s${index}-mcq-${questionIndex + 1}`,
				type: 'mcq' as const
			})),
			fill: payload.fill.map((question, questionIndex) => ({
				...sanitizeGeneratedFillQuestion(question),
				id: `s${index}-fill-${questionIndex + 1}`,
				type: 'fill' as const
			})),
			extension: payload.extension.map((question, questionIndex) => ({
				...question,
				id: `s${index}-ext-${questionIndex + 1}`,
				type: 'extension' as const
			}))
		},
		createdAt: now
	};
}

function summarizeDiagnosticHistory(test: DiagnosticTestDoc): string {
	const submittedSheets = test.sheets.filter((sheet) => sheet.grading);
	if (submittedSheets.length === 0) {
		return 'No completed sheets yet.';
	}
	return submittedSheets
		.map((sheet) => {
			const grading = sheet.grading;
			if (!grading) {
				return null;
			}
			const weakSignals = Object.entries(grading.questionGrades)
				.filter(([, grade]) => grade.score < grade.maxScore)
				.slice(0, 8)
				.map(([questionId, grade]) => `${questionId}: ${grade.note}`)
				.join('; ');
			return [
				`Sheet ${sheet.index}: ${grading.totalScore}/${grading.maxScore} (${grading.percentage}%).`,
				`Inferred level: ${grading.inferredLevel}.`,
				`Summary: ${grading.summary}`,
				weakSignals ? `Missed/partial signals: ${weakSignals}` : 'No missed/partial signals.'
			].join('\n')
		})
		.filter((entry): entry is string => entry !== null)
		.join('\n\n');
}

function buildDiagnosticGenerationPrompt(options: {
	test: Pick<
		DiagnosticTestDoc,
		'topic' | 'topicLabel' | 'subjectLabel' | 'country' | 'schoolYear' | 'mode' | 'priorEvidence'
	>;
	sheetIndex: number;
	history: string;
}): string {
	const topicLabel = resolveDiagnosticTopicLabel(options.test.topic);
	return [
		'You are Spark diagnostic agent.',
		'Generate one diagnostic sheet that pinpoints a student level.',
		'Return only data matching the schema.',
		'',
		`Topic: ${topicLabel}.`,
		`School year: ${options.test.schoolYear}.`,
		`Country: ${options.test.country}.`,
		`Start mode: ${options.test.mode}.`,
		`Sheet number: ${options.sheetIndex} of 3.`,
		'',
		'Required structure:',
		`- exactly ${MCQ_COUNT} multiple-choice questions`,
		`- exactly ${FILL_COUNT} one-blank fill-in-the-blank questions`,
		`- exactly ${EXTENSION_COUNT} extension questions`,
		'- MCQs must have labels A, B, C, D and exactly one answerLabel.',
		'- Fill questions must split cleanly into beforeBlank, answer, and afterBlank.',
		'- Fill questions must not include visible blank markers such as ____, \\text{____}, or [blank] inside beforeBlank or afterBlank; Spark renders the blank field separately.',
		'- Fill questions must not use empty math constructs as blank markers, such as \\sqrt{\\text{}}, \\boxed{}, or \\text{}.',
		'- If the missing value belongs inside a formula, rephrase the sentence so beforeBlank ends immediately before the missing value and afterBlank starts immediately after it.',
		'- Extension rubrics must have four one-mark criteria in increasing sophistication.',
		'- Avoid trivia and rote definitions unless they distinguish readiness for the topic.',
		'- Use age-appropriate wording for the school year and country.',
		'',
		'Difficulty targeting:',
		options.sheetIndex === 1
			? options.test.mode === 'progress'
				? 'Use prior learner evidence as the strongest signal for the opening difficulty, then probe above the latest secure level.'
				: 'Start with a broad diagnostic range around the stated school year, including a few questions below and above expected level.'
			: 'Adapt the new sheet to the prior answers. Make it harder where the student was secure and more diagnostic where they showed gaps.',
		'',
		'Prior learner evidence before this diagnostic:',
		options.test.priorEvidence?.trim() || 'No prior learner evidence supplied.',
		'',
		'Previous completed sheet evidence:',
		options.history
	].join('\n');
}

async function generateDiagnosticSheet(options: {
	test: Pick<
		DiagnosticTestDoc,
		| 'topic'
		| 'topicLabel'
		| 'subjectLabel'
		| 'country'
		| 'schoolYear'
		| 'mode'
		| 'priorEvidence'
		| 'sheets'
	>;
	sheetIndex: number;
	now: Date;
}): Promise<DiagnosticSheet> {
	preferGoogleServiceAccountAuthForDiagnostic();
	const history =
		summarizeDiagnosticHistory({
			...options.test,
			id: 'preview',
			status: 'in_progress',
			currentSheetIndex: options.sheetIndex,
			createdAt: options.now,
			updatedAt: options.now
		});
	const payload = await generateJson({
		modelId: DIAGNOSTIC_MODEL_ID,
		contents: [
			{
				role: 'user',
				parts: [
					{
						type: 'text',
						text: buildDiagnosticGenerationPrompt({
							test: options.test,
							sheetIndex: options.sheetIndex,
							history
						})
					}
				]
			}
		],
		schema: generatedSheetPayloadSchema,
		thinkingLevel: 'medium',
		maxAttempts: 2
	});
	return createDiagnosticSheet({ index: options.sheetIndex, payload, now: options.now });
}

function gradeMcqQuestion(
	question: DiagnosticSheet['questions']['mcq'][number],
	answerLabel: string | undefined
): DiagnosticQuestionGrade {
	const normalizedAnswer = answerLabel?.trim().toUpperCase() ?? '';
	const correct = normalizedAnswer === question.answerLabel;
	return {
		status: correct ? 'correct' : 'incorrect',
		score: correct ? MCQ_MARKS : 0,
		maxScore: MCQ_MARKS,
		note: correct
			? question.explanation
			: `Correct answer: ${question.answerLabel}. ${question.explanation}`,
		modelAnswer: question.answerLabel
	};
}

function gradeFillQuestion(
	question: DiagnosticSheet['questions']['fill'][number],
	answer: string | undefined
): DiagnosticQuestionGrade {
	const normalizedAnswer = normalizeAnswerText(answer);
	const accepted = [question.answer, ...question.acceptedAnswers].map(normalizeAnswerText);
	const correct = normalizedAnswer.length > 0 && accepted.includes(normalizedAnswer);
	return {
		status: correct ? 'correct' : 'incorrect',
		score: correct ? FILL_MARKS : 0,
		maxScore: FILL_MARKS,
		note: correct
			? question.explanation
			: `Expected: ${question.answer}. ${question.explanation}`,
		modelAnswer: question.answer
	};
}

function buildExtensionGradingPrompt(options: {
	test: DiagnosticTestDoc;
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
	objectiveScore: number;
	objectiveMax: number;
}): string {
	const questions = options.sheet.questions.extension.map((question) => ({
		questionId: question.id,
		prompt: question.prompt,
		rubric: question.rubric,
		modelAnswer: question.modelAnswer,
		studentAnswer: options.answers.extension[question.id] ?? ''
	}));
	return [
		'You are Spark diagnostic-test grading agent.',
		'Grade the extension responses for this diagnostic. Return only data matching the schema.',
		'',
		`Topic: ${resolveDiagnosticTopicLabel(options.test.topic)}.`,
		`School year: ${options.test.schoolYear}.`,
		`Country: ${options.test.country}.`,
		`Sheet: ${options.sheet.index} of 3.`,
		`Objective score before extension questions: ${options.objectiveScore}/${options.objectiveMax}.`,
		'',
		'Grade each extension question from 0 to 4 using the rubric. Award partial credit for valid reasoning even when final wording differs.',
		'Keep feedback concise and diagnostic; do not over-explain.',
		'',
		JSON.stringify({ questions }, null, 2)
	].join('\n');
}

async function gradeExtensionQuestions(options: {
	test: DiagnosticTestDoc;
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
	objectiveScore: number;
	objectiveMax: number;
}): Promise<ExtensionGradingPayload> {
	const localPayload = gradeExtensionQuestionsLocally({
		sheet: options.sheet,
		answers: options.answers
	});
	if (localPayload.extensionGrades.every((grade) => grade.score === 0)) {
		const allBlank = localPayload.extensionGrades.every(
			(grade) => grade.note === 'No response was submitted for this extension question.'
		);
		if (allBlank) {
			return localPayload;
		}
	}

	try {
		preferGoogleServiceAccountAuthForDiagnostic();
		const payload = await generateJson({
			modelId: DIAGNOSTIC_MODEL_ID,
			contents: [
				{
					role: 'user',
					parts: [{ type: 'text', text: buildExtensionGradingPrompt(options) }]
				}
			],
			schema: extensionGradingPayloadSchema,
			thinkingLevel: 'low',
			maxAttempts: 2
		});
		return {
			...payload,
			extensionGrades: payload.extensionGrades.map((grade) => ({
				...grade,
				score: clampExtensionScore(grade.score)
			}))
		};
	} catch (error) {
		console.error('[diagnostic] extension grading failed', {
			error,
			testId: options.test.id,
			sheetIndex: options.sheet.index
		});
		return localPayload;
	}
}

async function gradeDiagnosticSheet(options: {
	test: DiagnosticTestDoc;
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
}): Promise<z.infer<typeof diagnosticSheetGradingSchema>> {
	const questionGrades: Record<string, DiagnosticQuestionGrade> = {};
	let objectiveScore = 0;
	let objectiveMax = 0;

	for (const question of options.sheet.questions.mcq) {
		const grade = gradeMcqQuestion(question, options.answers.mcq[question.id]);
		questionGrades[question.id] = grade;
		objectiveScore += grade.score;
		objectiveMax += grade.maxScore;
	}

	for (const question of options.sheet.questions.fill) {
		const grade = gradeFillQuestion(question, options.answers.fill[question.id]);
		questionGrades[question.id] = grade;
		objectiveScore += grade.score;
		objectiveMax += grade.maxScore;
	}

	const extensionPayload = await gradeExtensionQuestions({
		test: options.test,
		sheet: options.sheet,
		answers: options.answers,
		objectiveScore,
		objectiveMax
	});
	const localExtensionPayload = gradeExtensionQuestionsLocally({
		sheet: options.sheet,
		answers: options.answers
	});
	const extensionGradesById = new Map(
		extensionPayload.extensionGrades.map((grade) => [grade.questionId, grade])
	);
	const localExtensionGradesById = new Map(
		localExtensionPayload.extensionGrades.map((grade) => [grade.questionId, grade])
	);
	for (const question of options.sheet.questions.extension) {
		const extensionGrade =
			extensionGradesById.get(question.id) ?? localExtensionGradesById.get(question.id);
		const score = clampExtensionScore(extensionGrade?.score ?? 0);
		const grade: DiagnosticQuestionGrade = {
			status: gradeStatus(score, EXTENSION_MARKS),
			score,
			maxScore: EXTENSION_MARKS,
			note:
				extensionGrade?.note ??
				'This response does not include enough specific reasoning to satisfy the extension rubric.',
			modelAnswer: question.modelAnswer
		};
		questionGrades[question.id] = grade;
	}

	const totalScore = Object.values(questionGrades).reduce((sum, grade) => sum + grade.score, 0);
	const maxScore = Object.values(questionGrades).reduce((sum, grade) => sum + grade.maxScore, 0);
	return diagnosticSheetGradingSchema.parse({
		totalScore,
		maxScore,
		percentage: percentage(totalScore, maxScore),
		summary: extensionPayload.summary,
		inferredLevel: extensionPayload.inferredLevel,
		recommendation: extensionPayload.recommendation,
		questionGrades
	});
}

export function buildDiagnosticPaperSheetData(options: {
	test: DiagnosticTestDoc;
	sheet: DiagnosticSheet;
}): PaperSheetData {
	const subject = resolveDiagnosticPaperSubject(options.test.topic);
	const baseSheet: PaperSheetData = {
		id: `diagnostic-${options.test.id}-sheet-${options.sheet.index}`,
		subject,
		level: `${options.test.schoolYear} - ${options.test.country}`,
		title: options.sheet.title,
		subtitle: options.sheet.subtitle,
		color: '#3B82F6',
		accent: '#1D4ED8',
		light: '#DBEAFE',
		border: '#93C5FD',
		sections: [
			{
				type: 'hook',
				text: `Diagnostic sheet ${options.sheet.index} of 3 - ${options.sheet.rationale}`
			},
			{
				id: 'multiple-choice',
				label: 'Section A: Multiple choice',
				questions: options.sheet.questions.mcq.map((question, index) => ({
					id: question.id,
					type: 'mcq' as const,
					displayNumber: String(index + 1),
					marks: MCQ_MARKS,
					prompt: question.prompt,
					displayMode: 'full_options' as const,
					options: question.options.map((option) => ({
						id: mcqOptionId(question.id, option.label),
						label: option.label,
						text: option.text
					}))
				}))
			},
			{
				id: 'fill-blanks',
				label: 'Section B: Fill in the blanks',
				questions: options.sheet.questions.fill.map((question, index) => ({
					id: question.id,
					type: 'fill' as const,
					displayNumber: String(MCQ_COUNT + index + 1),
					marks: FILL_MARKS,
					prompt: stripFillBlankPlaceholder(question.beforeBlank),
					blanks: [{ placeholder: 'answer', minWidth: 12 }],
					after: stripFillBlankPlaceholder(question.afterBlank)
				}))
			},
			{
				id: 'extension',
				label: 'Section C: Extension',
				questions: options.sheet.questions.extension.map((question, index) => ({
					id: question.id,
					type: 'lines' as const,
					displayNumber: String(MCQ_COUNT + FILL_COUNT + index + 1),
					marks: EXTENSION_MARKS,
					prompt: question.prompt,
					lines: 5,
					renderMode: 'plain' as const
				}))
			}
		]
	};
	return applyPaperSheetSubjectTheme(baseSheet);
}

function buildPaperAnswers(options: {
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
}): PaperSheetAnswers {
	const answers: PaperSheetAnswers = {};
	for (const question of options.sheet.questions.mcq) {
		answers[question.id] = resolveMcqPaperAnswer(question, options.answers.mcq[question.id]);
	}
	for (const question of options.sheet.questions.fill) {
		answers[question.id] = {
			'0': options.answers.fill[question.id] ?? ''
		};
	}
	for (const question of options.sheet.questions.extension) {
		answers[question.id] = options.answers.extension[question.id] ?? '';
	}
	return answers;
}

function buildPaperReview(options: {
	sheet: DiagnosticSheet;
	grading: z.infer<typeof diagnosticSheetGradingSchema>;
}): SparkGraderWorksheetReport['review'] {
	const questionReviews: SparkGraderWorksheetReport['review']['questions'] = {};
	for (const question of [
		...options.sheet.questions.mcq,
		...options.sheet.questions.fill,
		...options.sheet.questions.extension
	]) {
		const grade = options.grading.questionGrades[question.id];
		if (!grade) {
			continue;
		}
		questionReviews[question.id] = {
			status: toPaperReviewStatus(grade.status),
			statusLabel:
				grade.status === 'partial'
					? 'Partial'
					: grade.status === 'correct'
						? 'Correct'
						: 'Needs work',
			score: {
				got: grade.score,
				total: grade.maxScore
			},
			note: grade.note,
			modelAnswer: grade.modelAnswer
		};
	}
	return {
		mode: 'graded',
		score: {
			got: options.grading.totalScore,
			total: options.grading.maxScore
		},
		objectiveQuestionCount: MCQ_COUNT + FILL_COUNT,
		teacherReviewMarks: EXTENSION_COUNT * EXTENSION_MARKS,
		teacherReviewQuestionCount: EXTENSION_COUNT,
		label: `Diagnostic score ${options.grading.totalScore}/${options.grading.maxScore}`,
		message: options.grading.summary,
		note: options.grading.recommendation,
		questions: questionReviews
	};
}

function buildWorksheetReport(options: {
	test: DiagnosticTestDoc;
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
	grading: z.infer<typeof diagnosticSheetGradingSchema>;
}): SparkGraderWorksheetReport {
	const report = {
		schemaVersion: 1,
		sheet: buildDiagnosticPaperSheetData({
			test: options.test,
			sheet: options.sheet
		}),
		answers: buildPaperAnswers({
			sheet: options.sheet,
			answers: options.answers
		}),
		review: buildPaperReview({
			sheet: options.sheet,
			grading: options.grading
		}),
		references: {
			overallFeedbackMarkdown: [
				`# Diagnostic sheet ${options.sheet.index}`,
				'',
				options.grading.summary,
				'',
				`Inferred level: ${options.grading.inferredLevel}`,
				'',
				options.grading.recommendation
			].join('\n')
		}
	} satisfies SparkGraderWorksheetReport;
	return SparkGraderWorksheetReportSchema.parse(report);
}

async function writeWorkspaceTextFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	path: string;
	content: string;
	now: Date;
}): Promise<void> {
	await upsertWorkspaceTextFileDoc({
		serviceAccountJson: options.serviceAccountJson,
		userId: options.userId,
		workspaceId: options.workspaceId,
		filePath: options.path,
		content: options.content,
		contentType: resolveWorkspacePathContentType(options.path),
		createdAt: options.now,
		updatedAt: options.now
	});
}

async function publishDiagnosticSheetRun(options: {
	userId: string;
	test: DiagnosticTestDoc;
	sheet: DiagnosticSheet;
	answers: DiagnosticAnswers;
	grading: z.infer<typeof diagnosticSheetGradingSchema>;
	now: Date;
}): Promise<string> {
	const serviceAccountJson = requireServiceAccountJson();
	const runId = `${options.test.id}-sheet-${options.sheet.index}`;
	const agentId = `diagnostic-${randomUUID()}`;
	const workspaceId = `diagnostic-${options.test.id}-sheet-${options.sheet.index}`;
	const sheetPath = `diagnostic/sheet-${options.sheet.index}.json`;
	const summaryPath = `diagnostic/summary-${options.sheet.index}.md`;
	const report = buildWorksheetReport(options);
	const summaryMarkdown = [
		`# Diagnostic sheet ${options.sheet.index}`,
		'',
		`Topic: ${resolveDiagnosticTopicLabel(options.test.topic)}`,
		`School year: ${options.test.schoolYear}`,
		`Country: ${options.test.country}`,
		`Score: ${options.grading.totalScore}/${options.grading.maxScore} (${options.grading.percentage}%)`,
		'',
		options.grading.summary,
		'',
		`Inferred level: ${options.grading.inferredLevel}`,
		'',
		options.grading.recommendation
	].join('\n');

	await Promise.all([
		setFirestoreDocument({
			serviceAccountJson,
			documentPath: `users/${options.userId}/workspace/${workspaceId}`,
			data: {
				id: workspaceId,
				agentId,
				createdAt: options.now,
				updatedAt: options.now
			}
		}),
		setFirestoreDocument({
			serviceAccountJson,
			documentPath: `users/${options.userId}/agents/${agentId}`,
			data: {
				id: agentId,
				prompt: `Diagnostic sheet ${options.sheet.index}: ${resolveDiagnosticTopicLabel(options.test.topic)}`,
				status: 'done',
				workspaceId,
				createdAt: options.now,
				updatedAt: options.now,
				statesTimeline: [
					{ state: 'created', timestamp: options.now },
					{ state: 'done', timestamp: options.now }
				],
				resultSummary: options.grading.summary
			}
		}),
		writeWorkspaceTextFile({
			serviceAccountJson,
			userId: options.userId,
			workspaceId,
			path: sheetPath,
			content: JSON.stringify(report, null, 2),
			now: options.now
		}),
		writeWorkspaceTextFile({
			serviceAccountJson,
			userId: options.userId,
			workspaceId,
			path: summaryPath,
			content: summaryMarkdown,
			now: options.now
		})
	]);

	await createGraderRun(options.userId, {
		id: runId,
		agentId,
		workspaceId,
		userPrompt: `Diagnostic for ${resolveDiagnosticTopicLabel(options.test.topic)}, ${options.test.schoolYear}, ${options.test.country}`,
		olympiadKey: 'diagnostic_test',
		olympiadLabel: 'Diagnostic',
		summaryPath,
		sheetPath,
		status: 'done',
		sheetPhase: 'graded',
		paper: {
			contextLabel: 'Diagnostic'
		},
		presentation: {
			title: `Diagnostic sheet ${options.sheet.index}`,
			subtitle: `${resolveDiagnosticTopicLabel(options.test.topic)} - ${options.test.schoolYear} - ${options.test.country}`,
			summaryMarkdown: options.grading.summary,
			footer: 'Spark diagnostic'
		},
		totals: {
			awardedMarks: options.grading.totalScore,
			maxMarks: options.grading.maxScore,
			problemCount: MCQ_COUNT + FILL_COUNT + EXTENSION_COUNT,
			gradedCount: MCQ_COUNT + FILL_COUNT + EXTENSION_COUNT,
			percentage: options.grading.percentage
		},
		sheet: {
			title: options.sheet.title,
			filePath: sheetPath
		},
		resultSummary: options.grading.summary,
		createdAt: options.now,
		updatedAt: options.now,
		completedAt: options.now
	});

	return runId;
}

async function saveDiagnosticTest(userId: string, test: DiagnosticTestDoc): Promise<void> {
	const validated = DiagnosticTestDocSchema.parse(test);
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: diagnosticTestDocPath(userId, validated.id),
		data: validated as unknown as Record<string, unknown>
	});
}

export async function listDiagnosticTests(userId: string, limit = 10): Promise<DiagnosticTestDoc[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: diagnosticTestsCollectionPath(userId),
		limit,
		orderBy: 'updatedAt desc'
	});
	const tests: DiagnosticTestDoc[] = [];
	for (const doc of docs) {
		const parsed = DiagnosticTestDocSchema.safeParse({
			id: docIdFromPath(doc.documentPath),
			...doc.data
		});
		if (!parsed.success) {
			console.warn('[diagnostic] skipping invalid diagnostic test document', {
				documentPath: doc.documentPath,
				issues: parsed.error.issues
			});
			continue;
		}
		tests.push(parsed.data);
	}
	return tests;
}

export async function getDiagnosticTest(
	userId: string,
	testId: string
): Promise<DiagnosticTestDoc | null> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: diagnosticTestDocPath(userId, testId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const parsed = DiagnosticTestDocSchema.safeParse({
		id: testId,
		...snapshot.data
	});
	if (!parsed.success) {
		console.warn('[diagnostic] invalid diagnostic test document', {
			testId,
			issues: parsed.error.issues
		});
		return null;
	}
	return parsed.data;
}

export async function getLatestDiagnosticTest(userId: string): Promise<DiagnosticTestDoc | null> {
	const [latest] = await listDiagnosticTests(userId, 1);
	return latest ?? null;
}

export async function getDiagnosticStatus(userId: string): Promise<{
	hasCompleted: boolean;
	latest: DiagnosticTestClientState | null;
}> {
	const tests = await listDiagnosticTests(userId, 10);
	const hasCompleted = tests.some((test) => test.status === 'complete');
	return {
		hasCompleted,
		latest: tests[0] ? serializeDiagnosticTestForClient(tests[0]) : null
	};
}

async function buildPriorLearnerEvidence(options: {
	userId: string;
	mode: DiagnosticStartMode;
}): Promise<string> {
	if (options.mode === 'fresh') {
		return 'Fresh diagnostic requested. Do not use previous performance to choose the first sheet; use only the selected country, topic, and school stage.';
	}

	const [diagnostics, graderRuns] = await Promise.all([
		listDiagnosticTests(options.userId, 6).catch((error) => {
			console.warn('[diagnostic] failed to load prior diagnostics', { error });
			return [] as DiagnosticTestDoc[];
		}),
		listGraderRuns(options.userId, 12).catch((error) => {
			console.warn('[diagnostic] failed to load prior sheets', { error });
			return [];
		})
	]);

	const diagnosticLines = diagnostics
		.filter((test) => test.status === 'complete')
		.slice(0, 3)
		.map((test) => {
			const scoreLine = test.sheets
				.filter((sheet) => sheet.grading)
				.map((sheet) => {
					const grading = sheet.grading;
					return grading
						? `sheet ${sheet.index}: ${grading.totalScore}/${grading.maxScore} (${grading.inferredLevel})`
						: null;
				})
				.filter((entry): entry is string => entry !== null)
				.join(', ');
			return [
				`Completed diagnostic ${nowIso(test.completedAt ?? test.updatedAt)}: ${test.topicLabel}, ${test.schoolYear}, ${test.country}.`,
				scoreLine ? `Scores: ${scoreLine}.` : 'No sheet scores recorded.',
				test.results
					? `Diagnostic results: ${test.results.levelBand}. ${test.results.summary}`
					: 'No diagnostic results summary recorded.'
			].join(' ');
		});

	const sheetLines = graderRuns
		.filter((run) => run.totals !== undefined)
		.slice(0, 6)
		.map((run) => {
			const totals = run.totals;
			if (!totals) {
				return null;
			}
			const percentageText =
				totals.percentage !== undefined ? ` (${Math.round(totals.percentage).toString()}%)` : '';
			return [
				`${run.presentation?.title ?? run.sheet?.title ?? run.olympiadLabel}: ${totals.awardedMarks}/${totals.maxMarks}${percentageText}.`,
				run.resultSummary?.trim() ? `Summary: ${run.resultSummary.trim()}` : null
			]
				.filter((entry): entry is string => entry !== null)
				.join(' ');
		})
		.filter((entry): entry is string => entry !== null);

	const sections = [
		diagnosticLines.length > 0
			? ['Previous diagnostics:', ...diagnosticLines].join('\n')
			: 'Previous diagnostics: none found.',
		sheetLines.length > 0
			? ['Recent sheets:', ...sheetLines].join('\n')
			: 'Recent sheets: none found.'
	];
	return sections.join('\n\n').slice(0, 8000);
}

function buildDiagnosticResultsPrompt(test: DiagnosticTestDoc): string {
	const sheetSummaries = test.sheets
		.filter((sheet) => sheet.grading)
		.map((sheet) => {
			const grading = sheet.grading;
			if (!grading) {
				return null;
			}
			const missed = Object.entries(grading.questionGrades)
				.filter(([, grade]) => grade.score < grade.maxScore)
				.slice(0, 10)
				.map(([questionId, grade]) => `${questionId}: ${grade.score}/${grade.maxScore} ${grade.note}`)
				.join('; ');
			return [
				`Sheet ${sheet.index}: ${grading.totalScore}/${grading.maxScore} (${grading.percentage}%).`,
				`Inferred level: ${grading.inferredLevel}.`,
				`Summary: ${grading.summary}`,
				`Recommendation: ${grading.recommendation}`,
				missed ? `Weak/partial signals: ${missed}` : 'Weak/partial signals: none.'
			].join('\n')
		})
		.filter((entry): entry is string => entry !== null)
		.join('\n\n');

	return [
		'You are Spark diagnostic results agent.',
		'Synthesize the completed three-sheet diagnostic into learner-facing diagnostic results.',
		'Return only data matching the schema. Do not call the output a report.',
		'',
		`Topic: ${test.topicLabel}.`,
		`School year: ${test.schoolYear}.`,
		`Country: ${test.country}.`,
		`Start mode: ${test.mode}.`,
		'',
		'Prior learner evidence used for the first sheet:',
		test.priorEvidence?.trim() || 'No prior learner evidence supplied.',
		'',
		'Completed sheet evidence:',
		sheetSummaries
	].join('\n');
}

async function generateDiagnosticResults(options: {
	test: DiagnosticTestDoc;
	now: Date;
}): Promise<z.infer<typeof diagnosticResultsSchema>> {
	try {
		preferGoogleServiceAccountAuthForDiagnostic();
		const payload = await generateJson({
			modelId: DIAGNOSTIC_MODEL_ID,
			contents: [
				{
					role: 'user',
					parts: [{ type: 'text', text: buildDiagnosticResultsPrompt(options.test) }]
				}
			],
			schema: diagnosticResultsPayloadSchema,
			thinkingLevel: 'medium',
			maxAttempts: 2
		});
		return diagnosticResultsSchema.parse({
			...payload,
			generatedAt: options.now
		});
	} catch (error) {
		console.error('[diagnostic] results generation failed', {
			testId: options.test.id,
			error
		});
		const gradedSheets = options.test.sheets.filter((sheet) => sheet.grading);
		const totalScore = gradedSheets.reduce((sum, sheet) => sum + (sheet.grading?.totalScore ?? 0), 0);
		const maxScore = gradedSheets.reduce((sum, sheet) => sum + (sheet.grading?.maxScore ?? 0), 0);
		const finalSheet = gradedSheets[gradedSheets.length - 1];
		const finalLevel = finalSheet?.grading?.inferredLevel ?? options.test.schoolYear;
		return diagnosticResultsSchema.parse({
			title: `${options.test.topicLabel} diagnostic`,
			levelBand: finalLevel,
			summary: `Across the three diagnostic sheets, the student scored ${totalScore.toString()}/${maxScore.toString()}. Use the graded sheets for question-level evidence.`,
			strengths: ['Completed the full three-sheet diagnostic sequence.'],
			focusAreas: ['Review the questions marked partial or incorrect in the graded sheets.'],
			nextSteps: ['Open each graded sheet, correct missed questions, then continue with a higher-resolution diagnostic.'],
			recommendedPath:
				'Use the next diagnostic progression after reviewing the graded sheets so the opening sheet can use this performance data.',
			generatedAt: options.now
		});
	}
}

export async function startDiagnosticTest(options: {
	userId: string;
	input: z.infer<typeof DiagnosticStartRequestSchema>;
}): Promise<DiagnosticTestDoc> {
	const now = new Date();
	const testId = randomUUID();
	const priorEvidence = await buildPriorLearnerEvidence({
		userId: options.userId,
		mode: options.input.mode
	});
	const base = {
		id: testId,
		status: 'in_progress' as const,
		topic: options.input.topic,
		topicLabel: resolveDiagnosticTopicLabel(options.input.topic),
		subjectLabel: resolveDiagnosticPaperSubject(options.input.topic),
		country: options.input.country,
		schoolYear: options.input.schoolYear,
		mode: options.input.mode,
		priorEvidence,
		currentSheetIndex: 1,
		sheets: [],
		createdAt: now,
		updatedAt: now
	};
	const firstSheet = await generateDiagnosticSheet({
		test: base,
		sheetIndex: 1,
		now
	});
	const test = DiagnosticTestDocSchema.parse({
		...base,
		sheets: [firstSheet]
	});
	await saveDiagnosticTest(options.userId, test);
	return test;
}

export async function submitDiagnosticSheet(options: {
	userId: string;
	testId: string;
	input: z.infer<typeof DiagnosticSubmitRequestSchema>;
}): Promise<DiagnosticTestDoc> {
	const test = await getDiagnosticTest(options.userId, options.testId);
	if (!test) {
		throw new Error('diagnostic_test_not_found');
	}
	if (test.status === 'complete') {
		return test;
	}
	if (test.currentSheetIndex !== options.input.sheetIndex) {
		throw new Error('diagnostic_sheet_out_of_sequence');
	}
	const sheet = test.sheets.find((entry) => entry.index === options.input.sheetIndex);
	if (!sheet) {
		throw new Error('diagnostic_sheet_not_found');
	}
	if (sheet.grading && sheet.runId) {
		return test;
	}

	const now = new Date();
	const grading = await gradeDiagnosticSheet({
		test,
		sheet,
		answers: options.input.answers
	});
	const runId = await publishDiagnosticSheetRun({
		userId: options.userId,
		test,
		sheet,
		answers: options.input.answers,
		grading,
		now
	});
	const submittedSheet: DiagnosticSheet = {
		...sheet,
		submittedAt: now,
		answers: options.input.answers,
		grading,
		runId
	};
	const nextSheets = test.sheets.map((entry) =>
		entry.index === submittedSheet.index ? submittedSheet : entry
	);

	let updatedTest: DiagnosticTestDoc;
	if (sheet.index >= 3) {
		const testForResults = DiagnosticTestDocSchema.parse({
			...test,
			status: 'complete',
			sheets: nextSheets,
			updatedAt: now,
			completedAt: now
		});
		const results = await generateDiagnosticResults({
			test: testForResults,
			now
		});
		updatedTest = DiagnosticTestDocSchema.parse({
			...testForResults,
			results
		});
	} else {
		const testForNext = DiagnosticTestDocSchema.parse({
			...test,
			sheets: nextSheets,
			updatedAt: now
		});
		const nextSheet = await generateDiagnosticSheet({
			test: testForNext,
			sheetIndex: sheet.index + 1,
			now
		});
		updatedTest = DiagnosticTestDocSchema.parse({
			...testForNext,
			currentSheetIndex: sheet.index + 1,
			sheets: [...nextSheets, nextSheet],
			updatedAt: now
		});
	}

	await saveDiagnosticTest(options.userId, updatedTest);
	return updatedTest;
}

type ClientMcqQuestion = {
	id: string;
	type: 'mcq';
	prompt: string;
	options: Array<{ label: 'A' | 'B' | 'C' | 'D'; text: string }>;
};

type ClientFillQuestion = {
	id: string;
	type: 'fill';
	beforeBlank: string;
	afterBlank: string;
};

type ClientExtensionQuestion = {
	id: string;
	type: 'extension';
	prompt: string;
};

export type DiagnosticTestClientState = {
	id: string;
	status: DiagnosticTestDoc['status'];
	topic: DiagnosticTopic;
	topicLabel: string;
	subjectLabel: string;
	country: DiagnosticCountry;
	schoolYear: string;
	mode: DiagnosticStartMode;
	currentSheetIndex: number;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
	results: {
		title: string;
		levelBand: string;
		summary: string;
		strengths: string[];
		focusAreas: string[];
		nextSteps: string[];
		recommendedPath: string;
		generatedAt: string;
	} | null;
	sheets: Array<{
		index: number;
		title: string;
		subtitle: string;
		levelLabel: string;
		rationale: string;
		createdAt: string;
		submittedAt: string | null;
		runId: string | null;
		grading: {
			totalScore: number;
			maxScore: number;
			percentage: number;
			summary: string;
			inferredLevel: string;
			recommendation: string;
		} | null;
		questions: {
			mcq: ClientMcqQuestion[];
			fill: ClientFillQuestion[];
			extension: ClientExtensionQuestion[];
		};
	}>;
};

export function serializeDiagnosticTestForClient(test: DiagnosticTestDoc): DiagnosticTestClientState {
	return {
		id: test.id,
		status: test.status,
		topic: test.topic,
		topicLabel: test.topicLabel,
		subjectLabel: test.subjectLabel,
		country: test.country,
		schoolYear: test.schoolYear,
		mode: test.mode,
		currentSheetIndex: test.currentSheetIndex,
		createdAt: nowIso(test.createdAt),
		updatedAt: nowIso(test.updatedAt),
		completedAt: test.completedAt ? nowIso(test.completedAt) : null,
		results: test.results
			? {
					title: test.results.title,
					levelBand: test.results.levelBand,
					summary: test.results.summary,
					strengths: test.results.strengths,
					focusAreas: test.results.focusAreas,
					nextSteps: test.results.nextSteps,
					recommendedPath: test.results.recommendedPath,
					generatedAt: nowIso(test.results.generatedAt)
				}
			: null,
		sheets: test.sheets.map((sheet) => ({
			index: sheet.index,
			title: sheet.title,
			subtitle: sheet.subtitle,
			levelLabel: sheet.levelLabel,
			rationale: sheet.rationale,
			createdAt: nowIso(sheet.createdAt),
			submittedAt: sheet.submittedAt ? nowIso(sheet.submittedAt) : null,
			runId: sheet.runId ?? null,
			grading: sheet.grading
				? {
						totalScore: sheet.grading.totalScore,
						maxScore: sheet.grading.maxScore,
						percentage: sheet.grading.percentage,
						summary: sheet.grading.summary,
						inferredLevel: sheet.grading.inferredLevel,
						recommendation: sheet.grading.recommendation
					}
				: null,
			questions: {
				mcq: sheet.questions.mcq.map((question) => ({
					id: question.id,
					type: 'mcq' as const,
					prompt: question.prompt,
					options: question.options.map((option) => ({
						label: option.label,
						text: option.text
					}))
				})),
				fill: sheet.questions.fill.map((question) => ({
					id: question.id,
					type: 'fill' as const,
					beforeBlank: question.beforeBlank,
					afterBlank: question.afterBlank
				})),
				extension: sheet.questions.extension.map((question) => ({
					id: question.id,
					type: 'extension' as const,
					prompt: question.prompt
				}))
			}
		}))
	};
}
