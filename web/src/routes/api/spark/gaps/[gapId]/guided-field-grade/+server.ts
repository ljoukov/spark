import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getLearningGap } from '$lib/server/gaps/repo';
import { fallbackGuidedPresentation } from '$lib/spark/gaps/guidedPresentation';
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateJson, type LlmTextModelId } from '@spark/llm';
import { z } from 'zod';

const paramsSchema = z.object({
	gapId: z.string().trim().min(1, 'gapId is required')
});

const judgeStatusSchema = z.enum(['correct', 'partial', 'incorrect']);

const previousAttemptSchema = z
	.object({
		answer: z.string().max(220),
		result: judgeStatusSchema,
		feedback: z.string().max(220)
	})
	.transform(({ answer, result, feedback }) => ({
		answer: normalizeShortText(answer),
		result,
		feedback: normalizeShortText(feedback)
	}));

const requestSchema = z
	.object({
		questionId: z.string().trim().min(1).max(80),
		answer: z.string().max(220),
		answers: z.record(z.string(), z.string().max(220)).optional().default({}),
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
		feedback: z.string().min(1).max(180)
	})
	.transform(({ result, feedback }) => ({
		result,
		feedback: normalizeShortText(feedback)
	}));

const GUIDED_FIELD_JUDGE_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';
const FALLBACK_HINTS = [
	'Which clue in the question points to this step?',
	'What changes from the previous step in the chain?',
	'How does this step connect to the next idea?',
	'What key cause-and-effect link is needed here?'
] as const;
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

	const presentation = gap.presentations?.v17 ?? fallbackGuidedPresentation(gap);
	const question = presentation.questions.find((entry) => entry.id === body.questionId);
	if (!question) {
		return json({ error: 'not_found', message: 'Guided question not found' }, { status: 404 });
	}
	if (body.answer.length === 0) {
		return json({ status: 'ok', result: 'incorrect', feedback: 'Type an answer first.' });
	}

	try {
		const result = await judgeGuidedFieldAnswer({
			questionId: body.questionId,
			answer: body.answer,
			answers: body.answers,
			expectedAnswer: question.expectedAnswer,
			questionText: question.question,
			shownHint: question.hint ?? '',
			previousAttempts: body.previousAttempts,
			guidedPath: buildGuidedPath({
				currentQuestionId: body.questionId,
				questions: presentation.questions,
				answers: body.answers
			}),
			practiceQuestion: presentation.question,
			memoryChain: presentation.memoryChain,
			modelAnswer: presentation.modelAnswer,
			sourceQuestion: gap.source.questionPrompt ?? gap.cardQuestion
		});
		return json({ status: 'ok', ...result });
	} catch (error) {
		console.error('[gap-guided-field-grade] failed to judge guided field answer', {
			error,
			gapId,
			questionId: body.questionId,
			userId: authResult.user.uid
		});
		return json({ error: 'judge_failed' }, { status: 500 });
	}
};

async function judgeGuidedFieldAnswer(input: {
	questionId: string;
	answer: string;
	answers: Record<string, string>;
	expectedAnswer: string;
	questionText: string;
	shownHint: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
	guidedPath: string;
	practiceQuestion: string;
	memoryChain: string;
	modelAnswer: string;
	sourceQuestion: string;
}): Promise<z.infer<typeof judgeResponseSchema>> {
	preferGoogleServiceAccountAuthForGuidedFieldJudge();

	const result = await generateJson({
		modelId: GUIDED_FIELD_JUDGE_MODEL_ID,
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
				questionText: input.questionText,
				shownHint: input.shownHint,
				fallbackHint: fallbackHintQuestion(input),
				previousAttempts: input.previousAttempts
			})
	};
}

