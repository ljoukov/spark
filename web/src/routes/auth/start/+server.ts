import type { RequestHandler } from './$types';
import { GOOGLE_API_KEY } from '$env/static/private';
import { clientSideRedirect } from '$lib/server/utils/response';
import { AUTH_SESSION_ID_COOKIE_NAME } from '$lib/server/auth/cookie';
import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { responseErrorAsString } from '$lib/utils/error';
import { getHostUrl } from '$lib/server/utils/urlParams';

const createAuthUriResponseSchema = z.object({
	authUri: z.string(),
	sessionId: z.string()
});

export const GET: RequestHandler = async ({ url, cookies }) => {
	const continueUri = new URL('/auth/continue', getHostUrl(url));
	const authUriRespObj = await fetch(
		'https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-goog-api-key': GOOGLE_API_KEY
			},
			body: JSON.stringify({
				continueUri: continueUri.toString(),
				customParameter: {},
				oauthScope: '{"google.com":"profile"}',
				providerId: 'google.com'
			})
		}
	);
	if (!authUriRespObj.ok) {
		throw error(500, `createAuthUri: ${await responseErrorAsString(authUriRespObj)}`);
	}
	const expiration_seconds = 20 * 60; // 20 minutes
	const authUriResp = createAuthUriResponseSchema.parse(await authUriRespObj.json());
	cookies.set(AUTH_SESSION_ID_COOKIE_NAME, authUriResp.sessionId, {
		path: '/auth/',
		expires: new Date(Date.now() + expiration_seconds * 1000),
		maxAge: expiration_seconds
	});
	return clientSideRedirect(new URL(authUriResp.authUri));
};
