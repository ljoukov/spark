import { GOOGLE_SERVICE_ACCOUNT_JSON } from '$env/static/private';
import type { Bucket } from '@google-cloud/storage';
import type { App, ServiceAccount } from 'firebase-admin/app';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { z } from 'zod';
import { clientFirebaseConfig } from './firebaseClient';

const rawServiceAccountSchema = z
	.string({ message: 'GOOGLE_SERVICE_ACCOUNT_JSON must be set' })
	.min(1, 'Service account JSON cannot be empty');

const serviceAccountJsonSchema = z
	.object({
		project_id: z.string().min(1, 'project_id is required'),
		client_email: z.email('client_email must be a valid email'),
		private_key: z.string().min(1, 'private_key is required'),
		private_key_id: z.string().optional()
	})
	.transform(({ project_id, client_email, private_key }) => ({
		projectId: project_id,
		clientEmail: client_email,
		privateKey: private_key.replace(/\\n/g, '\n')
	}));

const rawServiceAccountJson = rawServiceAccountSchema.parse(GOOGLE_SERVICE_ACCOUNT_JSON);

const serviceAccountConfig = Object.freeze(
	serviceAccountJsonSchema.parse(JSON.parse(rawServiceAccountJson))
);

function resolveServiceAccount(): Readonly<ServiceAccount> {
	return serviceAccountConfig;
}

let cachedApp: App | null = null;

function getFirebaseAdminApp(): App {
	if (cachedApp) {
		return cachedApp;
	}

	const existing = getApps();
	if (existing.length > 0) {
		cachedApp = existing[0]!;
		return cachedApp;
	}

	const serviceAccount = resolveServiceAccount();

	cachedApp = initializeApp({
		projectId: serviceAccount.projectId,
		credential: cert(serviceAccount),
		storageBucket: clientFirebaseConfig.storageBucket
	});
	return cachedApp;
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
