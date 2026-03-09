import { dev } from '$app/environment';

function currentHostAuthDomain(): string {
	if (typeof window === 'undefined') {
		if (dev) {
			// Dev-only fallback for any accidental server-side evaluation.
			return import.meta.env.VITE_DEV_AUTH_HOST ?? 'localhost:8080';
		}
		throw new Error('Firebase authDomain must be resolved in the browser');
	}
	return window.location.host; // self-hosted auth helpers live under this domain
}

export const firebaseClientBaseConfig = {
	apiKey: 'AIzaSyDy9h1WEveGy10w_8m6Aa-Bax9mNF2OKuw',
	projectId: 'pic2toon',
	storageBucket: 'pic2toon.firebasestorage.app',
	messagingSenderId: '1083072308192',
	appId: '1:1083072308192:web:db604280a19f025e938185',
	measurementId: 'G-V068HR5F8T'
} as const;

export function getClientFirebaseConfig() {
	return {
		...firebaseClientBaseConfig,
		// Point authDomain to the current app host so Firebase targets
		// https://<host>/__/auth/handler, keeping prod hostnames out of source.
		authDomain: currentHostAuthDomain()
	} as const;
}
