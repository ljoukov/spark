import type { Bucket } from '@google-cloud/storage';
import type { App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { clientFirebaseConfig } from '../../config/firebase';
import {
	getFirebaseAdminApp as getSharedFirebaseAdminApp,
	getFirebaseAdminAuth as getSharedFirebaseAdminAuth,
	getFirebaseAdminFirestore as getSharedFirebaseAdminFirestore,
	getFirebaseAdminStorage as getSharedFirebaseAdminStorage,
	type FirebaseAdminOptions,
	getGoogleServiceAccount,
	type GoogleServiceAccount
} from '@spark/llm';

const serviceAccountConfig: GoogleServiceAccount = Object.freeze(getGoogleServiceAccount());

const adminOptions: FirebaseAdminOptions = Object.freeze({
	storageBucket: clientFirebaseConfig.storageBucket
});

function getFirebaseAdminApp(): App {
	return getSharedFirebaseAdminApp(serviceAccountConfig, adminOptions);
}

export function getFirebaseAdminFirestore(): Firestore {
	return getSharedFirebaseAdminFirestore(serviceAccountConfig, adminOptions);
}

export function getFirebaseAdminBucket(): Bucket {
	const storage = getSharedFirebaseAdminStorage(serviceAccountConfig, adminOptions);
	return storage.bucket();
}

export function getFirebaseAdminAuth(): Auth {
	return getSharedFirebaseAdminAuth(serviceAccountConfig, adminOptions);
}
