import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getLearningGap } from '$lib/server/gaps/repo';
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateJson, type LlmTextModelId } from '@spark/llm';
import { z } from 'zod';

const paramsSchema = z.object({
	gapId: z.string().trim().min(1, 'gapId is required')
});

const judgeStatusSchema = z.enum(['correct', 'partial', 'incorrect']);

const previousAttemptSchema = z
	.object({
		answer: z.string().max(160),
		result: judgeStatusSchema,
		feedback: z.string().max(160)
	})
	.transform(({ answer, result, feedback }) => ({
		answer: normalizeShortText(answer),
		result,
		feedback: normalizeShortText(feedback)
	}));

const requestSchema = z
	.object({
		blankId: z.string().trim().min(1).max(80),
		answer: z.string().max(160),
		answers: z.record(z.string(), z.string().max(160)).optional().default({}),
		previousAttempts: z.array(previousAttemptSchema).max(8).optional().default([])
	})
	.transform(({ blankId, answer, answers, previousAttempts }) => ({
		blankId,
		answer: normalizeShortText(answer),
		answers: normalizeAnswerMap(answers),
		previousAttempts: previousAttempts.filter((attempt) => attempt.answer.length > 0).slice(-6)
	}));

const judgeResponseSchema = z
	.object({
		result: judgeStatusSchema,
		feedback: z.string().min(1).max(160)
	})
	.transform(({ result, feedback }) => ({
		result,
		feedback: normalizeShortText(feedback)
	}));

const INLINE_GAP_JUDGE_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';

export const POST: RequestHandler = async ({ params, request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let gapId: string;
	try {
		gapId = paramsSchema.parse(params).gapId;
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_params', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_params', message: 'Invalid route params' }, { status: 400 });
	}

	let body: z.infer<typeof requestSchema>;
	try {
		body = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_body', message: 'Unable to parse request body' },
			{ status: 400 }
		);
	}

	const gap = await getLearningGap(authResult.user.uid, gapId);
	if (!gap) {
		return json({ error: 'not_found', message: 'Gap not found' }, { status: 404 });
	}

	const presentation = gap.presentations?.v11;
	const blank = presentation?.blanks.find((entry) => entry.id === body.blankId);
	if (!presentation || !blank) {
		return json({ error: 'not_found', message: 'Inline blank not found' }, { status: 404 });
	}
	if (body.answer.length === 0) {
		return json({ status: 'ok', result: 'incorrect', feedback: 'Type an answer first.' });
	}

	try {
		const result = await judgeInlineBlankAnswer({
			blankId: body.blankId,
			answer: body.answer,
			answers: body.answers,
			expectedAnswer: blank.expectedAnswer,
			blankPrompt: blank.prompt ?? '',
			previousAttempts: body.previousAttempts,
			sentence: `${blank.before} ____${blank.after}`,
			worksheetContext: buildWorksheetContext({
				currentBlankId: body.blankId,
				blanks: presentation.blanks,
				answers: body.answers
			}),
			question: presentation.question,
			modelAnswer: presentation.modelAnswer,
			sourceQuestion: gap.source.questionPrompt ?? gap.cardQuestion
		});
		return json({ status: 'ok', ...result });
	} catch (error) {
		console.error('[gap-inline-grade] failed to judge blank answer', {
			error,
			gapId,
			blankId: body.blankId,
			userId: authResult.user.uid
		});
		return json({ error: 'judge_failed' }, { status: 500 });
	}
};

async function judgeInlineBlankAnswer(input: {
	blankId: string;
	answer: string;
	answers: Record<string, string>;
	expectedAnswer: string;
	blankPrompt: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
	sentence: string;
	worksheetContext: string;
	question: string;
	modelAnswer: string;
	sourceQuestion: string;
}): Promise<z.infer<typeof judgeResponseSchema>> {
	preferGoogleServiceAccountAuthForInlineJudge();

	const result = await generateJson({
		modelId: INLINE_GAP_JUDGE_MODEL_ID,
		contents: [
			{
				role: 'user',
				parts: [{ type: 'text', text: buildJudgePrompt(input) }]
			}
		],
		schema: judgeResponseSchema,
		thinkingLevel: 'low',
		maxAttempts: 2
	});

	return {
		result: result.result,
		feedback: compactJudgeFeedback({
			result: result.result,
			feedback: result.feedback,
			expectedAnswer: input.expectedAnswer,
			fallbackHint: fallbackHintQuestion(input),
			previousAttempts: input.previousAttempts
		})
	};
}

