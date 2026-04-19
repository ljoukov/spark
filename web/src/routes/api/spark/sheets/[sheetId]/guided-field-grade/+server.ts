import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	buildSheetGuidedQuestionContext,
	loadSheetGuidedContext,
	sheetGuidedQuestionQuerySchema
} from '$lib/server/tutorSessions/sheetGuided';
import { generateJson, type LlmTextModelId } from '@spark/llm';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const judgeStatusSchema = z.enum(['correct', 'partial', 'incorrect']);

const previousAttemptSchema = z
	.object({
		answer: z.string().max(400),
		result: judgeStatusSchema,
		feedback: z.string().max(400)
	})
	.transform(({ answer, result, feedback }) => ({
		answer: normalizeShortText(answer),
		result,
		feedback: normalizeShortText(feedback)
	}));

const requestSchema = z
	.object({
		questionId: z.string().trim().min(1).max(80),
		answer: z.string().max(400),
		answers: z.record(z.string(), z.string().max(400)).optional().default({}),
		previousAttempts: z.array(previousAttemptSchema).max(8).optional().default([])
	})
	.transform(({ questionId, answer, answers, previousAttempts }) => ({
		questionId,
		answer: normalizeShortText(answer),
		answers: normalizeAnswerMap(answers),
		previousAttempts: previousAttempts.filter((attempt) => attempt.answer.length > 0).slice(-6)
	}));

const judgeResponseSchema = z
	.object({
		result: judgeStatusSchema,
		feedback: z.string().min(1).max(240)
	})
	.transform(({ result, feedback }) => ({
		result,
		feedback: normalizeShortText(feedback)
	}));

const GUIDED_FIELD_JUDGE_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';
const STOPWORDS = new Set([
	'about',
	'after',
	'answer',
	'because',
	'before',
	'between',
	'could',
	'does',
	'from',
	'have',
	'into',
	'more',
	'that',
	'than',
	'their',
	'then',
	'there',
	'these',
	'this',
	'when',
	'where',
	'which',
	'with',
	'would',
	'your'
]);

export const POST: RequestHandler = async ({ params, request, url }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let parsedParams: z.infer<typeof paramsSchema>;
	let query: z.infer<typeof sheetGuidedQuestionQuerySchema>;
	let body: z.infer<typeof requestSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
		query = sheetGuidedQuestionQuerySchema.parse({
			questionId: url.searchParams.get('questionId')
		});
		body = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	if (body.answer.length === 0) {
		return json({ status: 'ok', result: 'incorrect', feedback: 'Type an answer first.' });
	}

	let context;
	try {
		context = await loadSheetGuidedContext({
			userId: authResult.user.uid,
			sheetId: parsedParams.sheetId
		});
	} catch (error) {
		if (error instanceof Error && error.message === 'sheet_not_ready') {
			return json({ error: 'sheet_not_ready' }, { status: 409 });
		}
		if (error instanceof Error && error.message === 'sheet_invalid') {
			return json({ error: 'sheet_invalid' }, { status: 500 });
		}
		throw error;
	}
	if (!context) {
		return json({ error: 'sheet_not_found' }, { status: 404 });
	}

	const thread = context.reviewState.threads[query.questionId];
	const questionContext = buildSheetGuidedQuestionContext({
		report: context.report,
		questionId: query.questionId
	});
	const presentation = thread?.guidedPresentation;
	const guidedQuestion = presentation?.questions.find((entry) => entry.id === body.questionId);
	if (!thread || !questionContext || !presentation || !guidedQuestion) {
		return json({ error: 'guided_question_not_found' }, { status: 404 });
	}

	try {
		const hintStage = Math.min(4, body.previousAttempts.length + 1);
		preferGoogleServiceAccountAuthForGuidedFieldJudge();
		const result = await generateJson({
			modelId: GUIDED_FIELD_JUDGE_MODEL_ID,
			contents: [
				{
					role: 'user',
					parts: [
						{
							type: 'text',
							text: buildJudgePrompt({
								answer: body.answer,
								answers: body.answers,
								previousAttempts: body.previousAttempts,
								hintStage,
								guidedQuestion,
								presentation,
								questionContext
							})
						}
					]
				}
			],
			schema: judgeResponseSchema,
			thinkingLevel: 'low',
			maxAttempts: 2
		});
		return json({
			status: 'ok',
			result: result.result,
			feedback: compactJudgeFeedback({
				result: result.result,
				feedback: result.feedback,
				expectedAnswer: guidedQuestion.expectedAnswer,
				questionText: guidedQuestion.question,
				hintStage,
				previousAttempts: body.previousAttempts
			})
		});
	} catch (error) {
		console.error('[sheet-guided-field-grade] failed to judge guided field answer', {
			error,
			userId: authResult.user.uid,
			sheetId: parsedParams.sheetId,
			questionId: query.questionId,
			guidedQuestionId: body.questionId
		});
		return json({ error: 'judge_failed' }, { status: 500 });
	}
};

