import { GOOGLE_API_KEY } from '$env/static/private';
import { isTimestampBefore } from '$lib/server/utils/time';
import { Timestamp } from '$proto/google/protobuf/timestamp';
import { z } from 'zod';
import type { UserAuth } from './auth';
import { responseErrorAsString } from '$lib/utils/error';
import { newTimer } from '$lib/server/utils/timer';

const RefreshTokenResponseSchema = z.object({
	expires_in: z.preprocess((v) => parseInt(z.string().parse(v)), z.number().gt(0)),
	token_type: z.literal('Bearer'),
	refresh_token: z.string().min(1),
	id_token: z.string().min(1),
	user_id: z.string().min(1)
});

export async function refreshAuthIfNeeded(
	userAuth: UserAuth
): Promise<
	| { success: true; result: { userAuth: UserAuth; userAuthRefreshed: boolean } }
	| { success: false; error: string }
> {
	if (isTimestampBefore(Timestamp.now(), userAuth.expiresAt)) {
		return { success: true, result: { userAuth, userAuthRefreshed: false } };
	}
	// Reference: https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
	const timer = newTimer();
	const refreshRespObj = await fetch('https://securetoken.googleapis.com/v1/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'X-goog-api-key': GOOGLE_API_KEY
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: userAuth.refreshToken
		})
	});
	if (!refreshRespObj.ok) {
		console.log('Failed to refresh auth token:', await responseErrorAsString(refreshRespObj));
		return {
			success: false,
			error: `failed to refresh token: ${refreshRespObj.status}: ${refreshRespObj.statusText}`
		};
	}
	const refreshResp = RefreshTokenResponseSchema.parse(await refreshRespObj.json());
	console.log(`refreshAuthIfNeeded: ${timer.elapsedStr()}, expires_in: ${refreshResp.expires_in}`);
	return {
		success: true,
		result: {
			userAuth: {
				userId: refreshResp.user_id,
				accessToken: refreshResp.id_token,
				expiresAt: Timestamp.fromDate(new Date(Date.now() + (refreshResp.expires_in - 10) * 1000)),
				refreshToken: refreshResp.refresh_token
			},
			userAuthRefreshed: true
		}
	};
}

export function newNeedReauthResponse(): Response {
	return new Response(null, { status: 401, headers: { 'X-Need-Reauth': 'true' } });
}
