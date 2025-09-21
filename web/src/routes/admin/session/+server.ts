import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { GOOGLE_API_KEY } from '$env/static/private';
import { Timestamp } from '$proto/google/protobuf/timestamp';
import type { UserAuth } from '$lib/server/auth/auth';
import { setUserAuthCookie, clearUserAuthCookie } from '$lib/server/auth/cookie';
import { responseErrorAsString } from '$lib/utils/error';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';

const BodySchema = z.object({
  /**
   * Google OAuth ID token from GoogleAuthProvider redirect result credential.
   * This is NOT the Firebase ID token.
   */
  idToken: z.string().min(1)
});

const signInWithIdpResponseSchema = z.object({
  localId: z.string(),
  idToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.preprocess((v) => parseInt(z.string().parse(v)), z.number().gt(0))
});

export const POST: RequestHandler = async ({ request, url, cookies }) => {
  const { idToken } = BodySchema.parse(await request.json());

  // Basic sanity: if the client mistakenly sent a Firebase ID token, this will verify
  // but SignInWithIdp will fail. We accept both flows by trying IdP exchange first.

  // Exchange Google ID token for Firebase tokens via Identity Toolkit.
  const postBody = new URLSearchParams({
    id_token: idToken,
    providerId: 'google.com'
  }).toString();

  const respObj = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GOOGLE_API_KEY
    },
    body: JSON.stringify({
      postBody,
      requestUri: url.origin + '/auth/continue', // any HTTPS URL on our domain
      returnSecureToken: true
    })
  });

  if (!respObj.ok) {
    // If IdP exchange failed, check if it was actually a Firebase ID token and surface a clearer error.
    try {
      await verifyFirebaseIdToken(idToken);
      throw error(400, 'Received a Firebase ID token; expected Google ID token from OAuth credential.');
    } catch {
      // fallthrough to generic error
    }
    throw error(500, `signInWithIdp failed: ${await responseErrorAsString(respObj)}`);
  }

  const { localId, idToken: firebaseIdToken, refreshToken, expiresIn } =
    signInWithIdpResponseSchema.parse(await respObj.json());

  const userAuth: UserAuth = {
    userId: localId,
    accessToken: firebaseIdToken,
    refreshToken,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + (expiresIn - 10) * 1000))
  };

  await setUserAuthCookie(userAuth, cookies);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
  clearUserAuthCookie(cookies);
  return json({ ok: true });
};

