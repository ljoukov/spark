import type { RequestHandler } from './$types';
import { GOOGLE_API_KEY } from '$env/static/private';
import { clientSideRedirect } from '$lib/server/utils/response';
import { setAuthSessionCookie } from '$lib/server/auth/cookie';
import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { responseErrorAsString } from '$lib/utils/error';
import { getHostUrl } from '$lib/server/utils/urlParams';

const createAuthUriResponseSchema = z.object({
	authUri: z.string(),
	sessionId: z.string()
});

const startQueryParamsSchema = z.object({
	r: z
		.string()
		.trim()
		.refine((value) => value.startsWith('/') && !value.startsWith('//'), {
			message: 'r must be a URL path starting with "/"'
		})
		.optional()
});

export const GET: RequestHandler = async ({ url, cookies }) => {
	const { r: redirectPath } = startQueryParamsSchema.parse({
		r: url.searchParams.get('r') ?? undefined
	});
	if (redirectPath === undefined) {
		throw error(400, 'Missing required redirect path parameter "r"');
	}

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
	const { sessionId, authUri } = createAuthUriResponseSchema.parse(await authUriRespObj.json());
	setAuthSessionCookie(cookies, { sessionId, redirectPath });
	return clientSideRedirect(new URL(authUri));
};
