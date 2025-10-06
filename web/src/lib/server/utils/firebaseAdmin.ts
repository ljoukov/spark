import { GOOGLE_SERVICE_ACCOUNT_JSON } from '$env/static/private';
import type { Bucket } from '@google-cloud/storage';
import type { App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { clientFirebaseConfig } from '../../config/firebase';
import {
	getFirebaseAdminApp as getSharedFirebaseAdminApp,
	parseFirebaseServiceAccount,
	type FirebaseServiceAccount,
	type FirebaseAdminOptions
} from '@spark/llm';

function loadServiceAccount(): FirebaseServiceAccount {
	if (!GOOGLE_SERVICE_ACCOUNT_JSON || GOOGLE_SERVICE_ACCOUNT_JSON.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be set');
	}
	return parseFirebaseServiceAccount(GOOGLE_SERVICE_ACCOUNT_JSON);
}

const serviceAccountConfig: FirebaseServiceAccount = Object.freeze(loadServiceAccount());

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
