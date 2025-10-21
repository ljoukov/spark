import { TASKS_API_KEY } from '$env/static/private';
import { isUserAdmin } from '$lib/server/utils/admin';
import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { getTestUserId, isTestUser, isTestUserAdmin } from '$lib/server/auth/testUser';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { z } from 'zod';
import { json, type Handle, redirect } from '@sveltejs/kit';

if (typeof global !== 'undefined') {
	global.process.on('unhandledRejection', (reason, promise) => {
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

		if (!TASKS_API_KEY) {
			console.error('TASKS_API_KEY is not configured');
			return json({ error: 'server_misconfigured' }, { status: 500 });
		}

		const authorization = event.request.headers.get('authorization');
		const expectedToken = `Bearer ${TASKS_API_KEY}`;
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
		target.startsWith('/app') ||
		target.startsWith('/code') ||
		target.startsWith('/spark') ||
		target.startsWith('/welcome') ||
		target.startsWith('/logout');

	type VerifiedAuthResult = {
		payload: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
		appUser: NonNullable<App.Locals['appUser']>;
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

	// In test mode, short-circuit all authentication and force test user
	if (isTestUser()) {
		const uid = getTestUserId();
		event.locals.appUser = {
			uid,
			email: null,
			name: null,
			photoUrl: null,
			isAnonymous: false
		};
		// For admin routes, enforce admin access based on test user admin flag
		if (pathname.startsWith('/admin')) {
			const isAdmin = isTestUserAdmin();
			const isAdminRoot = pathname === '/admin' || pathname === '/admin/';
			if (!isAdminRoot && !isAdmin) {
				throw redirect(303, '/admin');
			}
		}
		return await resolve(event);
	}

	if (shouldHydrateAppUser(pathname)) {
		const verified = await verifyCookie('app-auth');
		if (verified) {
			event.locals.appUser = verified.appUser;
		}
	}

	if (pathname.startsWith('/admin')) {
		const verified = await verifyCookie('admin-auth');
		let hasValidToken = false;
		let isAdmin = false;
		if (verified) {
			event.locals.appUser = verified.appUser;
			hasValidToken = true;
			isAdmin = isUserAdmin({ userId: verified.payload.sub } as { userId: string });
		}

		const isAdminRoot = pathname === '/admin' || pathname === '/admin/';
		if (!isAdminRoot && (!hasValidToken || !isAdmin)) {
			throw redirect(303, '/admin');
		}
	}

	return await resolve(event);
}) satisfies Handle;
