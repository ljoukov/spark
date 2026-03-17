import { UserDocSchema, DEFAULT_USER_STATS, type UserDoc, type UserStats } from '@spark/schemas';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore } from '@ljoukov/firebase-admin-cloudflare/firestore';
import { z } from 'zod';
import { env } from '$env/dynamic/private';

const userIdSchema = z.string().trim().min(1, 'userId is required');

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function resolveUserDocPath(userId: string): string {
	const id = userIdSchema.parse(userId);
	return `spark/${id}`;
}

export async function getUserDoc(userId: string): Promise<UserDoc | null> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const snapshot = await getDoc(doc(firestore, resolveUserDocPath(userId)));
	if (!snapshot.exists) {
		return null;
	}
	return UserDocSchema.parse(snapshot.data() ?? {});
}

export async function getUserStats(userId: string): Promise<UserStats> {
	const doc = await getUserDoc(userId);
	return doc?.stats ?? DEFAULT_USER_STATS;
}
