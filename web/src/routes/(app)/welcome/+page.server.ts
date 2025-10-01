import { redirect } from '@sveltejs/kit';
import { isTestUser } from '$lib/server/auth/testUser';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.appUser) {
		throw redirect(302, '/code');
	}

	return {
		authDisabled: isTestUser()
	};
};
