import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	getFirebaseAdminFirestore,
	getFirebaseAdminStorage,
	getFirebaseStorageBucketName,
	loadEnvFromFile,
	loadLocalEnv
} from '@spark/llm';
import {
	SparkAgentAttachmentSchema,
	type SparkAgentAttachment
} from '@spark/schemas';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_CONVERSATION = 10;

const conversationIdSchema = z.string().trim().min(1, 'conversationId is required');
const removeSchema = z.object({
	conversationId: conversationIdSchema,
	fileId: z.string().trim().min(1, 'fileId is required')
});

const chatIdsSchema = z.array(z.string().trim().min(1));

let webEnvLoaded = false;

function loadWebEnv(): void {
	if (webEnvLoaded) {
		return;
	}
	const cwd = process.cwd();
	const envPath = cwd.endsWith(`${path.sep}web`)
		? path.join(cwd, '.env.local')
		: path.join(cwd, 'web', '.env.local');
	loadEnvFromFile(envPath);
	loadLocalEnv();
	webEnvLoaded = true;
}

function isFileLike(value: FormDataEntryValue | null): value is File {
	if (!value) {
		return false;
	}
	if (typeof File !== 'undefined' && value instanceof File) {
		return true;
	}
	return typeof value === 'object' && value !== null && 'arrayBuffer' in value;
}

function detectContentType(buffer: Buffer): string | null {
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return 'image/png';
	}
	if (
		buffer.length >= 12 &&
		buffer[0] === 0x52 &&
		buffer[1] === 0x49 &&
		buffer[2] === 0x46 &&
		buffer[3] === 0x46 &&
		buffer[8] === 0x57 &&
		buffer[9] === 0x45 &&
		buffer[10] === 0x42 &&
		buffer[11] === 0x50
	) {
		return 'image/webp';
	}
	if (
		buffer.length >= 5 &&
		buffer[0] === 0x25 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x44 &&
		buffer[3] === 0x46 &&
		buffer[4] === 0x2d
	) {
		return 'application/pdf';
	}
	return null;
}

function parseChatIds(value: unknown): string[] {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return [];
	}
	try {
		const parsed = JSON.parse(value);
		const result = chatIdsSchema.safeParse(parsed);
		if (result.success) {
			return result.data;
		}
	} catch {
		// ignore
	}
	return [];
}

