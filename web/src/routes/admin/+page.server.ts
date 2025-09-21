import { ADMIN_SESSION_COOKIE_NAME } from '$lib/server/constants';
import { getAdminUserIDs } from '$lib/server/utils/admin';
import { logServerEvent } from '$lib/server/utils/logger';
import { verifyFirebaseSessionCookie } from '$lib/server/utils/firebaseServer';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const sessionCookieSchema = z.string().min(1, 'Session cookie cannot be empty');

const decodedTokenSchema = z
	.object({
		uid: z.string().min(1, 'Firebase UID missing on session'),
		email: z.string().email().optional(),
		name: z.string().optional()
	})
	.transform(({ uid, email, name }) => ({
		uid,
		email: email ?? null,
		name: name ?? null
	}));

export type AdminPageData =
	| { status: 'signed_out' }
	| { status: 'not_admin'; user: { uid: string; email: string | null; name: string | null } }
	| { status: 'admin'; user: { uid: string; email: string | null; name: string | null } };

export const load: PageServerLoad = async ({ cookies }) => {
	const rawCookie = cookies.get(ADMIN_SESSION_COOKIE_NAME);
	if (!rawCookie) {
		return { status: 'signed_out' } satisfies AdminPageData;
	}

	try {
		const sessionCookie = sessionCookieSchema.parse(rawCookie);
		const decoded = decodedTokenSchema.parse(await verifyFirebaseSessionCookie(sessionCookie));
		const adminUserIDs = getAdminUserIDs();
		const isAdmin = adminUserIDs.includes(decoded.uid);

		if (!isAdmin) {
			return {
				status: 'not_admin',
				user: decoded
			} satisfies AdminPageData;
		}

		return {
			status: 'admin',
			user: decoded
		} satisfies AdminPageData;
	} catch (error) {
		cookies.delete(ADMIN_SESSION_COOKIE_NAME, { path: '/' });
		logServerEvent({
			level: 'warn',
			message: 'Failed to validate admin session cookie',
			context: { error }
		});
		return { status: 'signed_out' } satisfies AdminPageData;
	}
};
