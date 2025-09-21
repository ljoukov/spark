import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

// Firebase web config provided by the user
export const clientFirebaseConfig = {
	apiKey: 'AIzaSyDy9h1WEveGy10w_8m6Aa-Bax9mNF2OKuw',
	authDomain: 'pic2toon.firebaseapp.com',
	projectId: 'pic2toon',
	storageBucket: 'pic2toon.firebasestorage.app',
	messagingSenderId: '1083072308192',
	appId: '1:1083072308192:web:db604280a19f025e938185',
	measurementId: 'G-V068HR5F8T'
} as const;

let app: FirebaseApp | undefined;
let warnedMissingRecaptchaKey = false;
let appCheckBootstrapped = false;

export function getFirebaseApp(): FirebaseApp {
	if (!app) {
		app = getApps().length ? getApps()[0]! : initializeApp(clientFirebaseConfig);
	}
	if (typeof window !== 'undefined' && !appCheckBootstrapped) {
		// AppCheck fails with browser printing:
		// [2025-09-17T22:32:53.127Z]  @firebase/auth: Auth (12.2.0):
		//     Error while retrieving App Check token: FirebaseError: AppCheck: 403 error.
		//     Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).
		// TODO: fix app check and enable: bootstrapAppCheck(app);
	}
	return app;
}

function bootstrapAppCheck(firebaseApp: FirebaseApp) {
	appCheckBootstrapped = true;
	const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
	if (!siteKey || siteKey.length === 0) {
		if (!warnedMissingRecaptchaKey && process.env.NODE_ENV !== 'production') {
			warnedMissingRecaptchaKey = true;
			console.warn('App Check requires NEXT_PUBLIC_RECAPTCHA_SITE_KEY to be set.');
		}
		return;
	}

	try {
		initializeAppCheck(firebaseApp, {
			provider: new ReCaptchaV3Provider(siteKey),
			isTokenAutoRefreshEnabled: true
		});
		if (process.env.NODE_ENV !== 'production') {
			console.info('Firebase App Check initialized.');
		}
	} catch (error) {
		console.error('Failed to initialize Firebase App Check', error);
	}
}

export async function googleSignInAndGetIdToken(): Promise<string> {
	const auth = getAuth(getFirebaseApp());
	const provider = new GoogleAuthProvider();
	const cred = await signInWithPopup(auth, provider);
	const token = await cred.user.getIdToken(/* forceRefresh */ true);
	return token;
}

export async function firebaseSignOut(): Promise<void> {
	const auth = getAuth(getFirebaseApp());
	await signOut(auth);
}
