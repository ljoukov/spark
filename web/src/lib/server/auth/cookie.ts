import { dev } from '$app/environment';
import { error, type Cookies } from '@sveltejs/kit';
import type { UserAuth } from './auth';
import { decodeUserAuth, encodeUserAuth } from './encode';
import { refreshAuthIfNeeded } from './refresh';

export const AUTH_SESSION_ID_COOKIE_NAME = 'authSessionId';
const AUTH_USER_COOKIE_NAME = 'userAuth';

export function hasUserAuthCookie(cookies: Cookies): boolean {
  return typeof cookies.get(AUTH_USER_COOKIE_NAME) === 'string';
}

/**
 * Retrieves user auth from cookies. If user's access token is expired refreshes if.
 * In that case sets a new user auth cookie with the new token.
 */
export async function getUserAuthFromCookiesResult(
  cookies: Cookies
): Promise<{ status: 'ok'; userAuth: UserAuth } | { status: 'error'; error: string }> {
  const userAuthCookie = cookies.get(AUTH_USER_COOKIE_NAME);
  if (typeof userAuthCookie !== 'string') {
    throw error(401, `Missing "${AUTH_USER_COOKIE_NAME}" cookie`);
  }
  const authResult = await refreshAuthIfNeeded(await decodeUserAuth(userAuthCookie));
  if (!authResult.success) {
    clearUserAuthCookie(cookies);
    return { status: 'error', error: authResult.error };
  }
  const { userAuth, userAuthRefreshed } = authResult.result;
  if (userAuthRefreshed) {
    await setUserAuthCookie(userAuth, cookies);
  }
  return { status: 'ok', userAuth };
}

export async function getUserAuthFromCookies(cookies: Cookies): Promise<UserAuth> {
  const authResult = await getUserAuthFromCookiesResult(cookies);
  switch (authResult.status) {
    case 'ok':
      return authResult.userAuth;
    case 'error':
      throw error(500, authResult.error);
  }
}

export async function setUserAuthCookie(userAuth: UserAuth, cookies: Cookies) {
  const expiration_seconds = 365 * 24 * 60 * 60; // 1 year
  cookies.set(AUTH_USER_COOKIE_NAME, await encodeUserAuth(userAuth), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: dev ? false : true,
    expires: new Date(Date.now() + expiration_seconds * 1000),
    maxAge: expiration_seconds
  });
}

export function clearUserAuthCookie(cookies: Cookies) {
  cookies.set(AUTH_USER_COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: dev ? false : true,
    expires: new Date(0)
  });
}
