import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getUserQuiz } from '$lib/server/quiz/repo';
import { getSession } from '$lib/server/session/repo';
import {
	gradeTypeAnswerStreaming,
	resolveGradingPrompt,
	resolveMarkScheme
} from '$lib/server/quiz/grading';
import { createSseStream, sseResponse } from '$lib/server/utils/sse';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z.object({
	sessionId: z.string().trim().min(1, 'sessionId is required'),
	quizId: z.string().trim().min(1, 'quizId is required')
});

const requestSchema = z.object({
	questionId: z.string().trim().min(1, 'questionId is required'),
	answer: z.string().trim().min(1, 'answer is required')
});

export const POST: RequestHandler = async ({ params, request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let sessionId: string;
	let quizId: string;
	try {
		const parsed = paramsSchema.parse(params);
		sessionId = parsed.sessionId;
		quizId = parsed.quizId;
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_params', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_params', message: 'Invalid route params' }, { status: 400 });
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

	const session = await getSession(userId, sessionId);
	if (!session) {
		return json({ error: 'not_found', message: 'Session not found' }, { status: 404 });
	}

	const planItem = session.plan.find((item) => item.kind === 'quiz' && item.id === quizId);
	if (!planItem) {
		return json({ error: 'not_found', message: 'Quiz not found in session plan' }, { status: 404 });
	}

	const quiz = await getUserQuiz(userId, sessionId, quizId);
	if (!quiz) {
		return json({ error: 'not_found', message: 'Quiz definition not found' }, { status: 404 });
	}

	const question = quiz.questions.find((entry) => entry.id === parsedBody.questionId);
	if (!question || question.kind !== 'type-answer') {
		return json({ error: 'not_found', message: 'Question not found' }, { status: 404 });
	}

	const gradingPrompt = resolveGradingPrompt(quiz.gradingPrompt);
	const markScheme = resolveMarkScheme(question.markScheme);
	const maxMarks = question.marks;
	if (typeof maxMarks !== 'number' || !Number.isFinite(maxMarks)) {
		return json(
			{ error: 'grading_unavailable', message: 'Mark scheme or grading prompt is missing' },
			{ status: 400 }
		);
	}

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
			console.error('Failed to grade type-answer response', {
				error,
				userId,
				sessionId,
				quizId,
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
