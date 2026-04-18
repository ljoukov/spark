import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getLearningGap } from '$lib/server/gaps/repo';
import { gradeTypeAnswer, resolveGradingPrompt, resolveMarkScheme } from '$lib/server/quiz/grading';
import { fallbackGuidedPresentation } from '$lib/spark/gaps/guidedPresentation';
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateJson, type LlmTextModelId } from '@spark/llm';
import type { AnnotatedTextAnnotation, AnnotatedTextDocument } from '$lib/components/annotated-text';
import { z } from 'zod';

const paramsSchema = z.object({
	gapId: z.string().trim().min(1, 'gapId is required')
});

const requestSchema = z
	.object({
		answer: z.string().trim().min(1, 'answer is required').max(4000),
		guidedAnswers: z.record(z.string(), z.string().max(400)).optional().default({})
	})
	.transform(({ answer, guidedAnswers }) => ({
		answer: answer.trim(),
		guidedAnswers: Object.fromEntries(
			Object.entries(guidedAnswers).map(([key, value]) => [key, normalizeWhitespace(value)])
		)
	}));

const rawAnnotationSchema = z.object({
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	type: z.enum(['strength', 'missing', 'unclear']),
	label: z.string().trim().min(1).max(32),
	comment: z.string().trim().min(1).max(260)
});

const judgeResponseSchema = z.object({
	awardedMarks: z.number().int().nonnegative(),
	summary: z.string().trim().min(1).max(260),
	annotations: z.array(rawAnnotationSchema).max(8)
});

const GUIDED_GAP_JUDGE_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';

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
	const maxMarks = resolveMaxMarks(presentation);

	try {
		const judgeInput = {
			answer: body.answer,
			guidedAnswers: body.guidedAnswers,
			question: presentation.question,
			guidedQuestions: presentation.questions,
			memoryChain: presentation.memoryChain,
			modelAnswer: presentation.modelAnswer,
			markScheme: presentation.markScheme,
			maxMarks,
			sourceQuestion: gap.source.questionPrompt ?? gap.cardQuestion
		};
		let result: z.infer<typeof judgeResponseSchema>;
		try {
			result = await judgeGuidedAnswer(judgeInput);
		} catch (error) {
			console.warn('[gap-guided-grade] JSON judge failed; using plain-text grading fallback', {
				error,
				gapId,
				userId: authResult.user.uid
			});
			result = await judgeGuidedAnswerFallback(judgeInput);
		}
		const awardedMarks = Math.min(maxMarks, Math.max(0, result.awardedMarks));
		const document = buildAnnotatedDocument({
			answer: body.answer,
			annotations: sanitizeAnnotations(result.annotations, body.answer, awardedMarks >= maxMarks),
			summary: result.summary,
			awardedMarks,
			maxMarks
		});
		return json(
			{
				status: 'ok',
				awardedMarks,
				maxMarks,
				summary: result.summary,
				document
			},
			{ status: 200 }
		);
	} catch (error) {
		console.error('[gap-guided-grade] failed to judge guided answer', {
			error,
			gapId,
			userId: authResult.user.uid
		});
		return json(
			{ error: 'judge_failed', message: 'Unable to check this answer right now' },
			{ status: 500 }
		);
	}
};

