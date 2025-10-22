import type { Bucket } from '@google-cloud/storage';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { clientFirebaseConfig } from '../../config/firebase';
import {
	getFirebaseAdminAuth as getSharedFirebaseAdminAuth,
	getFirebaseAdminFirestore as getSharedFirebaseAdminFirestore,
	getFirebaseAdminStorage as getSharedFirebaseAdminStorage,
	type FirebaseAdminOptions,
	getGoogleServiceAccount,
	type GoogleServiceAccount
} from '@spark/llm';

let cachedServiceAccount: GoogleServiceAccount | null = null;

function resolveServiceAccount(): GoogleServiceAccount {
	if (!cachedServiceAccount) {
		cachedServiceAccount = getGoogleServiceAccount();
	}
	return cachedServiceAccount;
}

const adminOptions: FirebaseAdminOptions = {
	storageBucket: clientFirebaseConfig.storageBucket
};

export function getFirebaseAdminFirestore(): Firestore {
	return getSharedFirebaseAdminFirestore(resolveServiceAccount(), adminOptions);
}

export function getFirebaseAdminBucket(): Bucket {
	const storage = getSharedFirebaseAdminStorage(resolveServiceAccount(), adminOptions);
	return storage.bucket();
}

export function getFirebaseAdminAuth(): Auth {
	return getSharedFirebaseAdminAuth(resolveServiceAccount(), adminOptions);
}
