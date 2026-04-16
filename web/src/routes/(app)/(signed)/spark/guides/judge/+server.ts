import { env } from '$env/dynamic/private';
import {
	GAP_BLANKS,
	GAP_HINT_QUESTIONS,
	ORIGINAL_QUESTION
} from '$lib/spark/guides/knowledgeGapGuide';
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateJson, type LlmTextModelId } from '@spark/llm';
import { z } from 'zod';

const JudgeStatusSchema = z.enum(['correct', 'partial', 'incorrect']);

const PreviousAttemptSchema = z
	.object({
		answer: z.string().max(80),
		result: JudgeStatusSchema,
		feedback: z.string().max(120)
	})
	.transform(({ answer, result, feedback }) => ({
		answer: normalizeShortText(answer),
		result,
		feedback: normalizeShortText(feedback)
	}));

const RequestSchema = z
	.object({
		blankId: z.string().min(1).max(64),
		answer: z.string().max(80),
		answers: z.record(z.string(), z.string().max(80)).optional().default({}),
		previousAttempts: z.array(PreviousAttemptSchema).max(8).optional().default([])
	})
	.transform(({ blankId, answer, answers, previousAttempts }) => ({
		blankId,
		answer: normalizeShortText(answer),
		answers: normalizeAnswerMap(answers),
		previousAttempts: previousAttempts.filter((attempt) => attempt.answer.length > 0).slice(-6)
	}));

const JudgeResponseSchema = z
	.object({
		result: JudgeStatusSchema,
		feedback: z.string().min(1).max(120)
	})
	.transform(({ result, feedback }) => ({
		result,
		feedback: normalizeShortText(feedback)
	}));

const GUIDE_JUDGE_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';
const NON_REVEALING_HINT_QUESTIONS: Readonly<Record<string, readonly string[]>> = {
	'heart-1': [
		'Where is the blood going back to?',
		'Which organ pumps blood around the body?',
		'Where does blood return before being pumped out again?'
	],
	low: [
		'Is the push from the heart strong in veins?',
		'Are veins pushed as strongly as arteries?',
		'What happens to pressure after blood leaves arteries?'
	],
	'backwards-1': [
		'Which way might blood slip if the push is weak?',
		'Would slipping blood keep going the right way?',
		'What direction problem do valves help prevent?'
	],
	'backwards-2': [
		'Which way do valves stop blood going?',
		'What wrong-way movement are valves blocking?',
		'What direction problem do valves prevent?'
	],
	'heart-2': [
		'Where should veins move blood towards?',
		'Look at the first sentence: where is blood going?',
		'Which destination matters for veins?'
	]
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.appUser) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	let body: z.infer<typeof RequestSchema>;
	try {
		body = RequestSchema.parse(await request.json());
	} catch {
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	const blank = GAP_BLANKS.find((entry) => entry.id === body.blankId);
	if (!blank) {
		return json({ error: 'unknown_blank' }, { status: 400 });
	}
	if (body.answer.length === 0) {
		return json({ result: 'incorrect', feedback: 'Type an answer first.' });
	}

	try {
		const result = await judgeBlankAnswer({
			blankId: body.blankId,
			answer: body.answer,
			answers: body.answers,
			expectedAnswer: blank.answer,
			placeholderPrompt: GAP_HINT_QUESTIONS[blank.id] ?? '',
			previousAttempts: body.previousAttempts,
			sentence: `${blank.before} ____${blank.after}`,
			worksheetContext: buildWorksheetContext(body.blankId, body.answers)
		});
		return json(result);
	} catch (error) {
		console.error('[guide-judge] failed to judge blank answer', error);
		return json({ error: 'judge_failed' }, { status: 500 });
	}
};

async function judgeBlankAnswer(input: {
	blankId: string;
	answer: string;
	answers: Record<string, string>;
	expectedAnswer: string;
	placeholderPrompt: string;
	previousAttempts: z.infer<typeof PreviousAttemptSchema>[];
	sentence: string;
	worksheetContext: string;
}): Promise<z.infer<typeof JudgeResponseSchema>> {
	preferGoogleServiceAccountAuthForGuideJudge();

	const result = await generateJson({
		modelId: GUIDE_JUDGE_MODEL_ID,
		contents: [
			{
				role: 'user',
				parts: [{ type: 'text', text: buildJudgePrompt(input) }]
			}
		],
		schema: JudgeResponseSchema,
		thinkingLevel: 'low',
		maxAttempts: 2
	});
	return {
		result: result.result,
		feedback: compactJudgeFeedback({
			result: result.result,
			feedback: result.feedback,
			blankId: input.blankId,
			expectedAnswer: input.expectedAnswer,
			previousAttempts: input.previousAttempts
		})
	};
}

