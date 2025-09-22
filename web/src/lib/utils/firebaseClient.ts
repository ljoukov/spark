import { clientFirebaseConfig } from '$lib/config/firebase';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
	getAuth,
	signOut,
	GoogleAuthProvider,
	setPersistence,
	browserLocalPersistence,
	browserSessionPersistence,
	getRedirectResult
} from 'firebase/auth';

let app: FirebaseApp | undefined;

export function getFirebaseApp(): FirebaseApp {
	if (!app) {
		app = getApps().length ? getApps()[0]! : initializeApp(clientFirebaseConfig);
	}
	return app;
}

export async function firebaseSignOut(): Promise<void> {
	const auth = getAuth(getFirebaseApp());
	await signOut(auth);
}

/**
 * Starts Google sign-in using Firebase Web SDK redirect flow.
 * Uses durable persistence to survive the full-page redirect.
 */
export async function startGoogleSignInRedirect(): Promise<void> {
	const auth = getAuth(getFirebaseApp());
	try {
		await setPersistence(auth, browserLocalPersistence);
	} catch {
		await setPersistence(auth, browserSessionPersistence);
	}
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: 'select_account' });
	// Fire-and-forget; caller typically doesn't await this because it navigates away
	return (await import('firebase/auth')).signInWithRedirect(auth, provider);
}

/**
 * Starts Google sign-in using Firebase Web SDK popup flow.
 * Uses durable persistence so the session survives reloads.
 */
export async function startGoogleSignInPopup(): Promise<void> {
	const auth = getAuth(getFirebaseApp());
	try {
		await setPersistence(auth, browserLocalPersistence);
	} catch {
		await setPersistence(auth, browserSessionPersistence);
	}
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: 'select_account' });
	await (await import('firebase/auth')).signInWithPopup(auth, provider);
}

/**
 * After a redirect-based sign-in, returns the Google ID token from the OAuth
 * credential (NOT the Firebase ID token). This token can be exchanged on the
 * server with Identity Toolkit to mint Firebase ID/refresh tokens for the
 * HTTP-only session cookie used by SSR.
 * Returns null if there is no redirect result.
 */
export async function getRedirectResultIdToken(): Promise<string | null> {
	const auth = getAuth(getFirebaseApp());
	const result = await getRedirectResult(auth).catch(() => null);
	if (!result) return null;
	const { GoogleAuthProvider } = await import('firebase/auth');
	const credential = GoogleAuthProvider.credentialFromResult(result);
	return credential?.idToken ?? null;
}
