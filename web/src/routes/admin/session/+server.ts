import {
	ADMIN_SESSION_COOKIE_NAME,
	ADMIN_SESSION_MAX_AGE_SECONDS,
	ADMIN_SESSION_MAX_AGE_MS
} from '$lib/server/constants';
import { getAdminUserIDs } from '$lib/server/utils/admin';
import { getFirebaseAdminAuth } from '$lib/server/utils/firebaseAdmin';
import { logServerEvent } from '$lib/server/utils/logger';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const requestSchema = z.object({
	idToken: z.string().min(1, 'idToken is required')
});

const firebaseTokenSchema = z
	.object({
		sub: z.string().min(1, 'Missing subject'),
		user_id: z.string().min(1).optional(),
		email: z.string().email().optional(),
		name: z.string().optional()
	})
	.transform(({ sub, user_id, email, name }) => ({
		uid: user_id ?? sub,
		email: email ?? null,
		name: name ?? null
	}));

export const POST: RequestHandler = async ({ request, cookies }) => {
	const rawBody = await request.json().catch(() => null);
	const parsedBody = requestSchema.safeParse(rawBody);

	if (!parsedBody.success) {
		return json({ message: 'Invalid request body' }, { status: 400 });
	}

	let tokenResult;
	try {
		tokenResult = firebaseTokenSchema.parse(await verifyFirebaseIdToken(parsedBody.data.idToken));
	} catch (error) {
		logServerEvent({
			level: 'warn',
			message: 'Admin sign-in rejected: invalid Firebase token',
			context: { error }
		});
		return json({ message: 'Invalid token' }, { status: 401 });
	}

	const adminUserIDs = getAdminUserIDs();
	if (!adminUserIDs.includes(tokenResult.uid)) {
		logServerEvent({
			level: 'warn',
			message: 'Admin sign-in rejected: user not on allowlist',
			context: { uid: tokenResult.uid }
		});
		return json({ message: 'User is not authorized for admin access' }, { status: 403 });
	}

	try {
		const auth = getFirebaseAdminAuth();
		const sessionCookie = await auth.createSessionCookie(parsedBody.data.idToken, {
			expiresIn: ADMIN_SESSION_MAX_AGE_MS
		});

		cookies.set(ADMIN_SESSION_COOKIE_NAME, sessionCookie, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: true,
			maxAge: ADMIN_SESSION_MAX_AGE_SECONDS
		});

		return json({
			status: 'ok',
			user: tokenResult
		});
	} catch (error) {
		logServerEvent({
			level: 'error',
			message: 'Failed to create admin session cookie',
			context: { error }
		});
		return json({ message: 'Could not create session at this time' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ cookies }) => {
	cookies.delete(ADMIN_SESSION_COOKIE_NAME, { path: '/' });
	return json({ status: 'ok' });
};
