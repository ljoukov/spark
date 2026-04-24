import { isUserAdmin } from '$lib/server/utils/admin';
import { AUTH_SESSION_COOKIE_NAME, AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { getForcedAppUser } from '$lib/server/auth/forcedUser';
import { readAppSessionCookieValue, setAppSessionCookie } from '$lib/server/auth/sessionCookie';
import {
	flushPendingCloudLogWrites,
	installServerConsoleCloudLogging,
	writeSparkCloudLog
} from '$lib/server/gcp/logging';
import { z } from 'zod';
import { json, type Handle, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

installServerConsoleCloudLogging();

if (typeof process !== 'undefined' && typeof process.on === 'function') {
	process.on('unhandledRejection', (reason, promise) => {
		console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	});
}

if (process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE === undefined) {
	process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE = 'off';
}

type WaitUntilEvent = {
	waitUntil?: (promise: Promise<void>) => void;
	platform?: {
		context?: {
			waitUntil?: (promise: Promise<void>) => void;
		};
	};
};

function shouldLogRequest(pathname: string): boolean {
	if (pathname.startsWith('/_app/') || pathname.startsWith('/favicon')) {
		return false;
	}

	return (
		pathname === '/' ||
		pathname.startsWith('/admin') ||
		pathname.startsWith('/api') ||
		pathname.startsWith('/code') ||
		pathname.startsWith('/login') ||
		pathname.startsWith('/logout') ||
		pathname.startsWith('/spark')
	);
}

function readQueryParam(url: URL, name: string): string | undefined {
	const value = url.searchParams.get(name)?.trim() ?? '';
	return value.length > 0 ? value : undefined;
}

function readParam(params: Partial<Record<string, string>>, name: string): string | undefined {
	const value = params[name]?.trim() ?? '';
	return value.length > 0 ? value : undefined;
}

function extractRequestLogLabels(event: Parameters<Handle>[0]['event']): {
	userId?: string;
	agentId?: string;
	workspaceId?: string;
} {
	const params = event.params as Partial<Record<string, string>>;
	const pathname = event.url.pathname;

	let agentId = readParam(params, 'agentId') ?? readQueryParam(event.url, 'agentId');
	if (!agentId && pathname.startsWith('/spark/agents/')) {
		agentId = readParam(params, 'runId');
	}

	return {
		userId:
			event.locals.appUser?.uid ??
			readParam(params, 'userId') ??
			readQueryParam(event.url, 'userId'),
		agentId,
		workspaceId: readParam(params, 'workspaceId') ?? readQueryParam(event.url, 'workspaceId')
	};
}

function inferResponseStatus(response: Response | null, error: unknown): number | null {
	if (response) {
		return response.status;
	}
	if (typeof error === 'object' && error !== null && 'status' in error) {
		const status = (error as { status?: unknown }).status;
		return typeof status === 'number' && Number.isFinite(status) ? status : null;
	}
	return null;
}

function getWaitUntil(target: WaitUntilEvent): ((promise: Promise<void>) => void) | null {
	return target.platform?.context?.waitUntil ?? target.waitUntil ?? null;
}

function severityForStatus(status: number | null): 'INFO' | 'WARNING' | 'ERROR' {
	if (status !== null && status >= 500) {
		return 'ERROR';
	}
	if (status !== null && status >= 400) {
		return 'WARNING';
	}
	return 'INFO';
}

export const handle = (async ({ event, resolve }) => {
	const requestStartedAt = Date.now();
	let response: Response | null = null;
	let requestError: unknown = null;

	// Initialize app user locals to a known state
	event.locals.appUser = null;
	event.locals.authMode = null;
	const pathname = event.url.pathname;
	const internalTasksPrefix = '/api/internal/tasks';
	const internalTasksInfoPath = '/api/internal/tasks/info';
	const isInternalTasksRoute =
		pathname === internalTasksPrefix || pathname.startsWith(`${internalTasksPrefix}/`);

	if (isInternalTasksRoute) {
		const allowedMethod = pathname === internalTasksInfoPath ? 'GET' : 'POST';
		if (event.request.method !== allowedMethod) {
			return json(
				{ error: 'method_not_allowed' },
				{
					status: 405,
					headers: {
						Allow: allowedMethod
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

	const forcedAppUser = await getForcedAppUser();
	if (forcedAppUser) {
		event.locals.appUser = forcedAppUser;
		event.locals.authMode = 'forced';
	}

	if (shouldHydrateAppUser(pathname) && !forcedAppUser) {
		const sessionUser = await verifySession();
		if (sessionUser) {
			event.locals.appUser = sessionUser;
			event.locals.authMode = 'firebase';
		} else {
			const verified = await verifyCookie('app-auth');
			if (verified) {
				event.locals.appUser = verified.appUser;
				event.locals.authMode = 'firebase';
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
		if (forcedAppUser) {
			hasValidToken = true;
			isAdmin = isUserAdmin({ userId: forcedAppUser.uid });
		} else {
			const sessionUser = await verifySession();
			if (sessionUser) {
				event.locals.appUser = sessionUser;
				event.locals.authMode = 'firebase';
				hasValidToken = true;
				isAdmin = isUserAdmin({ userId: sessionUser.uid });
			} else {
				const verified = await verifyCookie('admin-auth');
				if (verified) {
					event.locals.appUser = verified.appUser;
					event.locals.authMode = 'firebase';
					hasValidToken = true;
					isAdmin = isUserAdmin({ userId: verified.payload.sub });
					try {
						await setAppSessionCookie(event.cookies, event.url, verified.appUser);
					} catch (err) {
						console.log('[admin-auth] failed to issue session cookie', err);
					}
				}
			}
		}

		const isAdminRoot = pathname === '/admin' || pathname === '/admin/';
		if (!isAdminRoot && (!hasValidToken || !isAdmin)) {
			throw redirect(303, '/admin');
		}
	}

	try {
		response = await resolve(event);
		return response;
	} catch (error) {
		requestError = error;
		throw error;
	} finally {
		if (shouldLogRequest(pathname)) {
			const status = inferResponseStatus(response, requestError);
			writeSparkCloudLog({
				severity: severityForStatus(status),
				source: 'spark-request',
				message: `${event.request.method} ${status ?? 'ERR'} ${pathname}`,
				labels: extractRequestLogLabels(event),
				jsonPayload: {
					logger: 'request',
					method: event.request.method,
					pathname,
					requestUrl: event.url.toString(),
					status,
					durationMs: Date.now() - requestStartedAt,
					userAgent: event.request.headers.get('user-agent'),
					referer: event.request.headers.get('referer')
				}
			});
		}

		const flushPromise = flushPendingCloudLogWrites().catch(() => undefined);
		const waitUntil = getWaitUntil(event as WaitUntilEvent);
		if (waitUntil) {
			waitUntil(flushPromise);
		} else {
			void flushPromise;
		}
	}
}) satisfies Handle;