function buildJudgePrompt(input: {
	blankId: string;
	answer: string;
	expectedAnswer: string;
	blankPrompt: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
	sentence: string;
	worksheetContext: string;
	question: string;
	modelAnswer: string;
	sourceQuestion: string;
}): string {
	return [
		'You are checking one short inline answer in a GCSE practice worksheet.',
		'Judge only this blank, not the whole explanation.',
		'Use the worksheet context and previous attempts to understand the student misconception.',
		'Use this rubric:',
		'- correct: the answer gives the expected concept, allowing minor spelling errors or a clear synonym.',
		'- partial: the answer is related but too vague, incomplete, or slightly wrong.',
		'- incorrect: the answer is unrelated or contradicts the subject knowledge.',
		'If correct, feedback must be exactly: Correct.',
		'If partial or incorrect, feedback must be one short guiding question under 120 characters.',
		'Do not reveal the expected answer, a synonym, or the missing word in feedback.',
		'Do not write "the answer is", "use the word", or a cloze with the answer hidden.',
		'Return JSON only.',
		'',
		`Source question: ${input.sourceQuestion}`,
		`Gap question: ${input.question}`,
		'Worksheet context:',
		input.worksheetContext,
		`Sentence: ${input.sentence}`,
		`Prompt shown in the blank: ${input.blankPrompt}`,
		`Previous attempts: ${formatPreviousAttempts(input)}`,
		`Private model answer for context: ${input.modelAnswer}`,
		`Private expected answer for judging only: ${input.expectedAnswer}`,
		`Student answer: ${input.answer}`
	].join('\n');
}

function compactJudgeFeedback(input: {
	result: z.infer<typeof judgeResponseSchema>['result'];
	feedback: string;
	expectedAnswer: string;
	fallbackHint: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	if (input.result === 'correct') {
		return 'Correct.';
	}

	const cleaned = normalizeShortText(input.feedback);
	const safeFeedback =
		cleaned.length > 0 && !revealsExpectedAnswer(cleaned, input.expectedAnswer)
			? cleaned
			: nextFallbackHint(input.fallbackHint, input.previousAttempts);
	const hint = safeFeedback.endsWith('?') ? safeFeedback : `${safeFeedback.replace(/[.!]+$/u, '')}?`;
	if (hint.length <= 120 && !revealsExpectedAnswer(hint, input.expectedAnswer)) {
		return hint;
	}
	return nextFallbackHint(input.fallbackHint, input.previousAttempts);
}

function buildWorksheetContext(input: {
	currentBlankId: string;
	blanks: Array<{ id: string; before: string; after: string }>;
	answers: Record<string, string>;
}): string {
	return input.blanks
		.map((blank) => {
			const answer = input.answers[blank.id] ?? '';
			const gapText =
				blank.id === input.currentBlankId
					? '____'
					: answer.length > 0
						? `[student wrote: "${answer.replaceAll('"', "'")}"]`
						: '[blank]';
			return `- ${blank.before} ${gapText}${blank.after}`;
		})
		.join('\n');
}

function formatPreviousAttempts(input: {
	expectedAnswer: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	if (input.previousAttempts.length === 0) {
		return 'None yet.';
	}
	return input.previousAttempts
		.map((attempt, index) => {
			const feedback = revealsExpectedAnswer(attempt.feedback, input.expectedAnswer)
				? 'What clue in the sentence narrows the idea?'
				: attempt.feedback;
			return `${(index + 1).toString()}. "${attempt.answer}" -> ${attempt.result}; hint: ${feedback}`;
		})
		.join('\n');
}

function normalizeAnswerMap(answers: Record<string, string>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(answers)) {
		normalized[key] = normalizeShortText(value);
	}
	return normalized;
}

function normalizeShortText(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function fallbackHintQuestion(input: { blankPrompt: string; sentence: string }): string {
	const prompt = normalizeShortText(input.blankPrompt);
	if (prompt.endsWith('?')) {
		return prompt;
	}
	if (prompt.length > 0) {
		return `${prompt.replace(/[.!]+$/u, '')}?`;
	}
	if (input.sentence.length > 0) {
		return 'What idea makes this sentence accurate?';
	}
	return 'What key idea does this blank need?';
}

function nextFallbackHint(
	fallbackHint: string,
	previousAttempts: z.infer<typeof previousAttemptSchema>[]
): string {
	const fallback = fallbackHint.endsWith('?') ? fallbackHint : `${fallbackHint}?`;
	const used = new Set(previousAttempts.map((attempt) => attempt.feedback.toLowerCase()));
	if (!used.has(fallback.toLowerCase())) {
		return fallback;
	}
	return 'What key idea does this blank need?';
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
	const normalized = expectedAnswer.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ');
	const wholeAnswer = normalizeShortText(normalized);
	const terms = wholeAnswer
		.split(/[\s-]+/u)
		.map((term) => term.trim())
		.filter((term) => term.length >= 3);
	return Array.from(new Set([wholeAnswer, ...terms].filter((term) => term.length > 0)));
}

function containsLooseTerm(text: string, term: string): boolean {
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

function preferGoogleServiceAccountAuthForInlineJudge(): void {
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
