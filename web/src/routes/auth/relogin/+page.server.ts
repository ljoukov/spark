import { clearUserAuthCookie } from '$lib/server/auth/cookie';
import type { PageServerLoad } from './$types';

export const load = (async ({ cookies, url }) => {
	clearUserAuthCookie(cookies);
	const r = url.searchParams.get('r') || '/app';
	return { r };
}) satisfies PageServerLoad;
