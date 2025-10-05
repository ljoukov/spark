import { json } from '@sveltejs/kit';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { getTestUserId, isTestUser } from '$lib/server/auth/testUser';

export type VerifiedFirebaseToken = Awaited<ReturnType<typeof verifyFirebaseIdToken>>;

export type ApiAuthUser = {
	uid: string;
	token: string | null;
	decodedToken: VerifiedFirebaseToken | null;
	isTestUser: boolean;
};

export type ApiAuthResult =
	| { ok: true; user: ApiAuthUser }
	| { ok: false; response: Response };

export function extractBearerToken(header: string | null): string | null {
	if (!header) {
		return null;
	}
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() ?? null;
}

export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
	if (isTestUser()) {
		return {
			ok: true,
			user: {
				uid: getTestUserId(),
				token: null,
				decodedToken: null,
				isTestUser: true
			}
		};
	}

	const token = extractBearerToken(request.headers.get('authorization'));
	if (!token) {
		return {
			ok: false,
			response: json(
				{ error: 'unauthorized', message: 'Missing or invalid Authorization header' },
				{ status: 401 }
			)
		};
	}

	try {
		const decodedToken = await verifyFirebaseIdToken(token);
		return {
			ok: true,
			user: {
				uid: decodedToken.sub,
				token,
				decodedToken,
				isTestUser: false
			}
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid Firebase ID token';
		return {
			ok: false,
			response: json({ error: 'unauthorized', message }, { status: 401 })
		};
	}
}
