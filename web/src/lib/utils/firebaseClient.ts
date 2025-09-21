import { clientFirebaseConfig } from '$lib/config/firebase';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signOut } from 'firebase/auth';

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