function buildJudgePrompt(input: {
	answer: string;
	answers: Record<string, string>;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
	hintStage: number;
	guidedQuestion: { id: string; question: string; expectedAnswer: string; hint?: string };
	presentation: {
		question: string;
		memoryChain: string;
		modelAnswer: string;
		questions: Array<{ id: string; question: string; expectedAnswer: string }>;
	};
	questionContext: NonNullable<ReturnType<typeof buildSheetGuidedQuestionContext>>;
}): string {
	return [
		'You are checking one short guided answer in a worksheet answer-builder.',
		'Judge only this one guided field, not the final written answer.',
		'Return JSON only.',
		'Use this rubric:',
		'- correct: the answer gives the expected concept, allowing minor spelling errors or a clear synonym.',
		'- partial: the answer is related but vague, incomplete, or slightly wrong.',
		'- incorrect: the answer is unrelated or contradicts the needed science.',
		'If correct, feedback must be exactly: Correct.',
		'If partial or incorrect, write one conversational hint, no Markdown, no bullets, no line breaks.',
		'Hint stages:',
		'1. Broad: provoke deeper thinking and relationships. Do not reveal answer words.',
		'2. Closer: narrow the choice, often with "or" options. Avoid a copyable answer.',
		'3. Very close: make the answer fairly obvious, but keep it as a prompt rather than a sentence to copy.',
		'4. Reveal: name the key idea or ingredients, but ask the learner to connect them in their own words.',
		`Use hint stage ${input.hintStage.toString()} for this response.`,
		'',
		`Sheet: ${input.questionContext.sheetTitle}`,
		`Problem: ${input.questionContext.questionPrompt}`,
		`Student submitted answer: ${input.questionContext.studentAnswer}`,
		`Review note: ${input.questionContext.reviewNote}`,
		`Answer-builder question: ${input.presentation.question}`,
		`Memory chain: ${input.presentation.memoryChain}`,
		`Private model answer: ${input.presentation.modelAnswer}`,
		`Current guided question: ${input.guidedQuestion.question}`,
		`Initial broad hint shown: ${input.guidedQuestion.hint ?? 'None.'}`,
		`Private expected answer for this field: ${input.guidedQuestion.expectedAnswer}`,
		'Other guided answers:',
		formatGuidedPath({
			currentQuestionId: input.guidedQuestion.id,
			questions: input.presentation.questions,
			answers: input.answers
		}),
		'Previous attempts for this field:',
		formatPreviousAttempts(input.previousAttempts),
		`Student answer for this field: ${input.answer}`
	].join('\n');
}

