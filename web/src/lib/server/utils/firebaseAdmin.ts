import type { Bucket } from '@google-cloud/storage';
import type { App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { clientFirebaseConfig } from '../../config/firebase';
import {
	getFirebaseAdminApp as getSharedFirebaseAdminApp,
	type FirebaseAdminOptions,
	getGoogleServiceAccount,
	type GoogleServiceAccount
} from '@spark/llm';

function loadServiceAccount(): GoogleServiceAccount {
	try {
		return getGoogleServiceAccount();
	} catch (error) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be set', {
			cause: error instanceof Error ? error : undefined
		});
	}
}

const serviceAccountConfig: GoogleServiceAccount = Object.freeze(loadServiceAccount());

const adminOptions: FirebaseAdminOptions = Object.freeze({
	storageBucket: clientFirebaseConfig.storageBucket
});

let cachedApp: App | null = null;

function getFirebaseAdminApp(): App {
	if (!cachedApp) {
		cachedApp = getSharedFirebaseAdminApp(serviceAccountConfig, adminOptions);
	}
	return cachedApp!;
}

export function getFirebaseAdminFirestore(): Firestore {
	return getFirestore(getFirebaseAdminApp());
}

export function getFirebaseAdminBucket(): Bucket {
	const storage = getStorage(getFirebaseAdminApp());
	return storage.bucket();
}

export function getFirebaseAdminAuth(): Auth {
	return getAuth(getFirebaseAdminApp());
}
