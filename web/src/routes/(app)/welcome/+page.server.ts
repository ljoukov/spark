import { redirect } from '@sveltejs/kit';
import { isTestUser } from '$lib/server/auth/testUser';
import type { PageServerLoad } from './$types';

const coerceDestination = (value: string | null): 'code' | 'spark' | null => {
	if (value === 'code' || value === 'spark') {
		return value;
	}
	return null;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const destination = coerceDestination(url.searchParams.get('destination'));

	if (locals.appUser && destination) {
		throw redirect(302, destination === 'code' ? '/code' : '/spark');
	}

	return {
		authDisabled: isTestUser(),
		destination,
		alreadyAuthenticated: Boolean(locals.appUser)
	};
};