function compactJudgeFeedback(input: {
	result: z.infer<typeof judgeResponseSchema>['result'];
	feedback: string;
	expectedAnswer: string;
	questionText: string;
	hintStage: number;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	if (input.result === 'correct') {
		return 'Correct.';
	}
	const cleaned = normalizeShortText(input.feedback);
	const exactReveal = containsLooseTerm(
		cleaned.toLowerCase(),
		normalizeShortText(input.expectedAnswer.toLowerCase())
	);
	if (input.hintStage >= 4) {
		return revealHint(input.expectedAnswer);
	}
	if (cleaned.length === 0 || usesBannedHintPattern(cleaned)) {
		return fallbackHint(input);
	}
	if (
		input.hintStage <= 2 &&
		revealsExpectedAnswer(cleaned, input.expectedAnswer, input.questionText)
	) {
		return fallbackHint(input);
	}
	if (input.hintStage === 3 && exactReveal) {
		return closeHint(input.expectedAnswer);
	}
	const hint =
		cleaned.endsWith('?') || input.hintStage >= 3 ? cleaned : `${cleaned.replace(/[.!]+$/u, '')}?`;
	if (hint.length <= 220) {
		return hint;
	}
	return hint.slice(0, 217).trimEnd() + '...';
}

function fallbackHint(input: {
	hintStage: number;
	expectedAnswer: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	const used = new Set(input.previousAttempts.map((attempt) => attempt.feedback.toLowerCase()));
	const candidates = [
		'What relationship in the question tells you what changes first?',
		closeHint(input.expectedAnswer),
		revealHint(input.expectedAnswer)
	];
	for (const candidate of candidates) {
		if (!used.has(candidate.toLowerCase())) {
			if (input.hintStage <= 1 && candidate === candidates[0]) {
				return candidate;
			}
			if (input.hintStage === 2 && candidate === candidates[1]) {
				return candidate;
			}
			if (input.hintStage >= 3) {
				return candidate;
			}
		}
	}
	return input.hintStage >= 3 ? revealHint(input.expectedAnswer) : candidates[0];
}

function closeHint(expectedAnswer: string): string {
	const terms = answerTerms(expectedAnswer).slice(0, 3);
	if (terms.length === 0) {
		return 'Which option best fits this step: cause, effect, or evidence?';
	}
	if (terms.length === 1) {
		return `Is this step about ${terms[0]} or a different idea?`;
	}
	return `Is this step about ${terms.join(' or ')}? Pick the one that fits and link it back.`;
}

function revealHint(expectedAnswer: string): string {
	const terms = answerTerms(expectedAnswer).slice(0, 4);
	if (terms.length === 0) {
		return 'Use the key idea from the model answer, then explain the link in your own words.';
	}
	return `You need the idea of ${terms.join(' + ')}. Now connect that idea to the question in your own words.`;
}

function answerTerms(expectedAnswer: string): string[] {
	return normalizeShortText(expectedAnswer.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' '))
		.split(/[\s-]+/u)
		.map((term) => term.trim())
		.filter((term) => term.length >= 4 && !STOPWORDS.has(term));
}

function formatGuidedPath(input: {
	currentQuestionId: string;
	questions: Array<{ id: string; question: string; expectedAnswer: string }>;
	answers: Record<string, string>;
}): string {
	return input.questions
		.map((question, index) => {
			const answer = input.answers[question.id] ?? '';
			const studentAnswer =
				question.id === input.currentQuestionId
					? '[current field]'
					: answer.length > 0
						? `"${answer.replaceAll('"', "'")}"`
						: '[blank]';
			return `${(index + 1).toString()}. ${question.question}\n   Student wrote: ${studentAnswer}\n   Private expected answer: ${question.expectedAnswer}`;
		})
		.join('\n');
}

function formatPreviousAttempts(previousAttempts: z.infer<typeof previousAttemptSchema>[]): string {
	if (previousAttempts.length === 0) {
		return 'None yet.';
	}
	return previousAttempts
		.map(
			(attempt, index) =>
				`${(index + 1).toString()}. "${attempt.answer}" -> ${attempt.result}; hint: ${attempt.feedback}`
		)
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

function usesBannedHintPattern(feedback: string): boolean {
	const normalized = feedback.toLowerCase();
	return (
		/(?:\r|\n|\${1,2}|\\\(|\\\[|`|\*\*|__|^\s{0,3}#{1,6}\s|^\s*[-*+]\s+)/mu.test(feedback) ||
		normalized.includes('the answer is') ||
		normalized.includes('answer should') ||
		normalized.includes('copy this') ||
		normalized.includes('paste this')
	);
}

function revealsExpectedAnswer(
	feedback: string,
	expectedAnswer: string,
	questionText: string
): boolean {
	const normalized = feedback.toLowerCase();
	for (const term of forbiddenFeedbackTerms(expectedAnswer, questionText)) {
		if (containsLooseTerm(normalized, term)) {
			return true;
		}
	}
	return false;
}

function forbiddenFeedbackTerms(expectedAnswer: string, questionText: string): string[] {
	const normalizedAnswer = expectedAnswer.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ');
	const normalizedQuestion = questionText.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ');
	const wholeAnswer = normalizeShortText(normalizedAnswer);
	const questionTerms = new Set(
		normalizeShortText(normalizedQuestion)
			.split(/[\s-]+/u)
			.filter((term) => term.length > 0)
	);
	const terms = wholeAnswer
		.split(/[\s-]+/u)
		.map((term) => term.trim())
		.filter(
			(term) =>
				term.length >= 4 &&
				!STOPWORDS.has(term) &&
				(!questionTerms.has(term) || wholeAnswer === term)
		);
	return Array.from(new Set([wholeAnswer, ...terms].filter((term) => term.length > 0)));
}

function containsLooseTerm(text: string, term: string): boolean {
	if (term.length === 0) {
		return false;
	}
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

function preferGoogleServiceAccountAuthForGuidedFieldJudge(): void {
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
