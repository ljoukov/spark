import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { SessionMediaDocSchema, type SessionMediaDoc } from '@spark/schemas';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';

const querySchema = z
	.object({
		sessionId: z.string().trim().min(1, 'sessionId is required'),
		planItemId: z.string().trim().min(1, 'planItemId is required'),
		kind: z.enum(['audio', 'image', 'poster', 'ending']),
		index: z.coerce.number().int().min(0).optional()
	})
	.superRefine((value, ctx) => {
		if (value.kind === 'image' && value.index === undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['index'],
				message: 'index is required for image assets'
			});
		}
	});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function normalizeObjectName(storagePath: string): string {
	return storagePath.replace(/^\/+/, '');
}

function isAllowedStoragePath(userId: string, objectName: string): boolean {
	if (objectName.startsWith(`spark/${userId}/`)) {
		return true;
	}
	if (objectName.startsWith(`spark/uploads/${userId}/`)) {
		return true;
	}
	return false;
}

function resolveMediaStoragePath(
	media: SessionMediaDoc,
	kind: z.infer<typeof querySchema>['kind'],
	index: number | undefined
): { storagePath: string | null; mimeType: string | null; filename: string } {
	switch (kind) {
		case 'audio': {
			const storagePath = media.audio.storagePath ?? null;
			return {
				storagePath,
				mimeType: media.audio.mimeType ?? null,
				filename: `${media.planItemId}.mp3`
			};
		}
		case 'image': {
			const target = media.images.find((image) => image.index === (index ?? -1));
			return {
				storagePath: target?.storagePath ?? null,
				mimeType: null,
				filename: `${media.planItemId}-${index ?? 'image'}.png`
			};
		}
		case 'poster': {
			return {
				storagePath: media.posterImage?.storagePath ?? null,
				mimeType: null,
				filename: `${media.planItemId}-poster.png`
			};
		}
		case 'ending': {
			return {
				storagePath: media.endingImage?.storagePath ?? null,
				mimeType: null,
				filename: `${media.planItemId}-ending.png`
			};
		}
	}
}

export const GET: RequestHandler = async ({ request, url }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsed: z.infer<typeof querySchema>;
	try {
		parsed = querySchema.parse({
			sessionId: url.searchParams.get('sessionId'),
			planItemId: url.searchParams.get('planItemId'),
			kind: url.searchParams.get('kind'),
			index: url.searchParams.get('index')
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_query', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_query' }, { status: 400 });
	}

	const serviceAccountJson = requireServiceAccountJson();
	const documentPath = `spark/${userId}/sessions/${parsed.sessionId}/media/${parsed.planItemId}`;

	const snapshot = await getFirestoreDocument({ serviceAccountJson, documentPath });
	if (!snapshot.exists || !snapshot.data) {
		return json({ error: 'not_found', message: 'Media not found' }, { status: 404 });
	}

	let media: SessionMediaDoc;
	try {
		media = SessionMediaDocSchema.parse({ id: parsed.planItemId, ...snapshot.data });
	} catch (error) {
		console.error('Failed to parse session media document', { error, userId, documentPath });
		return json(
			{ error: 'invalid_media', message: 'Media document is invalid.' },
			{ status: 500 }
		);
	}

	const resolved = resolveMediaStoragePath(media, parsed.kind, parsed.index);
	if (!resolved.storagePath) {
		return json({ error: 'not_found', message: 'Media asset not found' }, { status: 404 });
	}

	const objectName = normalizeObjectName(resolved.storagePath);
	if (!objectName) {
		return json({ error: 'not_found', message: 'Media asset not found' }, { status: 404 });
	}
	if (!isAllowedStoragePath(userId, objectName)) {
		return json({ error: 'not_found', message: 'Media asset not found' }, { status: 404 });
	}

	const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
	const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;

	let bytes: Uint8Array;
	let contentType: string | null = null;
	try {
		const result = await downloadStorageObject({
			serviceAccountJson,
			bucketName,
			objectName
		});
		bytes = result.bytes;
		contentType = result.contentType;
	} catch (error) {
		console.error('Failed to download media asset', { error, userId, objectName });
		return json(
			{ error: 'download_failed', message: 'Unable to download media asset.' },
			{ status: 502 }
		);
	}

	if (bytes.length === 0) {
		return json({ error: 'download_failed', message: 'Media asset is empty.' }, { status: 502 });
	}

	const headers = new Headers();
	headers.set('content-type', resolved.mimeType ?? contentType ?? 'application/octet-stream');
	headers.set('cache-control', 'private, max-age=60');
	headers.set(
		'content-disposition',
		`inline; filename=\"${resolved.filename.replace(/\"/g, '')}\"`
	);

	const body =
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			: Uint8Array.from(bytes).buffer;
	return new Response(body, { status: 200, headers });
};
