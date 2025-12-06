import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { adventBundles, getBundleByDay, getBundleBySessionId } from '$lib/data/adventSessions';
import { saveSession, setCurrentSessionId } from '$lib/server/session/repo';
import { saveUserProblem } from '$lib/server/code/problemRepo';
import { saveUserQuiz } from '$lib/server/quiz/repo';

const bodySchema = z.object({
	day: z.number().int().min(1).max(adventBundles.length).optional(),
	sessionId: z.string().trim().min(1).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const auth = await authenticateApiRequest(request);
	if (!auth.ok) {
		return auth.response;
	}
	const userId = auth.user.uid;

	let parsed;
	try {
		parsed = bodySchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const bundle =
		(parsed.day ? getBundleByDay(parsed.day) : undefined) ??
		(parsed.sessionId ? getBundleBySessionId(parsed.sessionId) : undefined);

	if (!bundle) {
		return json({ error: 'not_found', message: 'Advent bundle not found' }, { status: 404 });
	}

	// Persist session, quizzes, and problems for this user so normal flows work
	const sessionToSave = { ...bundle.session, createdAt: new Date() };
	await saveSession(userId, sessionToSave);
	await setCurrentSessionId(userId, sessionToSave.id).catch(() => {});

	for (const quiz of bundle.quizzes) {
		await saveUserQuiz(userId, sessionToSave.id, quiz);
	}
	for (const problem of bundle.problems) {
		await saveUserProblem(userId, sessionToSave.id, problem);
	}

	return json({ status: 'ok', sessionId: sessionToSave.id });
};
