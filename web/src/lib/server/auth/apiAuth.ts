import { json } from '@sveltejs/kit';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { AUTH_SESSION_COOKIE_NAME, AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { readAppSessionCookieValue } from '$lib/server/auth/sessionCookie';

export type VerifiedFirebaseToken = Awaited<ReturnType<typeof verifyFirebaseIdToken>>;

export type ApiAuthUser = {
	uid: string;
	token: string | null;
	decodedToken: VerifiedFirebaseToken | null;
};

export type ApiAuthResult = { ok: true; user: ApiAuthUser } | { ok: false; response: Response };

export function extractBearerToken(header: string | null): string | null {
	if (!header) {
		return null;
	}
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() ?? null;
}

function extractCookieValue(header: string | null, name: string): string | null {
	if (!header) {
		return null;
	}
	const parts = header.split(';');
	for (const part of parts) {
		const [cookieName, ...valueParts] = part.split('=');
		if (!cookieName || valueParts.length === 0) {
			continue;
		}
		if (cookieName.trim() !== name) {
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
	const cookieHeader = request.headers.get('cookie');

	const bearerToken = extractBearerToken(request.headers.get('authorization'));
	const tokenFromCookie = extractCookieValue(cookieHeader, AUTH_TOKEN_COOKIE_NAME);
	const token = bearerToken ?? tokenFromCookie;

	if (token) {
		try {
			const decodedToken = await verifyFirebaseIdToken(token);
			return {
				ok: true,
				user: {
					uid: decodedToken.sub,
					token,
					decodedToken
				}
			};
		} catch (error) {
			console.warn('Failed to verify Firebase ID token for API request', error);
			// Fall back to the long-lived session cookie below.
		}
	}

	const sessionFromCookie = extractCookieValue(cookieHeader, AUTH_SESSION_COOKIE_NAME);
	const session = await readAppSessionCookieValue(sessionFromCookie);
	if (session) {
		return {
			ok: true,
			user: {
				uid: session.uid,
				token: null,
				decodedToken: null
			}
		};
	}

	if (!token) {
		return {
			ok: false,
			response: json(
				{ error: 'unauthorized', message: 'Missing or invalid authentication token' },
				{ status: 401 }
			)
		};
	}

	let message = 'Invalid or expired authentication token';
	if (typeof token === 'string' && token.length > 0) {
		// We already attempted to verify the token above; treat the request as unauthorized.
		message = 'Your session expired. Please sign in again.';
	}
	return {
		ok: false,
		response: json({ error: 'unauthorized', message }, { status: 401 })
	};
}
