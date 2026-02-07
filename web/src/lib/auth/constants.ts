export const AUTH_TOKEN_COOKIE_NAME = 'appAuthToken' as const;
export const AUTH_SESSION_COOKIE_NAME = 'appSession' as const;

// "Remember me" style session for SSR + API auth, separate from the 1h Firebase ID token cookie.
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
