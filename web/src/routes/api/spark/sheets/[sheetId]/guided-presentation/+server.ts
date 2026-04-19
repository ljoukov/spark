import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	buildSheetGuidedQuestionContext,
	loadSheetGuidedContext,
	mergeGuidedState,
	persistSheetGuidedReviewState,
	type SheetGuidedQuestionContext
} from '$lib/server/tutorSessions/sheetGuided';
import { generateJson, type LlmTextModelId } from '@spark/llm';
import {
	SparkLearningGapGuidedPresentationSchema,
	SparkTutorReviewStateSchema,
	type SparkLearningGapGuidedPresentation
} from '@spark/schemas';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	questionId: z.string().trim().min(1)
});

const generatedGuidedQuestionSchema = z.object({
	id: z.string().trim().min(1),
	question: z.string().trim().min(1),
	expectedAnswer: z.string().trim().min(1),
	hint: z.string().trim().min(1),
	maxMarks: z.number().int().min(1).max(4)
});

const generatedPresentationSchema = z.object({
	question: z.string().trim().min(1),
	instructions: z.string().trim().min(1),
	questions: z.array(generatedGuidedQuestionSchema).min(2).max(12),
	memoryChain: z.string().trim().min(1),
	answerPrompt: z.string().trim().min(1),
	modelAnswer: z.string().trim().min(1),
	markScheme: z.string().trim().min(1),
	maxMarks: z.number().int().min(1).max(12)
});

const presentationGenerationResponseSchema = z.object({
	presentation: generatedPresentationSchema,
	prefilledAnswers: z.record(z.string(), z.string().max(400))
});

type PresentationResponse = {
	presentation: SparkLearningGapGuidedPresentation;
	prefilledAnswers: Record<string, string>;
};

const GUIDED_PRESENTATION_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';

