import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function resolveRedirectTarget(url: URL): string {
	const raw = url.searchParams.get('redirectTo');
	if (!raw) {
		return '/spark';
	}
	if (!raw.startsWith('/') || raw.startsWith('//')) {
		return '/spark';
	}
	if (raw.includes('\n') || raw.includes('\r')) {
		return '/spark';
	}
	return raw;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.appUser) {
		throw redirect(302, resolveRedirectTarget(url));
	}
	return {};
};