async function judgeGuidedAnswer(input: {
	answer: string;
	guidedAnswers: Record<string, string>;
	question: string;
	guidedQuestions: Array<{
		id: string;
		question: string;
		expectedAnswer: string;
		hint?: string;
		maxMarks?: number;
	}>;
	memoryChain: string;
	modelAnswer: string;
	markScheme?: string;
	maxMarks: number;
	sourceQuestion: string;
}): Promise<z.infer<typeof judgeResponseSchema>> {
	preferGoogleServiceAccountAuthForGuidedJudge();

	return generateJson({
		modelId: GUIDED_GAP_JUDGE_MODEL_ID,
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
}

async function judgeGuidedAnswerFallback(input: {
	answer: string;
	question: string;
	memoryChain: string;
	modelAnswer: string;
	markScheme?: string;
	maxMarks: number;
}): Promise<z.infer<typeof judgeResponseSchema>> {
	const grading = await gradeTypeAnswer({
		gradingPrompt: resolveGradingPrompt(
			'Grade the final written answer against the practice gap. Reward the causal links in the memory chain.'
		),
		markScheme: resolveMarkScheme(
			input.markScheme ??
				`Award marks for the correct causal links in this chain: ${input.memoryChain}`
		),
		maxMarks: input.maxMarks,
		questionPrompt: input.question,
		modelAnswer: input.modelAnswer,
		studentAnswer: input.answer,
		maxAttempts: 2
	});
	const fullMarks = grading.awardedMarks >= grading.maxMarks;
	return {
		awardedMarks: grading.awardedMarks,
		summary: summarizePlainFeedback({
			feedback: grading.feedback,
			awardedMarks: grading.awardedMarks,
			maxMarks: grading.maxMarks,
			fullMarks
		}),
		annotations: [
			{
				start: 0,
				end: Math.min(input.answer.length, Math.max(1, input.answer.length)),
				type: fullMarks ? 'strength' : 'unclear',
				label: fullMarks ? 'Credit' : 'Review',
				comment: fullMarks
					? 'This covers the required causal chain clearly.'
					: 'Use the memory chain to add any missing causal links before trying again.'
			}
		]
	};
}

function buildJudgePrompt(input: {
	answer: string;
	guidedAnswers: Record<string, string>;
	question: string;
	guidedQuestions: Array<{
		id: string;
		question: string;
		expectedAnswer: string;
		hint?: string;
		maxMarks?: number;
	}>;
	memoryChain: string;
	modelAnswer: string;
	markScheme?: string;
	maxMarks: number;
	sourceQuestion: string;
}): string {
	return [
		'You are checking one GCSE practice-gap answer.',
		'Grade the final written answer only. The guided answers are context for the learner pathway.',
		`Award 0 to ${input.maxMarks.toString()} marks.`,
		'Use the model answer and mark scheme strictly, but allow equivalent wording.',
		'Return JSON only.',
		'',
		'Annotation rules:',
		'- Use exact character offsets into the student answer string.',
		'- type "strength" for accurate parts that earn credit.',
		'- type "missing" for a span near where an important missing link should be added.',
		'- type "unclear" for vague or incorrect wording.',
		'- For partial or zero marks, do not paste the model answer or write a replacement sentence.',
		'- Keep comments short, specific, and useful for a retry.',
		'- If the answer is full marks, use only strength annotations.',
		'',
		`Source question: ${input.sourceQuestion}`,
		`Practice question: ${input.question}`,
		`Memory chain: ${input.memoryChain}`,
		`Private model answer: ${input.modelAnswer}`,
		`Private mark scheme: ${input.markScheme ?? 'Award marks for the causal links in the model answer.'}`,
		'Guided question path:',
		formatGuidedQuestionPath(input),
		'Student guided answers:',
		formatGuidedAnswers(input),
		'Student final answer with character offsets:',
		formatAnswerWithOffsets(input.answer)
	].join('\n');
}

function summarizePlainFeedback(input: {
	feedback: string;
	awardedMarks: number;
	maxMarks: number;
	fullMarks: boolean;
}): string {
	const plain = input.feedback
		.replace(/[#*_>`-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (plain.length > 0) {
		return plain.slice(0, 220);
	}
	if (input.fullMarks) {
		return 'This is a full-mark answer with the required causal links.';
	}
	return `This answer earns ${input.awardedMarks.toString()}/${input.maxMarks.toString()}; add the missing causal links and try again.`;
}

function formatGuidedQuestionPath(input: {
	guidedQuestions: Array<{
		id: string;
		question: string;
		expectedAnswer: string;
		hint?: string;
		maxMarks?: number;
	}>;
}): string {
	return input.guidedQuestions
		.map(
			(question, index) =>
				`${(index + 1).toString()}. ${question.question} Expected: ${question.expectedAnswer}`
		)
		.join('\n');
}

function formatGuidedAnswers(input: {
	guidedQuestions: Array<{ id: string; question: string }>;
	guidedAnswers: Record<string, string>;
}): string {
	return input.guidedQuestions
		.map((question, index) => {
			const answer = input.guidedAnswers[question.id] ?? '';
			return `${(index + 1).toString()}. ${question.question} Student wrote: ${answer || '[blank]'}`;
		})
		.join('\n');
}

function formatAnswerWithOffsets(answer: string): string {
	const lines: string[] = [];
	for (let index = 0; index < answer.length; index += 80) {
		const chunk = answer.slice(index, index + 80);
		lines.push(`[${index.toString()}..${(index + chunk.length).toString()}] ${chunk}`);
	}
	return lines.join('\n');
}

function resolveMaxMarks(presentation: { maxMarks?: number; questions: Array<{ maxMarks?: number }> }): number {
	if (presentation.maxMarks !== undefined) {
		return presentation.maxMarks;
	}
	return Math.min(
		8,
		Math.max(
			1,
			presentation.questions.reduce((total, question) => total + (question.maxMarks ?? 1), 0)
		)
	);
}

function sanitizeAnnotations(
	rawAnnotations: z.infer<typeof rawAnnotationSchema>[],
	answer: string,
	fullMarks: boolean
): AnnotatedTextAnnotation[] {
	const sorted = [...rawAnnotations].sort((left, right) => left.start - right.start);
	const annotations: AnnotatedTextAnnotation[] = [];
	let cursor = 0;
	for (const annotation of sorted) {
		const start = Math.min(answer.length, Math.max(0, annotation.start));
		const end = Math.min(answer.length, Math.max(start, annotation.end));
		if (end <= start || start < cursor) {
			continue;
		}
		const type = fullMarks && annotation.type !== 'strength' ? 'strength' : annotation.type;
		annotations.push({
			id: `annotation-${annotations.length + 1}`,
			start,
			end,
			type,
			label: normalizeWhitespace(annotation.label),
			comment: normalizeWhitespace(annotation.comment)
		});
		cursor = end;
	}
	if (annotations.length > 0 || answer.length === 0) {
		return annotations;
	}
	const sentenceEnd = answer.search(/[.!?]\s/u);
	const end = sentenceEnd >= 0 ? Math.min(answer.length, sentenceEnd + 1) : Math.min(answer.length, 80);
	return [
		{
			id: 'annotation-1',
			start: 0,
			end,
			type: fullMarks ? 'strength' : 'unclear',
			label: fullMarks ? 'Credit' : 'Review',
			comment: fullMarks
				? 'This earns credit because it answers the question clearly.'
				: 'Check which causal link from the chain is missing or unclear.'
		}
	];
}

function buildAnnotatedDocument(input: {
	answer: string;
	annotations: AnnotatedTextAnnotation[];
	summary: string;
	awardedMarks: number;
	maxMarks: number;
}): AnnotatedTextDocument {
	const annotationTypes = {
		strength: {
			label: 'Credit',
			lightColor: '#1f8d62',
			lightBackground: '#edf9f3',
			lightBorderColor: '#9bd9bb',
			darkColor: '#8ce0b5',
			darkBackground: '#1b2a21',
			darkBorderColor: '#3d8b65'
		},
		missing: {
			label: 'Missing',
			lightColor: '#a76b16',
			lightBackground: '#fff7df',
			lightBorderColor: '#e6c77c',
			darkColor: '#ffd37a',
			darkBackground: '#302715',
			darkBorderColor: '#7a5b1c'
		},
		unclear: {
			label: 'Unclear',
			lightColor: '#ad4d33',
			lightBackground: '#fff0eb',
			lightBorderColor: '#e4aa98',
			darkColor: '#ffb5a3',
			darkBackground: '#321d19',
			darkBorderColor: '#8b4a3b'
		}
	};
	const usedTypes = new Set(input.annotations.map((annotation) => annotation.type));
	return {
		heading: 'Annotated answer',
		description: `${input.awardedMarks.toString()}/${input.maxMarks.toString()} marks. ${input.summary}`,
		text: input.answer,
		annotations: input.annotations,
		annotationTypes: Object.fromEntries(
			Object.entries(annotationTypes).filter(([type]) => usedTypes.has(type))
		)
	};
}

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function preferGoogleServiceAccountAuthForGuidedJudge(): void {
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
