import { isUserAdmin } from '$lib/server/utils/admin';
import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { z } from 'zod';
import { type Handle, redirect } from '@sveltejs/kit';

if (typeof global !== 'undefined') {
	global.process.on('unhandledRejection', (reason, promise) => {
		console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	});
}

export const handle = (async ({ event, resolve }) => {
	// Initialize app user locals to a known state
	event.locals.appUser = null;
	// Lightweight auth context for `/app` — verify Firebase ID token cookie if present
	if (event.url.pathname.startsWith('/app')) {
		const raw = event.cookies.get(AUTH_TOKEN_COOKIE_NAME);
		const parsed = z.string().min(1).safeParse(raw);
		if (parsed.success) {
			try {
				const payload = await verifyFirebaseIdToken(parsed.data);
				event.locals.appUser = { uid: payload.sub, email: payload.email ?? null };
			} catch (e) {
				console.log('[app-auth] token verification failed');
			}
		}
	}

	if (event.url.pathname.startsWith('/admin')) {
		const raw = event.cookies.get(AUTH_TOKEN_COOKIE_NAME);
		const parsed = z.string().min(1).safeParse(raw);
		let hasValidToken = false;
		let isAdmin = false;
		if (parsed.success) {
			try {
				const payload = await verifyFirebaseIdToken(parsed.data);
				event.locals.appUser = { uid: payload.sub, email: payload.email ?? null };
				hasValidToken = true;
				isAdmin = isUserAdmin({ userId: payload.sub } as unknown as { userId: string });
			} catch (e) {
				console.log('[admin-auth] token verification failed');
			}
		}

		const p = event.url.pathname;
		const isAdminRoot = p === '/admin' || p === '/admin/';
		if (!isAdminRoot) {
			if (!hasValidToken || !isAdmin) {
				throw redirect(303, '/admin');
			}
		}
	}
	return await resolve(event);
}) satisfies Handle;
