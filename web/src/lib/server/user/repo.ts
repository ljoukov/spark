import { UserDocSchema, DEFAULT_USER_STATS, type UserDoc, type UserStats } from '@spark/schemas';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';

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
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveUserDocPath(userId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	return UserDocSchema.parse(snapshot.data ?? {});
}

export async function getUserStats(userId: string): Promise<UserStats> {
	const doc = await getUserDoc(userId);
	return doc?.stats ?? DEFAULT_USER_STATS;
}
