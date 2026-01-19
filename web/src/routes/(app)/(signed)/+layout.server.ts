import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

const inferDestination = (pathname: string): 'code' | 'spark' | 'chat' | null => {
	if (pathname.startsWith('/c')) {
		return 'chat';
	}
	if (pathname.startsWith('/code')) {
		return 'code';
	}
	if (pathname.startsWith('/spark')) {
		return 'spark';
	}
	return null;
};

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const user = locals.appUser;
	if (!user) {
		const destination = inferDestination(url.pathname);
		if (destination === 'chat') {
			throw redirect(302, '/');
		}
		const params = new URLSearchParams();
		if (destination) {
			params.set('destination', destination);
		}
		const query = params.toString();
		throw redirect(302, query.length > 0 ? `/?${query}` : '/');
	}
	return { user };
};