function parseDownloadTokens(value: unknown): string[] {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return [];
	}
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function buildDownloadUrl(bucket: string, storagePath: string, token: string): string {
	const encoded = encodeURIComponent(storagePath);
	return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?alt=media&token=${token}`;
}

function normalizeAttachments(raw: unknown, fallback: Date): SparkAgentAttachment[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const attachments: SparkAgentAttachment[] = [];
	for (const entry of raw) {
		const result = SparkAgentAttachmentSchema.safeParse(entry);
		if (!result.success) {
			continue;
		}
		attachments.push({
			...result.data,
			createdAt: result.data.createdAt ?? fallback,
			updatedAt: result.data.updatedAt ?? fallback
		});
	}
	return attachments;
}

function upsertAttachment(
	attachments: SparkAgentAttachment[],
	update: SparkAgentAttachment
): SparkAgentAttachment[] {
	let found = false;
	const next = attachments.map((attachment) => {
		if (attachment.id !== update.id) {
			return attachment;
		}
		found = true;
		return {
			...attachment,
			...update,
			createdAt: attachment.createdAt
		};
	});
	if (!found) {
		next.push(update);
	}
	return next;
}

class AttachmentLimitError extends Error {
	status: number;
	code: string;
	constructor(code: string, message: string, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	loadWebEnv();
	const userId = authResult.user.uid;

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (error) {
		console.error('Failed to parse attachment form data', { error, userId });
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const rawConversationId = formData.get('conversationId');
	let conversationId: string;
	try {
		conversationId = conversationIdSchema.parse(rawConversationId);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const fileEntry = formData.get('file');
	if (!isFileLike(fileEntry)) {
		return json({ error: 'missing_file', message: 'No file provided' }, { status: 400 });
	}
	if (typeof fileEntry.size === 'number' && fileEntry.size > MAX_FILE_SIZE_BYTES) {
		return json(
			{ error: 'file_too_large', message: 'File exceeds 25 MB limit' },
			{ status: 413 }
		);
	}

	let buffer: Buffer;
	try {
		buffer = Buffer.from(await fileEntry.arrayBuffer());
	} catch (error) {
		console.error('Failed to read attachment bytes', { error, userId });
		return json({ error: 'invalid_file', message: 'Unable to read file bytes' }, { status: 400 });
	}

	const sizeBytes = buffer.byteLength;
	if (sizeBytes === 0) {
		return json({ error: 'empty_file', message: 'File is empty' }, { status: 400 });
	}
	if (sizeBytes > MAX_FILE_SIZE_BYTES) {
		return json(
			{ error: 'file_too_large', message: 'File exceeds 25 MB limit' },
			{ status: 413 }
		);
	}

	const contentType = detectContentType(buffer);
	if (!contentType) {
		return json(
			{ error: 'unsupported_file', message: 'Only JPG, PNG, WEBP, or PDF files are supported.' },
			{ status: 415 }
		);
	}

	const fileId = createHash('md5').update(buffer).digest('hex');
	const storagePath = `spark/uploads/${userId}/${fileId}`;
	const filename = fileEntry.name ?? 'upload';

	const firestore = getFirebaseAdminFirestore();
	const conversationRef = firestore
		.collection(userId)
		.doc('client')
		.collection('conversations')
		.doc(conversationId);

	let uploadStatus: SparkAgentAttachment | null = null;

	try {
		await firestore.runTransaction(async (tx) => {
			const snapshot = await tx.get(conversationRef);
			const now = new Date();
			const attachments = normalizeAttachments(snapshot.data()?.attachments, now);
			const activeAttachments = attachments.filter((entry) => entry.status !== 'failed');
			const existing = activeAttachments.find((entry) => entry.id === fileId);

			if (!existing) {
				if (activeAttachments.length >= MAX_FILES_PER_CONVERSATION) {
					throw new AttachmentLimitError(
						'too_many_files',
						'You can attach up to 10 files per conversation.'
					);
				}
				const totalSize = activeAttachments.reduce((sum, entry) => sum + entry.sizeBytes, 0);
				if (totalSize + sizeBytes > MAX_TOTAL_SIZE_BYTES) {
					throw new AttachmentLimitError(
						'total_size_exceeded',
						'Attachments are limited to 50 MB per conversation.',
						413
					);
				}
			}

			const nextAttachment: SparkAgentAttachment = {
				id: fileId,
				storagePath,
				contentType,
				filename,
				sizeBytes,
				status: existing?.status ?? 'uploading',
				createdAt: existing?.createdAt ?? now,
				updatedAt: now
			};
			const nextAttachments = upsertAttachment(attachments, nextAttachment);

			const payload: Record<string, unknown> = {
				attachments: nextAttachments,
				updatedAt: now
			};
			if (!snapshot.exists) {
				payload.id = conversationId;
				payload.participantIds = [userId];
				payload.createdAt = now;
				payload.lastMessageAt = now;
				payload.messages = [];
			}

			tx.set(conversationRef, payload, { merge: true });
			uploadStatus = nextAttachment;
		});
	} catch (error) {
		if (error instanceof AttachmentLimitError) {
			return json({ error: error.code, message: error.message }, { status: error.status });
		}
		console.error('Failed to update attachment state', { error, userId, conversationId });
		return json(
			{ error: 'attachment_state_failed', message: 'Unable to prepare upload.' },
			{ status: 500 }
		);
	}

	if (!uploadStatus) {
		return json({ error: 'attachment_state_failed' }, { status: 500 });
	}

	const storage = getFirebaseAdminStorage();
	const bucketName = getFirebaseStorageBucketName();
	const bucket = storage.bucket(bucketName);
	const fileRef = bucket.file(storagePath);

	let downloadUrl: string | null = null;
	let finalAttachment: SparkAgentAttachment | null = null;

	try {
		const [exists] = await fileRef.exists();
		let metadata = exists ? (await fileRef.getMetadata())[0] : null;
		let chatIds = metadata ? parseChatIds(metadata.metadata?.chatIds) : [];
		if (!chatIds.includes(conversationId)) {
			chatIds = [...chatIds, conversationId];
		}
		const tokenCandidates = metadata ? parseDownloadTokens(metadata.metadata?.firebaseStorageDownloadTokens) : [];
		const downloadToken = tokenCandidates[0] ?? randomUUID();
		const metadataUpdate = {
			contentType,
			metadata: {
				...(metadata?.metadata ?? {}),
				chatIds: JSON.stringify(chatIds),
				originalFilename: metadata?.metadata?.originalFilename ?? filename,
				firebaseStorageDownloadTokens: downloadToken
			}
		};
		if (!exists) {
			await fileRef.save(buffer, {
				resumable: false,
				metadata: metadataUpdate
			});
		} else {
			await fileRef.setMetadata(metadataUpdate);
		}

		downloadUrl = buildDownloadUrl(bucketName, storagePath, downloadToken);

		await firestore.runTransaction(async (tx) => {
			const snapshot = await tx.get(conversationRef);
			const now = new Date();
			const attachments = normalizeAttachments(snapshot.data()?.attachments, now);
			const nextAttachment: SparkAgentAttachment = {
				id: fileId,
				storagePath,
				contentType,
				filename,
				downloadUrl: downloadUrl ?? undefined,
				sizeBytes,
				status: 'attaching',
				createdAt: attachments.find((entry) => entry.id === fileId)?.createdAt ?? now,
				updatedAt: now
			};
			const nextAttachments = upsertAttachment(attachments, nextAttachment);
			tx.set(
				conversationRef,
				{
					attachments: nextAttachments,
					updatedAt: now
				},
				{ merge: true }
			);
			finalAttachment = nextAttachment;
		});
	} catch (error) {
		console.error('Failed to upload attachment', { error, userId, conversationId });
		await firestore.runTransaction(async (tx) => {
			const snapshot = await tx.get(conversationRef);
			const now = new Date();
			const attachments = normalizeAttachments(snapshot.data()?.attachments, now);
			const nextAttachment: SparkAgentAttachment = {
				id: fileId,
				storagePath,
				contentType,
				filename,
				sizeBytes,
				status: 'failed',
				error: 'upload_failed',
				createdAt: attachments.find((entry) => entry.id === fileId)?.createdAt ?? now,
				updatedAt: now
			};
			const nextAttachments = upsertAttachment(attachments, nextAttachment);
			tx.set(
				conversationRef,
				{
					attachments: nextAttachments,
					updatedAt: now
				},
				{ merge: true }
			);
		});
		return json(
			{ error: 'upload_failed', message: 'Upload failed. Please try again.' },
			{ status: 500 }
		);
	}

	if (!finalAttachment) {
		return json({ error: 'upload_failed' }, { status: 500 });
	}

	return json({ attachment: finalAttachment });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	loadWebEnv();
	const userId = authResult.user.uid;

	let parsed: z.infer<typeof removeSchema>;
	try {
		parsed = removeSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const { conversationId, fileId } = parsed;
	const firestore = getFirebaseAdminFirestore();
	const conversationRef = firestore
		.collection(userId)
		.doc('client')
		.collection('conversations')
		.doc(conversationId);

	let updated: SparkAgentAttachment | null = null;

	await firestore.runTransaction(async (tx) => {
		const snapshot = await tx.get(conversationRef);
		const now = new Date();
		const attachments = normalizeAttachments(snapshot.data()?.attachments, now);
		const existing = attachments.find((entry) => entry.id === fileId);
		if (!existing) {
			return;
		}
		const nextAttachment: SparkAgentAttachment = {
			...existing,
			status: 'failed',
			error: 'removed',
			updatedAt: now
		};
		const nextAttachments = upsertAttachment(attachments, nextAttachment);
		tx.set(
			conversationRef,
			{
				attachments: nextAttachments,
				updatedAt: now
			},
			{ merge: true }
		);
		updated = nextAttachment;
	});

	return json({ attachment: updated });
};
