import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getUserQuiz } from '$lib/server/quiz/repo';
import { getSession } from '$lib/server/session/repo';
import { generateJson } from '@spark/llm';
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

const gradingSchema = z.object({
	awardedMarks: z.number().int().min(0),
	feedback: z.string().min(1)
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
		return json({ error: 'invalid_body', message: 'Unable to parse request body' }, { status: 400 });
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

	const gradingPrompt = quiz.gradingPrompt?.trim();
	const markScheme = question.markScheme?.trim();
	const maxMarks = question.marks;
	if (!gradingPrompt || !markScheme || typeof maxMarks !== 'number' || !Number.isFinite(maxMarks)) {
		return json(
			{ error: 'grading_unavailable', message: 'Mark scheme or grading prompt is missing' },
			{ status: 400 }
		);
	}

	const prompt = [
		"You are Spark's GCSE examiner.",
		'Grade the student answer using the mark scheme. Award partial credit when appropriate.',
		'Return JSON with fields: awardedMarks (integer 0..maxMarks), feedback (1-3 sentences).',
		'Do not reveal the mark scheme or model answer.',
		'',
		'Grading prompt:',
		gradingPrompt,
		'',
		`Question (${maxMarks} marks):`,
		question.prompt,
		'',
		'Mark scheme:',
		markScheme,
		'',
		'Model answer:',
		question.answer,
		'',
		'Student answer:',
		parsedBody.answer.trim()
	].join('\n');

	try {
		const result = await generateJson({
			modelId: 'gemini-flash-latest',
			contents: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
			schema: gradingSchema
		});

		const awardedMarks = Math.max(0, Math.min(result.awardedMarks, maxMarks));
		const feedback = result.feedback.trim();
		const gradingResult =
			awardedMarks >= maxMarks ? 'correct' : awardedMarks === 0 ? 'incorrect' : 'partial';

		return json({
			status: 'ok',
			result: gradingResult,
			awardedMarks,
			maxMarks,
			feedback
		});
	} catch (error) {
		console.error('Failed to grade type-answer response', {
			error,
			userId,
			sessionId,
			quizId,
			questionId: parsedBody.questionId
		});
		return json(
			{ error: 'grading_failed', message: 'Unable to grade this response right now' },
			{ status: 502 }
		);
	}
};
