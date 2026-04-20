import path from 'node:path';

import { json, type RequestHandler } from '@sveltejs/kit';
import { SparkAgentWorkspaceFileSchema } from '@spark/schemas';
import {
	buildWorkspaceFileDocPath,
	isAllowedWorkspaceStoragePath,
	normalizeStorageObjectName
} from '@spark/llm';
import sharp from 'sharp';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import { getGraderRun } from '$lib/server/grader/repo';
import {
	isAllowedSourcePageImagePath,
	isAllowedSourceAttachmentPath,
	isAllowedWorksheetAssetPath
} from '$lib/server/grader/sheetAssets';
import { findTutorSessionForSheet } from '$lib/server/tutorSessions/repo';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const querySchema = z.object({
	path: z.string().trim().min(1),
	filename: z.string().trim().min(1).optional()
});
const SOURCE_IMAGE_RESPONSE_MAX_DIMENSION = 1500;
const SOURCE_IMAGE_RESPONSE_JPEG_QUALITY = 85;
const SOURCE_IMAGE_RESPONSE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isAllowedSheetAttachmentPath(filePath: string): boolean {
	const parts = filePath.split('/').filter((part) => part.length > 0);
	return (
		parts.length >= 5 &&
		parts[0] === 'feedback' &&
		parts[1] === 'questions' &&
		parts[3] === 'uploads'
	);
}

function normalizeContentType(contentType: string | null | undefined): string {
	return contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function withJpegExtension(filename: string): string {
	return filename.replace(/\.[A-Za-z0-9]+$/u, '') + '.jpg';
}

async function optimizeSourceImageResponse(options: {
	bytes: Uint8Array;
	contentType: string;
	filePath: string;
	userId: string;
	sheetId: string;
}): Promise<{ bytes: Uint8Array; contentType: string; filenameExtension: 'jpg' | null }> {
	const isSourceImage =
		isAllowedSourceAttachmentPath(options.filePath) ||
		isAllowedSourcePageImagePath(options.filePath);
	if (!isSourceImage || !SOURCE_IMAGE_RESPONSE_CONTENT_TYPES.has(options.contentType)) {
		return { bytes: options.bytes, contentType: options.contentType, filenameExtension: null };
	}
	try {
		const optimized = await sharp(options.bytes)
			.rotate()
			.resize({
				width: SOURCE_IMAGE_RESPONSE_MAX_DIMENSION,
				height: SOURCE_IMAGE_RESPONSE_MAX_DIMENSION,
				fit: 'inside',
				withoutEnlargement: true
			})
			.jpeg({ quality: SOURCE_IMAGE_RESPONSE_JPEG_QUALITY, mozjpeg: true })
			.toBuffer();
		return {
			bytes: Uint8Array.from(optimized),
			contentType: 'image/jpeg',
			filenameExtension: 'jpg'
		};
	} catch (error) {
		console.warn('Failed to optimize source sheet image response', {
			error,
			userId: options.userId,
			sheetId: options.sheetId,
			filePath: options.filePath
		});
		return { bytes: options.bytes, contentType: options.contentType, filenameExtension: null };
	}
}

export const GET: RequestHandler = async ({ request, params, url }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsedParams: z.infer<typeof paramsSchema>;
	let parsedQuery: z.infer<typeof querySchema>;
	try {
		parsedParams = paramsSchema.parse(params);
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

	if (!isAllowedSheetAttachmentPath(parsedQuery.path)) {
		if (
			!isAllowedWorksheetAssetPath(parsedQuery.path) &&
			!isAllowedSourcePageImagePath(parsedQuery.path) &&
			!isAllowedSourceAttachmentPath(parsedQuery.path)
		) {
			return json({ error: 'not_found' }, { status: 404 });
		}
	}

	const run = await getGraderRun(userId, parsedParams.sheetId);
	if (!run) {
		return json({ error: 'sheet_not_found' }, { status: 404 });
	}

	const isRunWorkspaceFile =
		isAllowedWorksheetAssetPath(parsedQuery.path) ||
		isAllowedSourcePageImagePath(parsedQuery.path) ||
		isAllowedSourceAttachmentPath(parsedQuery.path);
	const session = isRunWorkspaceFile
		? null
		: await findTutorSessionForSheet({
				userId,
				runId: run.id
			});
	if (!isRunWorkspaceFile && !session) {
		return json({ error: 'not_found' }, { status: 404 });
	}
	const workspaceId = isRunWorkspaceFile ? run.workspaceId : session?.workspaceId;
	if (!workspaceId) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const serviceAccountJson = requireTutorServiceAccountJson();
	const snapshot = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: buildWorkspaceFileDocPath({
			userId,
			workspaceId,
			filePath: parsedQuery.path
		})
	});
	if (!snapshot.exists || !snapshot.data) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const parsedFile = SparkAgentWorkspaceFileSchema.safeParse({
		...snapshot.data,
		path: parsedQuery.path
	});
	if (!parsedFile.success || parsedFile.data.type !== 'storage_link') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const objectName = normalizeStorageObjectName(parsedFile.data.storagePath);
	if (!isAllowedWorkspaceStoragePath(userId, objectName)) {
		return json({ error: 'not_found' }, { status: 404 });
	}

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
		console.error('Failed to download sheet attachment', {
			error,
			userId,
			sheetId: parsedParams.sheetId,
			filePath: parsedQuery.path
		});
		return json({ error: 'download_failed' }, { status: 502 });
	}

	if (bytes.length === 0) {
		return json({ error: 'download_failed' }, { status: 502 });
	}

	const responseContentType = normalizeContentType(
		parsedFile.data.contentType || contentType || 'application/octet-stream'
	);
	const optimized = await optimizeSourceImageResponse({
		bytes,
		contentType: responseContentType,
		filePath: parsedQuery.path,
		userId,
		sheetId: parsedParams.sheetId
	});
	bytes = optimized.bytes;

	const rawFilename = (parsedQuery.filename ?? path.basename(parsedQuery.path)).replace(/"/g, '');
	const filename =
		optimized.filenameExtension === 'jpg' ? withJpegExtension(rawFilename) : rawFilename;
	const headers = new Headers();
	headers.set('content-type', optimized.contentType || 'application/octet-stream');
	headers.set('cache-control', 'private, max-age=60');
	headers.set('content-disposition', `inline; filename="${filename}"`);

	const body =
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			: Uint8Array.from(bytes).buffer;
	return new Response(body, { status: 200, headers });
};
