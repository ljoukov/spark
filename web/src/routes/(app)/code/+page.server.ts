import { redirect } from '@sveltejs/kit';
import { getOrSelectCurrentSession } from '$lib/server/session/repo';
import type { PageServerLoad } from './$types';
import type { Session } from '@spark/schemas';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/welcome');
	}

	let session: Session | undefined;
	try {
		session = await getOrSelectCurrentSession(user.uid);
	} catch (error) {
		console.error('Unable to resolve session for redirect', error);
		throw redirect(302, '/welcome');
	}
	throw redirect(302, `/code/${session.id}`);
};
