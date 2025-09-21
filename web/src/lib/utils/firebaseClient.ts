import { clientFirebaseConfig } from '$lib/config/firebase';
import { FirebaseError, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
	getAuth,
	GoogleAuthProvider,
	getRedirectResult,
	onAuthStateChanged,
	signInWithRedirect,
	signOut,
	type User
} from 'firebase/auth';

let app: FirebaseApp | undefined;

export function getFirebaseApp(): FirebaseApp {
	if (!app) {
		app = getApps().length ? getApps()[0]! : initializeApp(clientFirebaseConfig);
	}
	return app;
}

export async function startGoogleSignInRedirect(): Promise<void> {
	const auth = getAuth(getFirebaseApp());
	const provider = new GoogleAuthProvider();
	await signInWithRedirect(auth, provider);
}

export async function getRedirectResultIdToken(): Promise<string | null> {
	if (typeof window === 'undefined') {
		return null;
	}

	const auth = getAuth(getFirebaseApp());
	let resultUser = null;
	try {
		const result = await getRedirectResult(auth);
		resultUser = result?.user ?? null;
	} catch (error) {
		if (!(error instanceof FirebaseError) || error.code !== 'auth/no-auth-event') {
			throw error;
		}
	}

	if (!resultUser && !auth.currentUser) {
		resultUser = await new Promise<User | null>((resolve, reject) => {
			const unsubscribe = onAuthStateChanged(
				auth,
				(user) => {
					unsubscribe();
					resolve(user ?? null);
				},
				(error) => {
					unsubscribe();
					reject(error);
				}
			);
		});
	}

	const user = resultUser ?? auth.currentUser;
	if (!user) {
		return null;
	}
	const token = await user.getIdToken(/* forceRefresh */ true);
	return token;
}

export async function firebaseSignOut(): Promise<void> {
	const auth = getAuth(getFirebaseApp());
	await signOut(auth);
}
