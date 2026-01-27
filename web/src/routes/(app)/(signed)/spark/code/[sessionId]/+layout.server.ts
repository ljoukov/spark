import { redirect, error } from '@sveltejs/kit';
import { getSession, getOrSelectCurrentSession } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import { getUserStats } from '$lib/server/user/repo';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(404, { message: 'Session id is required' });
	}

	const session = await getSession(user.uid, sessionId);
	if (!session) {
		const fallback = await getOrSelectCurrentSession(user.uid).catch(() => null);
		if (fallback && fallback.id !== sessionId) {
			throw redirect(302, `/spark/code/${fallback.id}`);
		}
		throw error(404, { message: 'Session not found' });
	}

	const stats = await getUserStats(user.uid);
	const sessionState = await getSessionState(user.uid, session.id);

	return {
		session,
		stats,
		userId: user.uid,
		sessionState
	};
};
