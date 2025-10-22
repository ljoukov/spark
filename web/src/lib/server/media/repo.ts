import {
	getFirebaseAdminFirestore,
	getFirebaseAdminStorage,
	getFirebaseStorageBucketName
} from '@spark/llm';
import {
	SessionMediaDocSchema,
	type SessionMediaDoc,
	type SessionMediaSupplementaryImage
} from '@spark/schemas';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');
const planItemIdSchema = z.string().trim().min(1, 'planItemId is required');

function getFirestore() {
	return getFirebaseAdminFirestore();
}

function getStorageBucket() {
	const storage = getFirebaseAdminStorage();
	return storage.bucket(getFirebaseStorageBucketName());
}

function normaliseStoragePath(input: string): string {
	return input.replace(/^\/+/, '');
}

async function createSignedUrl(storagePath: string): Promise<{ url: string; expiresAt: Date }> {
	const bucket = getStorageBucket();
	const file = bucket.file(normaliseStoragePath(storagePath));
	const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
	const [url] = await file.getSignedUrl({
		action: 'read',
		expires: expiresAt
	});
	return { url, expiresAt };
}

export type SessionMediaImageWithUrl = SessionMediaDoc['images'][number] & {
	signedUrl: string | null;
	signedUrlExpiresAt: Date | null;
	url: string | null;
};

export type SessionMediaSupplementaryImageWithUrl = SessionMediaSupplementaryImage & {
	signedUrl: string | null;
	signedUrlExpiresAt: Date | null;
	url: string | null;
};

export type SessionMediaWithUrl = Omit<SessionMediaDoc, 'posterImage' | 'endingImage'> & {
	audio: SessionMediaDoc['audio'] & {
		signedUrl: string | null;
		signedUrlExpiresAt: Date | null;
		url: string | null;
	};
	images: SessionMediaImageWithUrl[];
	posterImage: SessionMediaSupplementaryImageWithUrl | null;
	endingImage: SessionMediaSupplementaryImageWithUrl | null;
};

export async function getSessionMedia(
	userId: string,
	sessionId: string,
	planItemId: string
): Promise<SessionMediaWithUrl | null> {
	const firestore = getFirestore();
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

	let audioSignedUrl: string | null = null;
	let audioSignedUrlExpiresAt: Date | null = null;

	if (parsed.audio.storagePath) {
		try {
			const { url, expiresAt } = await createSignedUrl(parsed.audio.storagePath);
			audioSignedUrl = url;
			audioSignedUrlExpiresAt = expiresAt;
		} catch (error) {
			console.warn(
				`Unable to create signed URL for session media ${parsed.id} at ${parsed.audio.storagePath}`,
				error
			);
		}
	}

	const audioUrl = audioSignedUrl;

	async function buildSupplementaryImage(
		image: SessionMediaSupplementaryImage | undefined,
		kind: 'poster' | 'ending'
	): Promise<SessionMediaSupplementaryImageWithUrl | null> {
		if (!image) {
			return null;
		}
		let signedUrl: string | null = null;
		let signedUrlExpiresAt: Date | null = null;

		if (image.storagePath) {
			try {
				const { url, expiresAt } = await createSignedUrl(image.storagePath);
				signedUrl = url;
				signedUrlExpiresAt = expiresAt;
			} catch (error) {
				console.warn(
					`Unable to create signed URL for session media ${parsed.id} ${kind} image at ${image.storagePath}`,
					error
				);
			}
		}

		const url = signedUrl;

		return {
			...image,
			signedUrl,
			signedUrlExpiresAt,
			url
		};
	}

	const images: SessionMediaImageWithUrl[] = await Promise.all(
		parsed.images.map(async (image) => {
			let signedUrl: string | null = null;
			let signedUrlExpiresAt: Date | null = null;

			if (image.storagePath) {
				try {
					const { url, expiresAt } = await createSignedUrl(image.storagePath);
					signedUrl = url;
					signedUrlExpiresAt = expiresAt;
				} catch (error) {
					console.warn(
						`Unable to create signed URL for session media image ${parsed.id} at ${image.storagePath}`,
						error
					);
				}
			}

			const url = signedUrl;

			return {
				...image,
				signedUrl,
				signedUrlExpiresAt,
				url
			};
		})
	);

	const [posterImage, endingImage] = await Promise.all([
		buildSupplementaryImage(parsed.posterImage, 'poster'),
		buildSupplementaryImage(parsed.endingImage, 'ending')
	]);

	return {
		...parsed,
		audio: {
			...parsed.audio,
			signedUrl: audioSignedUrl,
			signedUrlExpiresAt: audioSignedUrlExpiresAt,
			url: audioUrl
		},
		images,
		posterImage,
		endingImage
	};
}
