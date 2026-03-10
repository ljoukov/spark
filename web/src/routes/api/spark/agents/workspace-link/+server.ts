import { json, type RequestHandler } from '@sveltejs/kit';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore } from '@ljoukov/firebase-admin-cloudflare/firestore';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import {
	SparkAgentWorkspaceFileSchema
} from '@spark/schemas';
import {
	buildWorkspaceFileDocPath,
	isAllowedWorkspaceStoragePath,
	normalizeStorageObjectName,
	resolveWorkspaceFilePathFromFirestoreDocument,
	resolveStorageLinkFromWorkspaceFile
} from '@spark/llm';

const querySchema = z.object({
	workspaceId: z.string().trim().min(1, 'workspaceId is required'),
	path: z.string().trim().min(1, 'path is required')
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
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
	const fileDocPath = buildWorkspaceFileDocPath({
		userId,
		workspaceId,
		filePath: path
	});
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const fileSnap = await getDoc(doc(firestore, fileDocPath));
	if (!fileSnap.exists) {
		return json({ error: 'not_found', message: 'Workspace file not found.' }, { status: 404 });
	}
	const parsedFile = SparkAgentWorkspaceFileSchema.safeParse({
		...(fileSnap.data() ?? {}),
		path: resolveWorkspaceFilePathFromFirestoreDocument({
			documentPath: fileDocPath,
			storedPath: fileSnap.data()?.path
		})
	});
	if (!parsedFile.success) {
		return json({ error: 'invalid_file', message: 'Workspace file is invalid.' }, { status: 500 });
	}
	const storageLink = resolveStorageLinkFromWorkspaceFile(parsedFile.data);
	if (!storageLink) {
		return json({ error: 'not_link', message: 'Workspace file is not a storage link.' }, { status: 400 });
	}
	const objectName = normalizeStorageObjectName(storageLink.storagePath);
	if (objectName.length === 0 || !isAllowedWorkspaceStoragePath(userId, objectName)) {
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
	const filename = path.split('/').at(-1)?.replace(/"/g, '') ?? 'file';
	const headers = new Headers();
	headers.set('content-type', storageLink.contentType || downloadedContentType || 'application/octet-stream');
	headers.set('cache-control', 'private, max-age=60');
	headers.set('content-disposition', `inline; filename="${filename}"`);
	const body =
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			: Uint8Array.from(bytes).buffer;
	return new Response(body, { status: 200, headers });
};
