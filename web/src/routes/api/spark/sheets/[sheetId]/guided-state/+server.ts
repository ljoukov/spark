import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	loadSheetGuidedContext,
	mergeGuidedState,
	persistSheetGuidedReviewState
} from '$lib/server/tutorSessions/sheetGuided';
import { SparkTutorGuidedStateSchema, SparkTutorReviewStateSchema } from '@spark/schemas';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	questionId: z.string().trim().min(1),
	state: SparkTutorGuidedStateSchema
});

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
	if (!thread) {
		return json({ error: 'question_not_found' }, { status: 404 });
	}

	const now = new Date();
	const guidedState = mergeGuidedState({
		current: thread.guidedState,
		next: body.state,
		now
	});
	const nextReviewState = SparkTutorReviewStateSchema.parse({
		...context.reviewState,
		threads: {
			...context.reviewState.threads,
			[body.questionId]: {
				...thread,
				guidedState
			}
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
		guidedState,
		reviewState: nextReviewState
	});
};
