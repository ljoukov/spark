import { clientFirebaseConfig } from '$lib/config/firebase';
import { getTestUserId, isTestUser } from '$lib/server/auth/testUser';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getFirebaseAdminAuth } from '@spark/llm';
import { z } from 'zod';

const PROJECT_ID = clientFirebaseConfig.projectId; // From firebase config
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const JWKS_URL = new URL(
	'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
);

function getAuth() {
	return getFirebaseAdminAuth();
}

const jwks = createRemoteJWKSet(JWKS_URL);

const FirebaseIdTokenSchema = z
	.object({
		aud: z.string().min(1),
		iss: z.string().min(1),
		sub: z.string().min(1),
		user_id: z.string().min(1).optional(),
		email: z.string().min(1).optional(),
		email_verified: z.boolean().optional(),
		name: z.string().min(1).optional(),
		picture: z.string().min(1).optional()
	})
	.loose();

export type FirebaseIdToken = z.infer<typeof FirebaseIdTokenSchema>;

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdToken> {
	if (isTestUser()) {
		// In test mode, bypass verification entirely and return a minimal payload
		const uid = getTestUserId();
		const testToken = {
			aud: 'spark-test',
			iss: 'spark-test',
			sub: uid,
			user_id: uid
		} satisfies FirebaseIdToken;
		return testToken;
	}
	const { payload } = await jwtVerify(idToken, jwks, {
		issuer: ISSUER,
		audience: PROJECT_ID
	});

	const p = FirebaseIdTokenSchema.parse(payload);
	if (!p.sub) {
		throw new Error('Invalid Firebase token: missing sub');
	}
	return p;
}

export async function verifyFirebaseSessionCookie(sessionCookie: string): Promise<DecodedIdToken> {
	if (isTestUser()) {
		// In test mode, bypass verification and return a shaped object
		const uid = getTestUserId();
		const issuedAtSeconds = Math.floor(Date.now() / 1000);
		const testSession: DecodedIdToken = {
			aud: 'spark-test',
			iss: 'spark-test',
			sub: uid,
			uid,
			exp: issuedAtSeconds + 60 * 60,
			iat: issuedAtSeconds,
			auth_time: issuedAtSeconds,
			firebase: {
				identities: {},
				sign_in_provider: 'custom'
			}
		};
		return testSession;
	}
	const auth = getAuth();
	// By default, do not check for revocation here; call sites can decide policy.
	const decoded = await auth.verifySessionCookie(sessionCookie, false);
	return decoded;
}