function buildJudgePrompt(input: {
	blankId: string;
	answer: string;
	answers: Record<string, string>;
	expectedAnswer: string;
	placeholderPrompt: string;
	previousAttempts: z.infer<typeof PreviousAttemptSchema>[];
	sentence: string;
	worksheetContext: string;
}): string {
	return [
		'You are checking one short inline answer in a GCSE Biology worksheet.',
		'Judge only this blank, not the whole explanation.',
		'Use the worksheet context and previous attempts to understand the student misconception.',
		'Use this rubric:',
		'- correct: the answer gives the expected concept, allowing minor spelling errors or a clear synonym.',
		'- partial: the answer is related but too vague, incomplete, or slightly wrong.',
		'- incorrect: the answer is unrelated or contradicts the biology.',
		'If correct, feedback must be exactly: Correct.',
		'If partial or incorrect, feedback must be exactly one of the allowed guiding questions below.',
		'Choose the first allowed guiding question that has not already been used in previous attempts.',
		'Do not reveal the expected answer, a synonym, or the missing word in feedback.',
		'Do not write "the answer is", "use the word", or a cloze with the answer hidden.',
		'Return JSON only.',
		'',
		`Original question: ${ORIGINAL_QUESTION}`,
		'Worksheet context:',
		input.worksheetContext,
		`Sentence: ${input.sentence}`,
		`Prompt shown in the blank: ${input.placeholderPrompt}`,
		'Allowed guiding questions for partial/incorrect:',
		formatAllowedHintQuestions(input.blankId),
		`Previous attempts: ${formatPreviousAttempts(input)}`,
		`Private expected answer for judging only: ${input.expectedAnswer}`,
		`Student answer: ${input.answer}`
	].join('\n');
}

function compactJudgeFeedback(input: {
	result: z.infer<typeof JudgeResponseSchema>['result'];
	feedback: string;
	blankId: string;
	expectedAnswer: string;
	previousAttempts: z.infer<typeof PreviousAttemptSchema>[];
}): string {
	const { result, feedback, blankId, expectedAnswer, previousAttempts } = input;
	if (result === 'correct') {
		return 'Correct.';
	}

	const fallback = hintQuestionForBlank(blankId, previousAttempts);
	const cleaned = normalizeShortText(feedback);
	const safeFeedback =
		isAllowedHintQuestion(blankId, cleaned) && !revealsExpectedAnswer(cleaned, expectedAnswer)
			? cleaned
			: fallback;
	const question = safeFeedback.endsWith('?') ? safeFeedback : fallback;
	if (question.length <= 70) {
		return question;
	}

	const prefix = question.slice(0, 67);
	const spaceIndex = prefix.lastIndexOf(' ');
	const cutIndex = spaceIndex >= 42 ? spaceIndex : 67;
	const compacted = `${question.slice(0, cutIndex).trimEnd()}?`;
	if (revealsExpectedAnswer(compacted, expectedAnswer)) {
		return fallback;
	}
	return compacted;
}

function buildWorksheetContext(currentBlankId: string, answers: Record<string, string>): string {
	return GAP_BLANKS.map((blank) => {
		const answer = answers[blank.id] ?? '';
		const gapText =
			blank.id === currentBlankId
				? '____'
				: answer.length > 0
					? `[student wrote: "${answer.replaceAll('"', "'")}"]`
					: '[blank]';
		return `- ${blank.before} ${gapText}${blank.after}`;
	}).join('\n');
}

function formatPreviousAttempts(input: {
	blankId: string;
	expectedAnswer: string;
	previousAttempts: z.infer<typeof PreviousAttemptSchema>[];
}): string {
	if (input.previousAttempts.length === 0) {
		return 'None yet.';
	}
	return input.previousAttempts
		.map((attempt, index) => {
			const feedback = revealsExpectedAnswer(attempt.feedback, input.expectedAnswer)
				? hintQuestionForBlank(input.blankId, [])
				: attempt.feedback;
			return `${(index + 1).toString()}. "${attempt.answer}" -> ${attempt.result}; hint: ${feedback}`;
		})
		.join('\n');
}

function normalizeAnswerMap(answers: Record<string, string>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const blank of GAP_BLANKS) {
		normalized[blank.id] = normalizeShortText(answers[blank.id] ?? '');
	}
	return normalized;
}

function normalizeShortText(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function hintQuestionForBlank(
	blankId: string,
	previousAttempts: z.infer<typeof PreviousAttemptSchema>[]
): string {
	const hints = hintQuestionsForBlank(blankId);
	const usedHints = new Set(
		previousAttempts.map((attempt) => normalizeShortText(attempt.feedback).toLowerCase())
	);
	return (
		hints.find((hint) => !usedHints.has(hint.toLowerCase())) ??
		hints[Math.min(previousAttempts.length, hints.length - 1)] ??
		'What is the sentence asking you to decide?'
	);
}

function hintQuestionsForBlank(blankId: string): readonly string[] {
	return NON_REVEALING_HINT_QUESTIONS[blankId] ?? ['What is the sentence asking you to decide?'];
}

function formatAllowedHintQuestions(blankId: string): string {
	return hintQuestionsForBlank(blankId)
		.map((question) => `- ${question}`)
		.join('\n');
}

function isAllowedHintQuestion(blankId: string, feedback: string): boolean {
	const normalized = normalizeShortText(feedback).toLowerCase();
	return hintQuestionsForBlank(blankId).some((question) => question.toLowerCase() === normalized);
}

function revealsExpectedAnswer(feedback: string, expectedAnswer: string): boolean {
	const normalized = feedback.toLowerCase();
	for (const term of forbiddenFeedbackTerms(expectedAnswer)) {
		if (containsLooseTerm(normalized, term)) {
			return true;
		}
	}
	return false;
}

function forbiddenFeedbackTerms(expectedAnswer: string): string[] {
	const normalized = expectedAnswer.toLowerCase();
	if (normalized === 'heart') {
		return ['heart', 'hearts', 'cardiac'];
	}
	if (normalized === 'low') {
		return ['low', 'lower', 'not high', 'opposite of high'];
	}
	if (normalized === 'backwards') {
		return ['backwards', 'backward', 'back flow', 'back-flow', 'backflow', 'back'];
	}
	return [normalized];
}

function containsLooseTerm(text: string, term: string): boolean {
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function preferGoogleServiceAccountAuthForGuideJudge(): void {
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
