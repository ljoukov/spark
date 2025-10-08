import { getFirebaseAdminBucket, getFirebaseAdminFirestore } from '../utils/firebaseAdmin';
import { SessionMediaDocSchema, type SessionMediaDoc } from '@spark/schemas';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');
const planItemIdSchema = z.string().trim().min(1, 'planItemId is required');

function normaliseStoragePath(input: string): string {
	return input.replace(/^\/+/, '');
}

export type SessionMediaWithUrl = SessionMediaDoc & {
	audio: SessionMediaDoc['audio'] & {
		signedUrl: string | null;
		signedUrlExpiresAt: Date | null;
	};
};

export async function getSessionMedia(
	userId: string,
	sessionId: string,
	planItemId: string
): Promise<SessionMediaWithUrl | null> {
	const firestore = getFirebaseAdminFirestore();
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	const pid = planItemIdSchema.parse(planItemId);

	const docRef = firestore
		.collection('spark')
		.doc(uid)
		.collection('sessions')
		.doc(sid)
		.collection('media')
		.doc(pid);

	const snapshot = await docRef.get();
	if (!snapshot.exists) {
		return null;
	}

	const data = snapshot.data();
	if (!data) {
		return null;
	}

	let parsed: SessionMediaDoc;
	try {
		parsed = SessionMediaDocSchema.parse({
			id: snapshot.id,
			...data
		});
	} catch (error) {
		console.error('Failed to parse session media document', snapshot.id, error);
		throw error;
	}

	let signedUrl: string | null = null;
	let signedUrlExpiresAt: Date | null = null;

	if (parsed.audio.storagePath) {
		try {
			const bucket = getFirebaseAdminBucket();
			const file = bucket.file(normaliseStoragePath(parsed.audio.storagePath));
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
			const [url] = await file.getSignedUrl({
				action: 'read',
				expires: expiresAt
			});
			signedUrl = url;
			signedUrlExpiresAt = expiresAt;
		} catch (error) {
			console.warn(
				`Unable to create signed URL for session media ${parsed.id} at ${parsed.audio.storagePath}`,
				error
			);
			signedUrl = parsed.audio.downloadUrl ?? null;
		}
	} else if (parsed.audio.downloadUrl) {
		signedUrl = parsed.audio.downloadUrl;
	}

	return {
		...parsed,
		audio: {
			...parsed.audio,
			signedUrl,
			signedUrlExpiresAt
		},
	};
}
