import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getTutorSession } from '$lib/server/tutorSessions/repo';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const session = await getTutorSession(user.uid, params.sessionId);
	if (session?.source.kind === 'sheet') {
		throw redirect(302, `/spark/sheets/${session.source.runId}`);
	}
	throw redirect(302, '/spark/sheets');
};
