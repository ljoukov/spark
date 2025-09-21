import { ADMIN_SESSION_COOKIE_NAME } from '$lib/server/constants';
import { getAdminUserIDs } from '$lib/server/utils/admin';
import { logServerEvent } from '$lib/server/utils/logger';
import { verifyFirebaseSessionCookie } from '$lib/server/utils/firebaseServer';
import { z } from 'zod';
import type { LayoutServerLoad } from './$types';
import type { AdminSessionState } from '$lib/types/admin';

const sessionCookieSchema = z.string().min(1, 'Session cookie cannot be empty');

const decodedTokenSchema = z
	.object({
		uid: z.string().min(1, 'Firebase UID missing on session'),
		email: z.string().email().optional(),
		name: z.string().optional(),
		picture: z.string().url().optional()
	})
	.transform(({ uid, email, name, picture }) => ({
		uid,
		email: email ?? null,
		name: name ?? null,
		photoUrl: picture ?? null
	}));

export const load: LayoutServerLoad = async ({ cookies }) => {
	const rawCookie = cookies.get(ADMIN_SESSION_COOKIE_NAME);
	if (!rawCookie) {
		return { session: { status: 'signed_out' } satisfies AdminSessionState };
	}

	try {
		const sessionCookie = sessionCookieSchema.parse(rawCookie);
		const decoded = decodedTokenSchema.parse(await verifyFirebaseSessionCookie(sessionCookie));
		const adminUserIDs = getAdminUserIDs();
		const isAdmin = adminUserIDs.includes(decoded.uid);

		if (!isAdmin) {
			return {
				session: {
					status: 'not_admin',
					user: decoded
				} satisfies AdminSessionState
			};
		}

		return {
			session: {
				status: 'admin',
				user: decoded
			} satisfies AdminSessionState
		};
	} catch (error) {
		cookies.delete(ADMIN_SESSION_COOKIE_NAME, { path: '/' });
		logServerEvent({
			level: 'warn',
			message: 'Failed to validate admin session cookie',
			context: { error }
		});
		return { session: { status: 'signed_out' } satisfies AdminSessionState };
	}
};
