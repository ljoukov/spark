import { redirect, error } from '@sveltejs/kit';
import { getSession, getOrSelectCurrentSession, saveSession, setCurrentSessionId } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import { getUserStats } from '$lib/server/user/repo';
import { getBundleBySessionId } from '$lib/data/adventSessions';
import type { SessionState } from '@spark/schemas';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/welcome');
	}

	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(404, { message: 'Session id is required' });
	}

	const adventBundle = getBundleBySessionId(sessionId);

	let session = adventBundle ? await getSession(user.uid, sessionId) : null;
	if (adventBundle && !session) {
		// Persist the static bundle once per user so normal progress flows work.
		const copy = {
			...adventBundle.session,
			createdAt: new Date()
		};
		await saveSession(user.uid, copy);
		await setCurrentSessionId(user.uid, copy.id).catch(() => {});
		session = copy;
	}

	if (!session) {
		session = await getSession(user.uid, sessionId);
	}
	if (!session) {
		const fallback = await getOrSelectCurrentSession(user.uid).catch(() => null);
		if (fallback && fallback.id !== sessionId) {
			throw redirect(302, `/code/${fallback.id}`);
		}
		throw error(404, { message: 'Session not found' });
	}

	const stats = await getUserStats(user.uid);
	let sessionState: SessionState;
	if (adventBundle) {
		const items = Object.fromEntries(
			(adventBundle.session.plan ?? []).map((item) => [item.id, { status: 'not_started' as const }])
		);
		sessionState = {
			sessionId: session.id,
			items,
			lastUpdatedAt: new Date()
		};
	} else {
		sessionState = await getSessionState(user.uid, session.id);
	}

	return {
		session,
		stats,
		userId: user.uid,
		sessionState
	};
};
