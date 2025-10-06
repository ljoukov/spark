import { UserDocSchema, DEFAULT_USER_STATS, type UserDoc, type UserStats } from '@spark/schemas';
import { getFirebaseAdminFirestore } from '../utils/firebaseAdmin';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');

function resolveUserDocRef(userId: string) {
	const firestore = getFirebaseAdminFirestore();
	const id = userIdSchema.parse(userId);
	return firestore.collection('spark').doc(id);
}

export async function getUserDoc(userId: string): Promise<UserDoc | null> {
	const snapshot = await resolveUserDocRef(userId).get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data() ?? {};
	return UserDocSchema.parse(raw);
}

export async function getUserStats(userId: string): Promise<UserStats> {
	const doc = await getUserDoc(userId);
	return doc?.stats ?? DEFAULT_USER_STATS;
}
