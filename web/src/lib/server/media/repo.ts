import {
	SessionMediaDocSchema,
	type SessionMediaDoc,
	type SessionMediaSupplementaryImage
} from '@spark/schemas';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');
const planItemIdSchema = z.string().trim().min(1, 'planItemId is required');

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function buildMediaUrl(params: { sessionId: string; planItemId: string; kind: string; index?: number }): string {
	const url = new URL('/api/media', 'https://placeholder.invalid');
	url.searchParams.set('sessionId', params.sessionId);
	url.searchParams.set('planItemId', params.planItemId);
	url.searchParams.set('kind', params.kind);
	if (typeof params.index === 'number') {
		url.searchParams.set('index', String(params.index));
	}
	return `${url.pathname}?${url.searchParams.toString()}`;
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
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	const pid = planItemIdSchema.parse(planItemId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `spark/${uid}/sessions/${sid}/media/${pid}`
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}

	let parsed: SessionMediaDoc;
	try {
		parsed = SessionMediaDocSchema.parse({
			id: pid,
			...snapshot.data
		});
	} catch (error) {
		console.error('Failed to parse session media document', pid, error);
		throw error;
	}
	const audioUrl = buildMediaUrl({ sessionId: sid, planItemId: pid, kind: 'audio' });

	async function buildSupplementaryImage(
		image: SessionMediaSupplementaryImage | undefined,
		kind: 'poster' | 'ending'
	): Promise<SessionMediaSupplementaryImageWithUrl | null> {
		if (!image) {
			return null;
		}
		const url = buildMediaUrl({ sessionId: sid, planItemId: pid, kind });

		return {
			...image,
			signedUrl: null,
			signedUrlExpiresAt: null,
			url
		};
	}

	const images: SessionMediaImageWithUrl[] = await Promise.all(
		parsed.images.map(async (image) => {
			const url = buildMediaUrl({ sessionId: sid, planItemId: pid, kind: 'image', index: image.index });

			return {
				...image,
				signedUrl: null,
				signedUrlExpiresAt: null,
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
			signedUrl: null,
			signedUrlExpiresAt: null,
			url: audioUrl
		},
		images,
		posterImage,
		endingImage
	};
}