function buildJudgePrompt(input: {
	answer: string;
	expectedAnswer: string;
	questionText: string;
	shownHint: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
	guidedPath: string;
	practiceQuestion: string;
	memoryChain: string;
	modelAnswer: string;
	sourceQuestion: string;
}): string {
	return [
		'You are checking one short guided answer in a GCSE practice gap.',
		'Judge only this one guided question, not the final written answer.',
		'The practice question and guided question may include Markdown or LaTeX; interpret the content, not the markup.',
		'Use the whole guided path and all previous student replies to understand the misconception.',
		'Use this rubric:',
		'- correct: the answer gives the expected concept, allowing minor spelling errors or a clear synonym.',
		'- correct answers may be short fragments; do not require a full sentence.',
		'- if the guided question asks for a comparison or choice, the key comparative word or phrase can be enough.',
		'- partial: the answer is related but too vague, incomplete, or slightly wrong.',
		'- incorrect: the answer is unrelated or contradicts the subject knowledge.',
		'Do not mark an answer partial just because it omits nouns already present in the guided question.',
		'If correct, feedback must be exactly: Correct.',
		'If partial or incorrect, feedback must be one short guiding question under 140 characters.',
		'Feedback is shown under a one-line field: use plain text only, no Markdown, no LaTeX, no bullets, and no line breaks. Unicode symbols are OK if useful.',
		'Make the hint more guided than earlier hints for this same field, using the previous attempts.',
		'The initial hint is already visible; do not reuse it or closely paraphrase it.',
		'Avoid vague hints like "where?" on their own; ask a complete guiding question.',
		'Stay on the current guided question; do not ask about a later step unless the current question asks for it.',
		'If a later guided question covers direction or destination, do not use that as feedback for the current field.',
		'Do not reveal the expected answer, a synonym, or a close paraphrase in feedback.',
		'Do not repeat the guided question or the student answer back to the student.',
		'Do not write "the answer is", "use the word", or a cloze with the answer hidden.',
		'Return JSON only.',
		'',
		`Source question: ${input.sourceQuestion}`,
		`Practice question: ${input.practiceQuestion}`,
		`Memory chain: ${input.memoryChain}`,
		`Current guided question: ${input.questionText}`,
		`Initial hint shown to student: ${input.shownHint || 'None.'}`,
		`Previous attempts for this field: ${formatPreviousAttempts(input)}`,
		'Guided path with other student replies:',
		input.guidedPath,
		`Private model answer for context: ${input.modelAnswer}`,
		`Private expected answer for this field, for judging only: ${input.expectedAnswer}`,
		`Student answer for this field: ${input.answer}`
	].join('\n');
}

function compactJudgeFeedback(input: {
	result: z.infer<typeof judgeResponseSchema>['result'];
	feedback: string;
	expectedAnswer: string;
	questionText: string;
	shownHint: string;
	fallbackHint: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	if (input.result === 'correct') {
		return 'Correct.';
	}

	const cleaned = normalizeShortText(input.feedback);
	const isSafe =
		cleaned.length > 0 &&
		!usesBannedHintPattern(cleaned) &&
		!tooSimilarToDisplayedHint(cleaned, input.questionText, input.shownHint, input.previousAttempts) &&
		!revealsExpectedAnswer(cleaned, input.expectedAnswer, input.questionText);
	const candidate = isSafe
		? cleaned
		: nextFallbackHint({
				fallbackHint: input.fallbackHint,
				expectedAnswer: input.expectedAnswer,
				questionText: input.questionText,
				shownHint: input.shownHint,
				previousAttempts: input.previousAttempts
			});
	const hint = candidate.endsWith('?') ? candidate : `${candidate.replace(/[.!]+$/u, '')}?`;
	if (
		hint.length <= 140 &&
		!usesBannedHintPattern(hint) &&
		!tooSimilarToDisplayedHint(hint, input.questionText, input.shownHint, input.previousAttempts) &&
		!revealsExpectedAnswer(hint, input.expectedAnswer, input.questionText)
	) {
		return hint;
	}
	return nextFallbackHint({
		fallbackHint: input.fallbackHint,
		expectedAnswer: input.expectedAnswer,
		questionText: input.questionText,
		shownHint: input.shownHint,
		previousAttempts: input.previousAttempts
	});
}

function buildGuidedPath(input: {
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
			return [
				`${(index + 1).toString()}. ${question.question}`,
				`   Student wrote: ${studentAnswer}`,
				`   Private expected answer: ${question.expectedAnswer}`
			].join('\n');
		})
		.join('\n');
}

