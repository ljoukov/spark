// Experimental page: server-side gate for /app area using Firebase ID token cookie.
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { z } from 'zod';
import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	console.log(`[app/hello] → GET ${url.pathname}${url.search}`);
	const hasCookie = typeof cookies.get(AUTH_TOKEN_COOKIE_NAME) === 'string';
	console.log(`[app/hello] token cookie present: ${hasCookie}`);

	if (!locals.appUser) {
		console.log('[app/hello] not signed in — returning 401');
		throw error(401, 'Not signed in');
	}

	const parsed = z
		.object({ uid: z.string().min(1), email: z.string().nullable().optional() })
		.parse(locals.appUser);

	console.log(`[app/hello] signed in: uid=${parsed.uid} email=${parsed.email ?? 'null'}`);
	return { uid: parsed.uid, email: parsed.email ?? null };
};
