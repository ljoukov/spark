import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getLearningGap } from '$lib/server/gaps/repo';
import { gradeTypeAnswer, resolveGradingPrompt, resolveMarkScheme } from '$lib/server/quiz/grading';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z.object({
	gapId: z.string().trim().min(1, 'gapId is required')
});

const requestSchema = z.object({
	stepId: z.string().trim().min(1, 'stepId is required'),
	answer: z.string().trim().min(1, 'answer is required')
});

export const POST: RequestHandler = async ({ params, request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

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

	const gap = await getLearningGap(userId, gapId);
	if (!gap) {
		return json({ error: 'not_found', message: 'Gap not found' }, { status: 404 });
	}

	const step = gap.steps.find((entry) => entry.id === body.stepId);
	if (!step || step.kind !== 'free_text') {
		return json({ error: 'not_found', message: 'Free-text step not found' }, { status: 404 });
	}

	try {
		const grading = await gradeTypeAnswer({
			gradingPrompt: resolveGradingPrompt(step.gradingPrompt),
			markScheme: resolveMarkScheme(step.markScheme),
			maxMarks: step.maxMarks,
			questionPrompt: step.prompt,
			modelAnswer: step.modelAnswer,
			studentAnswer: body.answer.trim(),
			maxAttempts: 3
		});
		return json(
			{
				status: 'ok',
				result: grading.result,
				awardedMarks: grading.awardedMarks,
				maxMarks: grading.maxMarks,
				feedback: grading.feedback
			},
			{ status: 200 }
		);
	} catch (error) {
		console.error('Failed to grade gap free-text step', {
			error,
			userId,
			gapId,
			stepId: body.stepId
		});
		return json(
			{ error: 'grading_failed', message: 'Unable to grade this response right now' },
			{ status: 500 }
		);
	}
};
