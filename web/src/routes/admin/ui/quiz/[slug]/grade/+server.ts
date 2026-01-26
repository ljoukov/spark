import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getPreview, slugSchema } from '$lib/server/admin/quizPreviews';
import {
	gradeTypeAnswerStreaming,
	resolveGradingPrompt,
	resolveMarkScheme
} from '$lib/server/quiz/grading';
import { createSseStream, sseResponse } from '$lib/server/utils/sse';

const paramsSchema = z.object({
	slug: slugSchema
});

const requestSchema = z.object({
	questionId: z.string().trim().min(1, 'questionId is required'),
	answer: z.string().trim().min(1, 'answer is required')
});

export const POST: RequestHandler = async ({ params, request }) => {
	let slug: z.infer<typeof slugSchema>;
	try {
		slug = paramsSchema.parse(params).slug;
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_params', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_params', message: 'Invalid preview slug' }, { status: 400 });
	}

	let parsedBody: z.infer<typeof requestSchema>;
	try {
		parsedBody = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_body', message: 'Unable to parse request body' },
			{ status: 400 }
		);
	}

	const preview = getPreview(slug);
	const question = preview.quiz.questions.find((entry) => entry.id === parsedBody.questionId);
	if (!question || question.kind !== 'type-answer') {
		return json({ error: 'not_found', message: 'Question not found' }, { status: 404 });
	}

	const maxMarks = question.marks;
	if (typeof maxMarks !== 'number' || !Number.isFinite(maxMarks)) {
		return json(
			{ error: 'grading_unavailable', message: 'Mark scheme or grading prompt is missing' },
			{ status: 400 }
		);
	}

	const gradingPrompt = resolveGradingPrompt(preview.quiz.gradingPrompt);
	const markScheme = resolveMarkScheme(question.markScheme);

	const { stream, send, close } = createSseStream({ signal: request.signal });
	const response = sseResponse(stream);

	void (async () => {
		try {
			const grading = await gradeTypeAnswerStreaming(
				{
					gradingPrompt,
					markScheme,
					maxMarks,
					questionPrompt: question.prompt,
					modelAnswer: question.answer,
					studentAnswer: parsedBody.answer.trim(),
					maxAttempts: 3
				},
				(delta) => {
					send({
						event: delta.type === 'thought' ? 'thought' : 'text',
						data: delta.delta
					});
				}
			);

			send({
				event: 'done',
				data: JSON.stringify({
					status: 'ok',
					result: grading.result,
					awardedMarks: grading.awardedMarks,
					maxMarks: grading.maxMarks,
					feedback: grading.feedback,
					feedbackHtml: grading.feedbackHtml
				})
			});
		} catch (error) {
			console.error('Failed to grade admin preview response', {
				error,
				slug,
				questionId: parsedBody.questionId
			});
			send({
				event: 'error',
				data: JSON.stringify({
					error: 'grading_failed',
					message: 'Unable to grade this response right now'
				})
			});
		} finally {
			close();
		}
	})();

	return response;
};
