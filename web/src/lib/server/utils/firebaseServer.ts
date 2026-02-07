import { clientFirebaseConfig } from '$lib/config/firebase';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { z } from 'zod';

const PROJECT_ID = clientFirebaseConfig.projectId; // From firebase config
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const JWKS_URL = new URL(
	'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
);

// During SSR, SvelteKit temporarily wraps `globalThis.fetch` to detect/guard
// eager fetches during component rendering. `jose` uses global fetch by default,
// which can trip the dev warning when Firebase token verification happens during
// SSR. Capture a stable fetch reference once and pass it explicitly.
const stableFetch: typeof fetch = (
	globalThis as unknown as { __sparkStableFetch?: typeof fetch }
).__sparkStableFetch ?? globalThis.fetch.bind(globalThis);
(globalThis as unknown as { __sparkStableFetch?: typeof fetch }).__sparkStableFetch = stableFetch;
const jwks = createRemoteJWKSet(JWKS_URL, {
	[customFetch]: stableFetch
});

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
