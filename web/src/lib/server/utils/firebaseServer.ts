import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from './firebaseAdmin';
import { clientFirebaseConfig } from '../../config/firebase';

const PROJECT_ID = clientFirebaseConfig.projectId; // From firebase config
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const JWKS_URL = new URL(
	'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
);

const jwks = createRemoteJWKSet(JWKS_URL);

export type FirebaseIdToken = JWTPayload & {
	aud: string;
	iss: string;
	sub: string; // Firebase UID
	user_id?: string; // same as sub
	email?: string;
	email_verified?: boolean;
	// Optional OpenID profile claims Firebase may include
	name?: string;
	picture?: string;
};

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdToken> {
	const { payload } = await jwtVerify(idToken, jwks, {
		issuer: ISSUER,
		audience: PROJECT_ID
	});

	const p = payload as FirebaseIdToken;
	if (!p.sub) {
		throw new Error('Invalid Firebase token: missing sub');
	}
	return p;
}

export async function verifyFirebaseSessionCookie(sessionCookie: string): Promise<DecodedIdToken> {
	const auth = getFirebaseAdminAuth();
	// By default, do not check for revocation here; call sites can decide policy.
	const decoded = await auth.verifySessionCookie(sessionCookie, false);
	return decoded;
}
