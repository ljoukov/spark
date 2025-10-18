import { json } from '@sveltejs/kit';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { getTestUserId, isTestUser } from '$lib/server/auth/testUser';
import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';

export type VerifiedFirebaseToken = Awaited<ReturnType<typeof verifyFirebaseIdToken>>;

export type ApiAuthUser = {
	uid: string;
	token: string | null;
	decodedToken: VerifiedFirebaseToken | null;
	isTestUser: boolean;
};

export type ApiAuthResult = { ok: true; user: ApiAuthUser } | { ok: false; response: Response };

export function extractBearerToken(header: string | null): string | null {
	if (!header) {
		return null;
	}
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() ?? null;
}

function extractCookieToken(header: string | null): string | null {
	if (!header) {
		return null;
	}
	const parts = header.split(';');
	for (const part of parts) {
		const [name, ...valueParts] = part.split('=');
		if (!name || valueParts.length === 0) {
			continue;
		}
		if (name.trim() !== AUTH_TOKEN_COOKIE_NAME) {
			continue;
		}
		const rawValue = valueParts.join('=');
		const trimmedValue = rawValue.trim();
		if (!trimmedValue) {
			return null;
		}
		try {
			return decodeURIComponent(trimmedValue);
		} catch (error) {
			console.warn('Failed to decode auth token cookie', error);
			return null;
		}
	}
	return null;
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

	const tokenFromCookie = extractCookieToken(request.headers.get('cookie'));
	const token = tokenFromCookie ?? extractBearerToken(request.headers.get('authorization'));
	if (!token) {
		return {
			ok: false,
			response: json(
				{ error: 'unauthorized', message: 'Missing or invalid authentication token' },
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
		console.warn('Failed to verify Firebase ID token for API request', error);
		let message = 'Invalid or expired authentication token';
		if (typeof error === 'object' && error !== null && 'code' in error) {
			const code = String((error as { code?: unknown }).code ?? '');
			if (code === 'ERR_JWT_EXPIRED') {
				message = 'Your session expired. Please sign in again.';
			}
		} else if (error instanceof Error && error.message.includes('JWTExpired')) {
			message = 'Your session expired. Please sign in again.';
		}
		return {
			ok: false,
			response: json({ error: 'unauthorized', message }, { status: 401 })
		};
	}
}
