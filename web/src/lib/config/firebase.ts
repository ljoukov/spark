import { env as publicEnv } from '$env/dynamic/public';
import { PUBLIC_FIREBASE_AUTH_DOMAIN } from '$env/static/public';
import { z } from 'zod';

const BASE_FIREBASE_CONFIG = {
	apiKey: 'AIzaSyDy9h1WEveGy10w_8m6Aa-Bax9mNF2OKuw',
	projectId: 'pic2toon',
	storageBucket: 'pic2toon.firebasestorage.app',
	messagingSenderId: '1083072308192',
	appId: '1:1083072308192:web:db604280a19f025e938185',
	measurementId: 'G-V068HR5F8T'
} as const;

const authDomainSchema = z
	.string()
	.trim()
	.min(1, 'Firebase auth domain cannot be empty')
	.refine((value) => !value.startsWith('http://') && !value.startsWith('https://'), {
		message: 'Firebase auth domain must not include a protocol'
	})
	.refine((value) => !value.endsWith('/'), {
		message: 'Firebase auth domain must not include a trailing slash'
	})
	.refine((value) => !value.includes('/'), {
		message: 'Firebase auth domain must only include the host name'
	});

function resolveAuthDomain(): string {
	const runtimeCandidate = publicEnv.PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
	const staticCandidate = PUBLIC_FIREBASE_AUTH_DOMAIN.trim();
	const candidate = runtimeCandidate ?? staticCandidate;

	if (!candidate) {
		throw new Error('PUBLIC_FIREBASE_AUTH_DOMAIN must be set for Firebase Auth redirect flow.');
	}

	return authDomainSchema.parse(candidate);
}

const firebaseConfigSchema = z.object({
	apiKey: z.string().min(1, 'Firebase apiKey is required'),
	authDomain: authDomainSchema,
	projectId: z.string().min(1, 'Firebase projectId is required'),
	storageBucket: z.string().min(1, 'Firebase storageBucket is required'),
	messagingSenderId: z.string().min(1, 'Firebase messagingSenderId is required'),
	appId: z.string().min(1, 'Firebase appId is required'),
	measurementId: z.string().min(1, 'Firebase measurementId is required')
});

export const clientFirebaseConfig = Object.freeze(
	firebaseConfigSchema.parse({
		...BASE_FIREBASE_CONFIG,
		authDomain: resolveAuthDomain()
	})
);

export const firebaseAuthHelperHost = `${clientFirebaseConfig.projectId}.firebaseapp.com` as const;
export const firebaseAuthHelperOrigin = `https://${firebaseAuthHelperHost}` as const;