export const POST: RequestHandler = async ({ params, request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let parsedParams: z.infer<typeof paramsSchema>;
	let body: z.infer<typeof requestSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
		body = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
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

	const thread = context.reviewState.threads[body.questionId];
	const questionContext = buildSheetGuidedQuestionContext({
		report: context.report,
		questionId: body.questionId
	});
	if (!thread || !questionContext) {
		return json({ error: 'question_not_found' }, { status: 404 });
	}
	if (thread.guidedPresentation) {
		return json({
			ok: true,
			sessionId: context.sessionId,
			presentation: thread.guidedPresentation,
			guidedState: thread.guidedState ?? null,
			reviewState: context.reviewState
		});
	}

	const targetStepCount = resolveTargetStepCount(questionContext.marks);
	let generated: PresentationResponse;
	try {
		preferGoogleServiceAccountAuthForGuidedPresentation();
		const rawGenerated = await generateJson({
			modelId: GUIDED_PRESENTATION_MODEL_ID,
			contents: [
				{
					role: 'user',
					parts: [
						{
							type: 'text',
							text: buildPresentationPrompt({
								targetStepCount,
								questionContext
							})
						}
					]
				}
			],
			schema: presentationGenerationResponseSchema,
			thinkingLevel: 'low',
			maxAttempts: 2
		});
		generated = {
			presentation: SparkLearningGapGuidedPresentationSchema.parse(rawGenerated.presentation),
			prefilledAnswers: rawGenerated.prefilledAnswers
		};
	} catch (error) {
		console.warn('[sheet-guided-presentation] generation failed; using fallback', {
			error,
			userId: authResult.user.uid,
			sheetId: parsedParams.sheetId,
			questionId: body.questionId
		});
		generated = buildFallbackPresentation({
			targetStepCount,
			questionContext
		});
	}

	const now = new Date();
	const guidedState = mergeGuidedState({
		current: thread.guidedState,
		prefillAnswers: generated.prefilledAnswers,
		now
	});
	const nextThread = {
		...thread,
		guidedPresentation: generated.presentation,
		guidedState
	};
	const nextReviewState = SparkTutorReviewStateSchema.parse({
		...context.reviewState,
		threads: {
			...context.reviewState.threads,
			[body.questionId]: nextThread
		},
		updatedAt: now.toISOString()
	});
	await persistSheetGuidedReviewState({
		context,
		reviewState: nextReviewState,
		now
	});

	return json({
		ok: true,
		sessionId: context.sessionId,
		presentation: generated.presentation,
		guidedState,
		reviewState: nextReviewState
	});
};

function resolveTargetStepCount(marks: number): number {
	return Math.min(12, Math.max(2, Math.ceil(marks * 1.5)));
}

function buildPresentationPrompt(options: {
	targetStepCount: number;
	questionContext: SheetGuidedQuestionContext;
}): string {
	const context = options.questionContext;
	return [
		'Create a Spark guided answer-builder for one science worksheet feedback item.',
		'Return JSON only.',
		'The UI is a step-by-step "Build the answer" page followed by a required full-answer page.',
		`Create ${options.targetStepCount.toString()} short guided fields, aiming for 1-2 fields per available mark.`,
		'Each guided field should be a small reasoning check that leads to the final answer.',
		'Use question ids guided-1, guided-2, and so on.',
		'Each field question, expectedAnswer, and hint must be one short plain-text line.',
		'Each hint should be broad and non-revealing because later runtime hints get more direct.',
		'The modelAnswer should be concise, correct, and mark-scheme aligned.',
		'The memoryChain should be a compact chain of key ideas separated by ->.',
		'Prefill a guided field only when the submitted answer clearly already shows that exact idea. Do not prefill guesses.',
		'Always include prefilledAnswers; use an empty object when no guided field should be prefilled.',
		'Never prefill the full written answer.',
		'',
		`Sheet: ${context.sheetTitle}`,
		`Subject: ${context.subject}`,
		`Level: ${context.level}`,
		`Section: ${context.sectionLabel}`,
		`Question: ${context.questionLabel}`,
		`Marks: ${context.marks.toString()}`,
		context.score
			? `Current score: ${context.score.got.toString()}/${context.score.total.toString()}`
			: 'Current score: not available',
		'',
		'Problem shown to the student:',
		context.questionPrompt,
		'',
		'Student submitted answer:',
		context.studentAnswer,
		'',
		'Review note shown on the worksheet:',
		context.reviewNote || '(none)',
		'',
		'Focused repair prompt:',
		context.replyPlaceholder ?? '(none)',
		'',
		'Additional grader note:',
		context.followUp ?? '(none)',
		'',
		'Private answer/reference context:',
		context.privateReferenceContext
	].join('\n');
}

function splitAnswerParts(value: string, targetStepCount: number): string[] {
	const normalized = value.trim().replace(/\s+/g, ' ');
	if (!normalized) {
		return [];
	}
	const sentenceParts = normalized
		.split(/(?<=[.!?])\s+|;\s+|\s+->\s+/u)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (sentenceParts.length >= 2) {
		return sentenceParts.slice(0, targetStepCount);
	}
	return normalized
		.split(/\s*,\s+|\s+and\s+/u)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.slice(0, targetStepCount);
}

function buildFallbackPresentation(options: {
	targetStepCount: number;
	questionContext: SheetGuidedQuestionContext;
}): PresentationResponse {
	const context = options.questionContext;
	const source =
		context.modelAnswer ??
		context.followUp ??
		context.reviewNote ??
		'Use the missing reasoning from the review note.';
	const parts = splitAnswerParts(source, options.targetStepCount);
	const safeParts =
		parts.length >= 2
			? parts
			: [
					'Identify the key idea the question is testing.',
					'Link that idea back to the wording of the question.'
				];
	const questions = safeParts.slice(0, options.targetStepCount).map((part, index) => ({
		id: `guided-${(index + 1).toString()}`,
		question:
			index === 0
				? 'What is the first key idea needed here?'
				: 'What should the next linked idea be?',
		expectedAnswer: part,
		hint:
			index === 0
				? 'What clue in the question starts the chain?'
				: 'What follows from the previous idea?',
		maxMarks: 1
	}));
	const presentation: SparkLearningGapGuidedPresentation =
		SparkLearningGapGuidedPresentationSchema.parse({
			question: context.questionPrompt,
			instructions: 'Answer each guiding question in a short phrase.',
			questions,
			memoryChain: safeParts.join(' -> '),
			answerPrompt: 'Now combine those ideas into a full answer.',
			modelAnswer: source,
			markScheme: context.privateReferenceContext,
			maxMarks: Math.min(12, Math.max(1, context.marks))
		});
	return {
		presentation,
		prefilledAnswers: {}
	};
}

function preferGoogleServiceAccountAuthForGuidedPresentation(): void {
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
