import { isUserAdmin } from '$lib/server/utils/admin';
import { AUTH_SESSION_COOKIE_NAME, AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { readAppSessionCookieValue, setAppSessionCookie } from '$lib/server/auth/sessionCookie';
import { z } from 'zod';
import { json, type Handle, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

if (typeof process !== 'undefined' && typeof process.on === 'function') {
	process.on('unhandledRejection', (reason, promise) => {
		console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	});
}

export const handle = (async ({ event, resolve }) => {
	// Initialize app user locals to a known state
	event.locals.appUser = null;
	const pathname = event.url.pathname;
	const internalTasksPrefix = '/api/internal/tasks';
	const isInternalTasksRoute =
		pathname === internalTasksPrefix || pathname.startsWith(`${internalTasksPrefix}/`);

	if (isInternalTasksRoute) {
		if (event.request.method !== 'POST') {
			return json(
				{ error: 'method_not_allowed' },
				{
					status: 405,
					headers: {
						Allow: 'POST'
					}
				}
			);
		}

		const tasksApiKey = env.TASKS_API_KEY ?? '';
		if (!tasksApiKey || tasksApiKey.trim().length === 0) {
			console.error('TASKS_API_KEY is not configured');
			return json({ error: 'server_misconfigured' }, { status: 500 });
		}

		const authorization = event.request.headers.get('authorization');
		const expectedToken = `Bearer ${tasksApiKey}`;
		if (authorization !== expectedToken) {
			return json(
				{ error: 'unauthorized' },
				{
					status: 401,
					headers: {
						'WWW-Authenticate': 'Bearer'
					}
				}
			);
		}
	}

	const shouldHydrateAppUser = (target: string) =>
		target === '/' ||
		target.startsWith('/login') ||
		target.startsWith('/logout') ||
		target.startsWith('/spark') ||
		target.startsWith('/code');

	type VerifiedAuthResult = {
		payload: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
		appUser: NonNullable<App.Locals['appUser']>;
	};

	const verifySession = async (): Promise<NonNullable<App.Locals['appUser']> | null> => {
		const raw = event.cookies.get(AUTH_SESSION_COOKIE_NAME);
		const session = await readAppSessionCookieValue(raw);
		if (!session) {
			return null;
		}
		return {
			uid: session.uid,
			email: session.email,
			name: session.name,
			photoUrl: session.photoUrl,
			isAnonymous: session.isAnonymous
		};
	};

	const verifyCookie = async (label: string): Promise<VerifiedAuthResult | null> => {
		const raw = event.cookies.get(AUTH_TOKEN_COOKIE_NAME);
		const parsed = z.string().min(1).safeParse(raw);
		if (!parsed.success) {
			return null;
		}
		try {
			const payload = await verifyFirebaseIdToken(parsed.data);
			const firebaseInfo = (payload as { firebase?: { sign_in_provider?: string } }).firebase;
			const signInProvider = firebaseInfo?.sign_in_provider ?? null;
			return {
				payload,
				appUser: {
					uid: payload.sub,
					email: payload.email ?? null,
					name: payload.name ?? null,
					photoUrl: payload.picture ?? null,
					isAnonymous: signInProvider === 'anonymous'
				}
			};
		} catch (err) {
			console.log(`[${label}] token verification failed`, err);
			return null;
		}
	};

	if (shouldHydrateAppUser(pathname)) {
		const sessionUser = await verifySession();
		if (sessionUser) {
			event.locals.appUser = sessionUser;
		} else {
			const verified = await verifyCookie('app-auth');
			if (verified) {
				event.locals.appUser = verified.appUser;
				try {
					await setAppSessionCookie(event.cookies, event.url, verified.appUser);
				} catch (err) {
					console.log('[app-auth] failed to issue session cookie', err);
				}
			}
		}
	}

	if (pathname.startsWith('/admin')) {
		let hasValidToken = false;
		let isAdmin = false;
		const sessionUser = await verifySession();
		if (sessionUser) {
			event.locals.appUser = sessionUser;
			hasValidToken = true;
			isAdmin = isUserAdmin({ userId: sessionUser.uid } as { userId: string });
		} else {
			const verified = await verifyCookie('admin-auth');
			if (verified) {
				event.locals.appUser = verified.appUser;
				hasValidToken = true;
				isAdmin = isUserAdmin({ userId: verified.payload.sub } as { userId: string });
				try {
					await setAppSessionCookie(event.cookies, event.url, verified.appUser);
				} catch (err) {
					console.log('[admin-auth] failed to issue session cookie', err);
				}
			}
		}

		const isAdminRoot = pathname === '/admin' || pathname === '/admin/';
		if (!isAdminRoot && (!hasValidToken || !isAdmin)) {
			throw redirect(303, '/admin');
		}
	}

	return await resolve(event);
}) satisfies Handle;
