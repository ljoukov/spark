import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import { SparkAgentWorkspaceFileSchema } from '@spark/schemas';

const querySchema = z.object({
	workspaceId: z.string().trim().min(1, 'workspaceId is required'),
	path: z.string().trim().min(1, 'path is required')
});

const workspaceStorageLinkSchema = z.object({
	type: z.literal('storage_link'),
	id: z.string().trim().min(1),
	storagePath: z.string().trim().min(1),
	contentType: z.string().trim().min(1),
	filename: z.string().trim().min(1).nullable().optional(),
	sizeBytes: z.number().int().min(1).nullable().optional(),
	pageCount: z.number().int().min(1).nullable().optional()
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function isAllowedStoragePath(userId: string, objectName: string): boolean {
	if (objectName.startsWith(`spark/uploads/${userId}/`)) {
		return true;
	}
	if (objectName.startsWith(`spark/${userId}/`)) {
		return true;
	}
	return false;
}

function normalizeObjectName(storagePath: string): string {
	return storagePath.replace(/^\/+/, '');
}

export const GET: RequestHandler = async ({ request, url }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	const parsedQuery = querySchema.safeParse({
		workspaceId: url.searchParams.get('workspaceId'),
		path: url.searchParams.get('path')
	});
	if (!parsedQuery.success) {
		return json({ error: 'invalid_query', issues: parsedQuery.error.issues }, { status: 400 });
	}
	const { workspaceId, path } = parsedQuery.data;
	const serviceAccountJson = requireServiceAccountJson();
	const fileDocPath = `users/${userId}/workspace/${workspaceId}/files/${encodeURIComponent(path)}`;
	const fileSnap = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: fileDocPath
	});
	if (!fileSnap.exists || !fileSnap.data) {
		return json({ error: 'not_found', message: 'Workspace file not found.' }, { status: 404 });
	}
	const parsedFile = SparkAgentWorkspaceFileSchema.safeParse(fileSnap.data);
	if (!parsedFile.success) {
		return json({ error: 'invalid_file', message: 'Workspace file is invalid.' }, { status: 500 });
	}
	const content = parsedFile.data.content.trim();
	if (!content.startsWith('{')) {
		return json({ error: 'not_link', message: 'Workspace file is not a storage link.' }, { status: 400 });
	}
	let parsedLinkRaw: unknown;
	try {
		parsedLinkRaw = JSON.parse(content);
	} catch {
		return json({ error: 'invalid_link', message: 'Workspace link JSON is invalid.' }, { status: 400 });
	}
	const parsedLink = workspaceStorageLinkSchema.safeParse(parsedLinkRaw);
	if (!parsedLink.success) {
		return json({ error: 'invalid_link', issues: parsedLink.error.issues }, { status: 400 });
	}
	const objectName = normalizeObjectName(parsedLink.data.storagePath);
	if (objectName.length === 0 || !isAllowedStoragePath(userId, objectName)) {
		return json({ error: 'not_found', message: 'Linked file not found.' }, { status: 404 });
	}
	const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
	const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;
	let bytes: Uint8Array;
	let downloadedContentType: string | null = null;
	try {
		const result = await downloadStorageObject({
			serviceAccountJson,
			bucketName,
			objectName
		});
		bytes = result.bytes;
		downloadedContentType = result.contentType;
	} catch (error) {
		console.error('Failed to download linked workspace file', {
			error,
			userId,
			workspaceId,
			path,
			objectName
		});
		return json({ error: 'download_failed', message: 'Unable to download linked file.' }, { status: 502 });
	}
	if (bytes.length === 0) {
		return json({ error: 'download_failed', message: 'Linked file is empty.' }, { status: 502 });
	}
	const filename = (parsedLink.data.filename ?? parsedLink.data.id).replace(/"/g, '');
	const headers = new Headers();
	headers.set('content-type', parsedLink.data.contentType || downloadedContentType || 'application/octet-stream');
	headers.set('cache-control', 'private, max-age=60');
	headers.set('content-disposition', `inline; filename="${filename}"`);
	const body =
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			: Uint8Array.from(bytes).buffer;
	return new Response(body, { status: 200, headers });
};
