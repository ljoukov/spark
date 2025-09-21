import { error } from '@sveltejs/kit';
import { GOOGLE_API_KEY } from '$env/static/private';
import { Timestamp } from '$proto/google/protobuf/timestamp';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import type { UserAuth } from '$lib/server/auth/auth';
import { getAuthSessionCookie, setUserAuthCookie } from '$lib/server/auth/cookie';
import { clientSideRedirect } from '$lib/server/utils/response';
import { getHostUrl } from '$lib/server/utils/urlParams';

const signInWithIdpResponseSchema = z.object({
	localId: z.string(),
	idToken: z.string(),
	expiresIn: z.preprocess((v) => parseInt(z.string().parse(v)), z.number().gt(0)),
	refreshToken: z.string(),
	displayName: z.string().optional(),
	photoUrl: z.string().optional(),
	email: z.string().optional()
});

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	if (typeof code !== 'string') {
		throw error(400, 'Missing "code" parameter');
	}
	const { sessionId, redirectPath } = getAuthSessionCookie(cookies);
	const requestUri = getHostUrl(url);
	// Reference: https://firebase.google.com/docs/reference/rest/auth#section-sign-in-with-oauth-credential
	const signInRespObj = await fetch(
		'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-goog-api-key': GOOGLE_API_KEY
			},
			body: JSON.stringify({
				requestUri,
				returnIdpCredential: true,
				returnSecureToken: true,
				sessionId
			})
		}
	);
	if (!signInRespObj.ok) {
		throw error(500, `signInWithIdp error=${signInRespObj.status}: ${signInRespObj.statusText}`);
	}
	const signInResp = signInWithIdpResponseSchema.parse(await signInRespObj.json());

	const userAuth: UserAuth = {
		userId: signInResp.localId,
		accessToken: signInResp.idToken,
		expiresAt: Timestamp.fromDate(new Date(Date.now() + (signInResp.expiresIn - 10) * 1000)),
		refreshToken: signInResp.refreshToken
	};
	await setUserAuthCookie(userAuth, cookies);
	return clientSideRedirect(new URL(redirectPath, url));
};
