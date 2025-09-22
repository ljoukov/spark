import { isUserAdmin } from '$lib/server/utils/admin';
import { getUserAuthFromCookiesResult, hasUserAuthCookie } from '$lib/server/auth/cookie';
import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { z } from 'zod';
import { type Handle } from '@sveltejs/kit';

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
		const redirectParams = new URLSearchParams({ r: event.url.pathname });
		const cookies = event.cookies;
		if (!hasUserAuthCookie(cookies)) {
			console.log(
				`Admin request without auth cookie, redirecting to /auth/start then to ${event.url.pathname}`
			);
			return Response.redirect(event.url.origin + '/auth/start?' + redirectParams.toString(), 307);
		}
		const authResult = await getUserAuthFromCookiesResult(cookies);
		switch (authResult.status) {
			case 'ok':
				if (!isUserAdmin(authResult.userAuth)) {
					console.log(
						`/admin request from logged in not administrator: userId=${authResult.userAuth.userId}`
					);
					return new Response('Not an administrator', { status: 401 });
				}
				break;
			case 'error':
				console.log(
					`Admin request with expired cookie, forwarding to /auth/redirect then to ${event.url.pathname}`
				);
				// To avoid redirect loops we forward the user to the screen with explicit login button
				return Response.redirect(event.url.origin + '/auth/relogin?' + redirectParams, 307);
		}
	}
	return await resolve(event);
}) satisfies Handle;
