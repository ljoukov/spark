import { AUTH_TOKEN_COOKIE_NAME } from '$lib/auth/constants';
import { getFirebaseApp } from '$lib/utils/firebaseClient';
import { getAuth, onIdTokenChanged, type Auth, type Unsubscribe } from 'firebase/auth';

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
}

export function clearIdTokenCookie(): void {
	document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=; ${cookieAttrs()}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Subscribes to Firebase ID token changes and mirrors the token into a
 * SameSite=Lax cookie scoped to "/app" so server hooks can validate it.
 * Returns an unsubscribe function.
 */
export function startIdTokenCookieSync(auth?: Auth): Unsubscribe {
	const _auth = auth ?? getAuth(getFirebaseApp());
	return onIdTokenChanged(_auth, async (user) => {
		if (user) {
			const token = await user.getIdToken();
			setIdTokenCookie(token);
		} else {
			clearIdTokenCookie();
		}
	});
}
