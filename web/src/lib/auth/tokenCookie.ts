import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { getFirebaseApp } from '$lib/utils/firebaseClient';
import { getAuth, onIdTokenChanged, type Auth, type Unsubscribe, type User } from 'firebase/auth';

let latestExpirationMs: number | null = null;
let activeUserRef: User | null = null;
let refreshScheduler: ((user: User, token: string) => void) | null = null;
let inflightRefresh: Promise<void> | null = null;

function cookieAttrs(): string {
	if (typeof window === 'undefined') {
		return 'Path=/; SameSite=Lax';
	}
	const secure = window.location.protocol === 'https:' ? '; Secure' : '';
	return `Path=/; SameSite=Lax${secure}`;
}

export function setIdTokenCookie(token: string): void {
	const maxAge = 60 * 60; // 1 hour
	document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttrs()}; Max-Age=${maxAge}`;
	updateTokenMetadata(token);
}

export function clearIdTokenCookie(): void {
	document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=; ${cookieAttrs()}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
	latestExpirationMs = null;
}

const REFRESH_BUFFER_MS = 60 * 1000; // Refresh 1 minute before expiry when possible.

type JwtPayload = { exp?: number } | Record<string, unknown>;

function decodeJwtPayload(token: string): JwtPayload | null {
	if (typeof atob !== 'function') {
		return null;
	}
	const parts = token.split('.');
	if (parts.length < 2) {
		return null;
	}
	try {
		const decoded = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
		const json = decodeURIComponent(
			decoded
				.split('')
				.map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
				.join('')
		);
		const payload = JSON.parse(json);
		if (payload && typeof payload === 'object') {
			return payload as JwtPayload;
		}
	} catch (error) {
		console.warn('Failed to decode Firebase ID token payload', error);
	}
	return null;
}

function updateTokenMetadata(token: string): void {
	const payload = decodeJwtPayload(token);
	if (
		payload &&
		typeof payload === 'object' &&
		'exp' in payload &&
		typeof (payload as { exp: unknown }).exp === 'number'
	) {
		latestExpirationMs = (payload as { exp: number }).exp * 1000;
	} else {
		latestExpirationMs = null;
	}
}

function scheduleProactiveRefresh(
	user: User,
	token: string,
	setTimer: (timer: number | null) => void
) {
	if (typeof window === 'undefined') {
		return;
	}
	const payload = decodeJwtPayload(token);
	const expSeconds =
		payload &&
		typeof payload === 'object' &&
		'exp' in payload &&
		typeof (payload as { exp: unknown }).exp === 'number'
			? (payload as { exp: number }).exp
			: null;
	if (!expSeconds) {
		return;
	}
	const refreshAt = expSeconds * 1000 - Date.now() - REFRESH_BUFFER_MS;
	if (refreshAt <= 0) {
		void user.getIdToken(true).catch((error) => {
			console.warn('Failed to proactively refresh Firebase ID token', error);
		});
		return;
	}
	const timerId = window.setTimeout(() => {
		setTimer(null);
		user.getIdToken(true).catch((error) => {
			console.warn('Failed to proactively refresh Firebase ID token', error);
		});
	}, refreshAt);
	setTimer(timerId);
}

/**
 * Subscribes to Firebase ID token changes and mirrors the token into a
 * SameSite=Lax cookie scoped to "/" so server hooks can validate it.
 * Returns an unsubscribe function.
 */
export function startIdTokenCookieSync(auth?: Auth): Unsubscribe {
	const _auth = auth ?? getAuth(getFirebaseApp());
	let refreshTimer: number | null = null;
	const setTimer = (next: number | null) => {
		if (typeof window === 'undefined') {
			return;
		}
		if (refreshTimer !== null) {
			window.clearTimeout(refreshTimer);
		}
		refreshTimer = next;
	};
	refreshScheduler = (user, token) => {
		scheduleProactiveRefresh(user, token, setTimer);
	};
	return onIdTokenChanged(_auth, async (user) => {
		setTimer(null);
		activeUserRef = user;
		if (user) {
			const token = await user.getIdToken();
			setIdTokenCookie(token);
			scheduleProactiveRefresh(user, token, setTimer);
		} else {
			clearIdTokenCookie();
		}
	});
}

export async function ensureFreshIdToken(bufferMs: number = REFRESH_BUFFER_MS): Promise<void> {
	if (typeof window === 'undefined') {
		return;
	}
	const user = activeUserRef ?? getAuth(getFirebaseApp()).currentUser;
	if (!user) {
		return;
	}
	activeUserRef = user;
	const expiresIn = latestExpirationMs !== null ? latestExpirationMs - Date.now() : null;
	const shouldForceRefresh = expiresIn === null || expiresIn <= bufferMs;
	if (!shouldForceRefresh && inflightRefresh === null) {
		// Token is still fresh enough; still mirror cookie to extend Max-Age.
		const token = await user.getIdToken(false);
		setIdTokenCookie(token);
		refreshScheduler?.(user, token);
		return;
	}
	if (!inflightRefresh) {
		inflightRefresh = user
			.getIdToken(shouldForceRefresh)
			.then((token) => {
				setIdTokenCookie(token);
				refreshScheduler?.(user, token);
			})
			.catch((error) => {
				console.warn('Failed to refresh Firebase ID token on demand', error);
				throw error;
			})
			.finally(() => {
				inflightRefresh = null;
			});
	}
	try {
		await inflightRefresh;
	} catch {
		// Allow callers to proceed; the request may still succeed with existing token.
	}
}
