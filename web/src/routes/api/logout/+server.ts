import { json, type RequestHandler } from '@sveltejs/kit';

import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { clearAppSessionCookie } from '$lib/server/auth/sessionCookie';

export const POST: RequestHandler = async ({ cookies }) => {
	clearAppSessionCookie(cookies);
	cookies.delete(AUTH_TOKEN_COOKIE_NAME, { path: '/' });
	return json({ status: 'ok' });
};