function formatPreviousAttempts(input: {
	expectedAnswer: string;
	questionText: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	if (input.previousAttempts.length === 0) {
		return 'None yet.';
	}
	return input.previousAttempts
		.map((attempt, index) => {
			const feedback = revealsExpectedAnswer(
				attempt.feedback,
				input.expectedAnswer,
				input.questionText
			)
				? 'What clue in this step narrows the idea?'
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

function fallbackHintQuestion(input: {
	expectedAnswer: string;
	questionText: string;
	shownHint: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	const contextualHint = contextualFallbackHint(input);
	return nextFallbackHint({
		fallbackHint: contextualHint,
		expectedAnswer: input.expectedAnswer,
		questionText: input.questionText,
		shownHint: input.shownHint,
		previousAttempts: input.previousAttempts
	});
}

function contextualFallbackHint(input: { questionText: string; shownHint: string }): string {
	const combined = `${input.questionText} ${input.shownHint}`.toLowerCase();
	if (
		combined.includes('wrong way') ||
		combined.includes('backward') ||
		combined.includes('backwards') ||
		combined.includes('backflow')
	) {
		return 'What has to be prevented before blood can keep moving correctly?';
	}
	if (combined.includes('higher') || combined.includes('lower') || combined.includes('compare')) {
		return 'Which side of the comparison fits this step?';
	}
	if (
		combined.includes('direction') ||
		combined.includes('destination') ||
		combined.includes('towards') ||
		combined.includes('toward')
	) {
		return 'Where should the process be heading at this step?';
	}
	if (
		combined.includes('cause') ||
		combined.includes('happen') ||
		combined.includes('problem') ||
		combined.includes('effect')
	) {
		return 'What is the next cause-and-effect link in the chain?';
	}
	if (combined.includes('why')) {
		return 'Which earlier idea explains this step?';
	}
	return FALLBACK_HINTS[0];
}

function nextFallbackHint(input: {
	fallbackHint: string;
	expectedAnswer: string;
	questionText: string;
	shownHint: string;
	previousAttempts: z.infer<typeof previousAttemptSchema>[];
}): string {
	const candidates = [input.fallbackHint, ...FALLBACK_HINTS].map((hint) =>
		hint.endsWith('?') ? hint : `${hint.replace(/[.!]+$/u, '')}?`
	);
	const used = new Set(input.previousAttempts.map((attempt) => attempt.feedback.toLowerCase()));
	for (const candidate of candidates) {
		if (
			!used.has(candidate.toLowerCase()) &&
			!usesBannedHintPattern(candidate) &&
			!tooSimilarToDisplayedHint(
				candidate,
				input.questionText,
				input.shownHint,
				input.previousAttempts
			) &&
			!revealsExpectedAnswer(candidate, input.expectedAnswer, input.questionText)
		) {
			return candidate;
		}
	}
	return 'What clue in this step narrows the idea?';
}

function usesBannedHintPattern(feedback: string): boolean {
	const normalized = feedback.toLowerCase();
	return (
		/(?:\r|\n|\${1,2}|\\\(|\\\[|`|\*\*|__|^\s{0,3}#{1,6}\s|^\s*[-*+]\s+)/mu.test(
			feedback
		) ||
		normalized.includes('the answer is') ||
		normalized.includes('answer should') ||
		normalized.includes('use the word') ||
		normalized.includes('write the word')
	);
}

function tooSimilarToDisplayedHint(
	feedback: string,
	questionText: string,
	shownHint: string,
	previousAttempts: z.infer<typeof previousAttemptSchema>[]
): boolean {
	const candidate = comparableText(feedback);
	if (candidate.length === 0) {
		return false;
	}
	const blockedTexts = [
		questionText,
		shownHint,
		...previousAttempts.map((attempt) => attempt.feedback)
	].filter((text) => text.trim().length > 0);
	for (const text of blockedTexts) {
		const blocked = comparableText(text);
		if (candidate === blocked) {
			return true;
		}
		if (meaningfulOverlap(candidate, blocked) >= 0.78) {
			return true;
		}
	}
	return false;
}

function comparableText(value: string): string {
	return normalizeShortText(value.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' '));
}

function meaningfulOverlap(left: string, right: string): number {
	const leftTerms = meaningfulTerms(left);
	const rightTerms = meaningfulTerms(right);
	if (leftTerms.length < 3 || rightTerms.length < 3) {
		return 0;
	}
	const rightSet = new Set(rightTerms);
	const shared = leftTerms.filter((term) => rightSet.has(term)).length;
	return shared / Math.min(leftTerms.length, rightTerms.length);
}

function meaningfulTerms(value: string): string[] {
	return value
		.split(/[\s-]+/u)
		.map((term) => term.trim())
		.filter((term) => term.length >= 4 && !STOPWORDS.has(term));
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
