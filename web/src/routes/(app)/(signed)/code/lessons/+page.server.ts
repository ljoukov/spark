import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import { listSessions } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const LESSON_LIST_LIMIT = 50;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/welcome');
	}

	const sessions = await listSessions(user.uid, LESSON_LIST_LIMIT);
	const states = await Promise.all(
		sessions.map((session) => getSessionState(user.uid, session.id))
	);

	const lessons = sessions.map((session, index) => {
		const state = states[index];
		const { completed, total } = countCompletedSteps(session, state);
		const status = deriveLessonStatus(session, state);
		return {
			id: session.id,
			title: session.title,
			tagline: session.tagline ?? session.summary ?? null,
			emoji: session.emoji ?? '📘',
			status,
			createdAt: session.createdAt.toISOString(),
			completed,
			total
		};
	});

	return { lessons };
};
