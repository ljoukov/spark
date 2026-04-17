import path from 'node:path';

import { json, type RequestHandler } from '@sveltejs/kit';
import { isAllowedSharedPdfStoragePath, normalizeStorageObjectName } from '@spark/llm';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

const querySchema = z.object({
	path: z.string().trim().min(1),
	filename: z.string().trim().min(1).optional()
});

export const GET: RequestHandler = async ({ request, url }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let parsedQuery: z.infer<typeof querySchema>;
	try {
		parsedQuery = querySchema.parse({
			path: url.searchParams.get('path'),
			filename: url.searchParams.get('filename') ?? undefined
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	const objectName = normalizeStorageObjectName(parsedQuery.path);
	if (!isAllowedSharedPdfStoragePath(objectName)) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const serviceAccountJson = requireTutorServiceAccountJson();
	const bucketName = `${parseGoogleServiceAccountJson(serviceAccountJson).projectId}.firebasestorage.app`;

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
		console.error('Failed to download shared PDF', {
			error,
			storagePath: objectName
		});
		return json({ error: 'download_failed' }, { status: 502 });
	}

	if (bytes.length === 0 || Buffer.from(bytes).subarray(0, 5).toString('utf8') !== '%PDF-') {
		return json({ error: 'download_failed' }, { status: 502 });
	}

	const filename = (parsedQuery.filename ?? path.basename(objectName)).replace(/"/g, '');
	const headers = new Headers();
	headers.set('content-type', contentType || 'application/pdf');
	headers.set('cache-control', 'private, max-age=300');
	headers.set('content-disposition', `inline; filename="${filename}"`);

	const body =
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			: Uint8Array.from(bytes).buffer;
	return new Response(body, { status: 200, headers });
};
