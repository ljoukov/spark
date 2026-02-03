import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { createSseStream, sseResponse } from '$lib/server/utils/sse';
import { generateText, loadEnvFromFile, loadLocalEnv } from '@spark/llm';
import type { LlmContent, LlmContentPart, LlmTextDelta } from '@spark/llm';
import {
	SparkAgentAttachmentSchema,
	type SparkAgentAttachment,
	type SparkAgentContentPart,
	type SparkAgentMessage
} from '@spark/schemas';
import { dev } from '$app/environment';
import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { getFirestoreDocument, setFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';

const MIN_UPDATE_INTERVAL_MS = 500;
const MAX_HISTORY_MESSAGES = 20;
const MODEL_ID = 'gemini-flash-latest' as const;
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/pdf'
]);
const FALLBACK_RESPONSE = [
	'Here is a quick 3-day GCSE Biology sprint you can follow:',
	'',
	'Day 1: Cells and transport',
	'- Review cell structure and specialised cells.',
	'- Practice diffusion, osmosis, and active transport questions.',
	'',
	'Day 2: Organisation and infection response',
	'- Recap organ systems and the immune response.',
	'- Do a 20-minute mixed quiz on pathogens + immunity.',
	'',
	'Day 3: Bioenergetics and ecology',
	'- Summarise photosynthesis and respiration steps.',
	'- Finish with exam-style questions and mark schemes.',
	'',
	'Want me to tailor this to your exam board and weak topics?'
].join('\n');

const attachmentSchema = z.object({
	id: z.string().trim().min(1, 'id is required'),
	storagePath: z.string().trim().min(1, 'storagePath is required'),
	contentType: z.string().trim().min(1, 'contentType is required'),
	filename: z.string().trim().min(1).optional(),
	downloadUrl: z.string().trim().min(1).optional(),
	sizeBytes: z.number().int().min(1, 'sizeBytes must be positive'),
	pageCount: z.number().int().min(1).optional()
});

const requestSchema = z
	.object({
		conversationId: z.string().trim().min(1).optional(),
		text: z.string().trim().optional(),
		attachments: z.array(attachmentSchema).optional(),
		targetUserId: z.string().trim().min(1).optional()
	})
	.superRefine((value, ctx) => {
		const hasText = Boolean(value.text && value.text.trim().length > 0);
		const hasAttachments = Boolean(value.attachments && value.attachments.length > 0);
		if (!hasText && !hasAttachments) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'text or attachments are required'
			});
		}
	});

type ConversationDoc = {
	id: string;
	familyId?: string;
	participantIds: string[];
	createdAt: Date;
	updatedAt: Date;
	lastMessageAt: Date;
	messages: SparkAgentMessage[];
	attachments?: SparkAgentAttachment[];
};

type ConversationInit = {
	conversation: ConversationDoc;
	isNew: boolean;
};

const SYSTEM_PROMPT = [
	'You are Spark AI Agent, an always-on study companion for Spark learners.',
	'Write in UK English.',
	'Be direct, warm, and practical. Offer concrete next steps and ask clarifying questions when needed.',
	'Use short headings and bullets to keep responses skimmable.'
].join('\n');

const ROLE_TO_LLM: Record<SparkAgentMessage['role'], LlmContent['role']> = {
	user: 'user',
	assistant: 'model',
	system: 'system',
	tool: 'tool'
};

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
	webEnvLoaded = true;
}

function resolveConversationId(value: string | undefined): string {
	if (value && value.trim().length > 0) {
		return value.trim();
	}
	return randomUUID();
}

function resolveConversationDoc(
	raw: Record<string, unknown> | undefined,
	userId: string,
	conversationId: string,
	now: Date
): ConversationInit {
	const messages = Array.isArray(raw?.messages)
		? raw.messages
				.map((entry) => normalizeMessage(entry, now))
				.filter((entry): entry is SparkAgentMessage => entry !== null)
		: [];
	const participantIds = Array.isArray(raw?.participantIds)
		? raw.participantIds.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
		: [];
	const createdAt = resolveTimestamp(raw?.createdAt, now);
	const conversation: ConversationDoc = {
		id: conversationId,
		familyId: typeof raw?.familyId === 'string' ? raw.familyId : undefined,
		participantIds: participantIds.length > 0 ? participantIds : [userId],
		createdAt,
		updatedAt: now,
		lastMessageAt: now,
		messages
	};

	const isNew = !raw;
	return { conversation, isNew };
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

function toConversationPayload(conversation: ConversationDoc): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		id: conversation.id,
		participantIds: conversation.participantIds,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		lastMessageAt: conversation.lastMessageAt,
		messages: conversation.messages
	};
	if (conversation.attachments) {
		payload.attachments = conversation.attachments;
	}
	if (conversation.familyId) {
		payload.familyId = conversation.familyId;
	}
	return payload;
}

function resolveContentParts(
	text: string | null,
	attachments: z.infer<typeof attachmentSchema>[]
): SparkAgentContentPart[] {
	const parts: SparkAgentContentPart[] = [];
	for (const attachment of attachments) {
		const isImage = attachment.contentType.startsWith('image/');
		const filePart: {
			id?: string;
			storagePath: string;
			contentType: string;
			sizeBytes: number;
			filename?: string;
			downloadUrl?: string;
			pageCount?: number;
		} = {
			id: attachment.id,
			storagePath: attachment.storagePath,
			contentType: attachment.contentType,
			sizeBytes: attachment.sizeBytes
		};
		if (attachment.filename) {
			filePart.filename = attachment.filename;
		}
		if (attachment.downloadUrl) {
			filePart.downloadUrl = attachment.downloadUrl;
		}
		if (typeof attachment.pageCount === 'number' && attachment.pageCount > 0) {
			filePart.pageCount = attachment.pageCount;
		}
		if (isImage) {
			parts.push({ type: 'image', file: filePart });
		} else {
			parts.push({ type: 'file', file: filePart });
		}
	}
	if (text && text.trim().length > 0) {
		parts.push({ type: 'text', text });
	}
	return parts;
}

function appendMessage(conversation: ConversationDoc, message: SparkAgentMessage): void {
	conversation.messages = [...conversation.messages, message];
}

function resolveTimestamp(value: unknown, fallback: Date): Date {
	if (value instanceof Date) {
		return value;
	}
	if (value && typeof value === 'object') {
		const candidate = value as { toDate?: () => Date; seconds?: unknown; nanoseconds?: unknown };
		if (typeof candidate.toDate === 'function') {
			const resolved = candidate.toDate();
			if (resolved instanceof Date && !Number.isNaN(resolved.getTime())) {
				return resolved;
			}
		}
		const seconds = typeof candidate.seconds === 'number' ? candidate.seconds : NaN;
		const nanoseconds = typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : NaN;
		if (!Number.isNaN(seconds) && !Number.isNaN(nanoseconds)) {
			return new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
		}
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date;
		}
	}
	return fallback;
}

function normalizeMessage(raw: unknown, fallback: Date): SparkAgentMessage | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const message = raw as SparkAgentMessage;
	return {
		...message,
		createdAt: resolveTimestamp((message as { createdAt?: unknown }).createdAt, fallback)
	};
}

function updateAssistantMessage(
	conversation: ConversationDoc,
	messageId: string,
	text: string
): void {
	for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
		const message = conversation.messages[i];
		if (message && message.id === messageId) {
			conversation.messages[i] = {
				...message,
				content: [{ type: 'text', text }]
			};
			return;
		}
	}
}

function extractTextParts(parts: SparkAgentContentPart[]): string {
	const chunks: string[] = [];
	for (const part of parts) {
		switch (part.type) {
			case 'text':
				chunks.push(part.text);
				break;
			case 'image':
				break;
			case 'file':
				break;
			case 'tool_call':
				break;
			case 'tool_result':
				break;
		}
	}
	return chunks.join('\n').trim();
}

function isSupportedAttachmentMime(value: string): boolean {
	return SUPPORTED_ATTACHMENT_MIME_TYPES.has(value);
}

async function downloadAttachmentParts(
	options: { userId: string; bucketName: string },
	attachments: z.infer<typeof attachmentSchema>[]
): Promise<LlmContentPart[]> {
	if (attachments.length === 0) {
		return [];
	}
	const expectedBucket = options.bucketName;
	const downloadTasks = attachments.map(async (attachment) => {
		if (!isSupportedAttachmentMime(attachment.contentType)) {
			throw new Error(`Unsupported attachment type ${attachment.contentType}`);
		}
		if (!attachment.downloadUrl || attachment.downloadUrl.trim().length === 0) {
			throw new Error(`Attachment ${attachment.id} is missing a downloadUrl`);
		}
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(attachment.downloadUrl);
		} catch {
			throw new Error(`Attachment ${attachment.id} has an invalid downloadUrl`);
		}
		if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'firebasestorage.googleapis.com') {
			throw new Error(`Attachment ${attachment.id} downloadUrl is not a Firebase Storage URL`);
		}
		const expectedPath = `/v0/b/${expectedBucket}/o/${encodeURIComponent(attachment.storagePath)}`;
		if (parsedUrl.pathname !== expectedPath) {
			throw new Error(`Attachment ${attachment.id} downloadUrl does not match storagePath`);
		}
		if (parsedUrl.searchParams.get('alt') !== 'media') {
			throw new Error(`Attachment ${attachment.id} downloadUrl must use alt=media`);
		}

		// Cloudflare Workers does not reliably support Firebase Admin Storage (Node + gRPC/protobuf).
		// Fetch the Firebase Storage download URL provided by the client instead.
		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => {
			controller.abort();
		}, ATTACHMENT_DOWNLOAD_TIMEOUT_MS);

		let resp: Response;
		try {
			resp = await fetch(attachment.downloadUrl, { signal: controller.signal });
		} finally {
			clearTimeout(timeoutHandle);
		}

		if (!resp.ok) {
			throw new Error(`Attachment ${attachment.id} download failed: ${resp.status}`);
		}

		const arrayBuffer = await resp.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		if (buffer.length === 0) {
			throw new Error(`Attachment ${attachment.id} is empty`);
		}
		if (buffer.length > MAX_ATTACHMENT_BYTES) {
			throw new Error(`Attachment ${attachment.id} exceeds 25 MB limit`);
		}
		return {
			data: buffer,
			mimeType: attachment.contentType
		};
	});
	const buffers = await Promise.all(downloadTasks);
	return buffers.map((entry) => ({
		type: 'inlineData',
		data: entry.data.toString('base64'),
		mimeType: entry.mimeType
	}));
}

function buildLlmContents(
	messages: SparkAgentMessage[],
	options?: { attachmentMessageId?: string; attachmentParts?: LlmContentPart[] }
): LlmContent[] {
	const contents: LlmContent[] = [{ role: 'user', parts: [{ type: 'text', text: SYSTEM_PROMPT }] }];
	const start = Math.max(0, messages.length - MAX_HISTORY_MESSAGES);
	for (let i = start; i < messages.length; i += 1) {
		const message = messages[i];
		if (!message) {
			continue;
		}
		const text = extractTextParts(message.content);
		const hasAttachmentParts =
			message.role === 'user' &&
			options?.attachmentMessageId === message.id &&
			options.attachmentParts &&
			options.attachmentParts.length > 0;
		if (!text && !hasAttachmentParts) {
			continue;
		}
		const parts: LlmContentPart[] = [];
		if (hasAttachmentParts && options?.attachmentParts) {
			parts.push(...options.attachmentParts);
		}
		if (text) {
			parts.push({ type: 'text', text });
		}
		contents.push({
			role: ROLE_TO_LLM[message.role],
			parts
		});
	}
	return contents;
}

type StreamHandlers = {
	onDelta?: (delta: LlmTextDelta) => void;
};

async function generateAssistantResponse(
	conversation: ConversationDoc,
	options: {
		userId: string;
		bucketName: string;
		messageId: string;
		attachments: z.infer<typeof attachmentSchema>[];
	},
	handlers: StreamHandlers
): Promise<string> {
	const attachmentParts = await downloadAttachmentParts(
		{ userId: options.userId, bucketName: options.bucketName },
		options.attachments
	);
	const contents = buildLlmContents(conversation.messages, {
		attachmentMessageId: options.messageId,
		attachmentParts
	});
	return await generateText({
		modelId: MODEL_ID,
		contents,
		onDelta: handlers.onDelta
	});
}

function hasGeminiCredentials(): boolean {
	loadWebEnv();
	loadLocalEnv();
	return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

async function streamFallbackText(
	text: string,
	onDelta: (delta: LlmTextDelta) => void
): Promise<void> {
	const chunks = text.split(/(\s+)/u);
	for (const chunk of chunks) {
		if (!chunk) {
			continue;
		}
		onDelta({ textDelta: chunk });
		await new Promise((resolve) => setTimeout(resolve, 80));
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;
	loadWebEnv();
	loadLocalEnv();
	const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
	if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
		return json(
			{
				error: 'misconfigured',
				message: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing on the server.'
			},
			{ status: 500 }
		);
	}
	const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
	const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;

	let parsedBody: z.infer<typeof requestSchema>;
	try {
		parsedBody = requestSchema.parse(await request.json());
	} catch (error) {
		console.error('Failed to parse Spark AI Agent request body', { error, userId });
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_body', message: 'Unable to parse request body as JSON' },
			{ status: 400 }
		);
	}

	const conversationId = resolveConversationId(parsedBody.conversationId);
	const now = new Date();
	const conversationDocPath = `${userId}/client/conversations/${conversationId}`;
	let conversation: ConversationDoc = resolveConversationDoc(undefined, userId, conversationId, now)
		.conversation;
	let conversationAttachments: SparkAgentAttachment[] = [];

	try {
		const snapshot = await getFirestoreDocument({
			serviceAccountJson,
			documentPath: conversationDocPath
		});
		conversationAttachments = normalizeAttachments(snapshot.data?.attachments, now);
		conversation = resolveConversationDoc(
			snapshot.exists ? snapshot.data ?? undefined : undefined,
			userId,
			conversationId,
			now
		).conversation;
	} catch (error) {
		console.error('Spark AI Agent Firestore unavailable', {
			error: error instanceof Error ? error.message : String(error),
			userId,
			conversationId
		});
		return json(
			{
				error: 'conversation_store_unavailable',
				message: 'Conversation persistence is unavailable right now. Please try again in a moment.'
			},
			{ status: 503 }
		);
	}

	const messageId = randomUUID();
	const assistantMessageId = randomUUID();
	const attachments = parsedBody.attachments ?? [];
	const trimmedText = parsedBody.text?.trim() ?? '';
	const attachmentById = new Map(conversationAttachments.map((entry) => [entry.id, entry]));
	const attachmentForMessage: z.infer<typeof attachmentSchema>[] = [];
	for (const attachment of attachments) {
		const existing = attachmentById.get(attachment.id);
		if (existing) {
			if (existing.status === 'failed' || existing.status === 'uploading') {
				continue;
			}
			attachmentForMessage.push({
				id: existing.id,
				storagePath: existing.storagePath,
				contentType: existing.contentType,
				filename: existing.filename,
				downloadUrl: existing.downloadUrl,
				sizeBytes: existing.sizeBytes,
				pageCount: existing.pageCount
			});
			continue;
		}

		if (attachment.downloadUrl && attachment.downloadUrl.trim().length > 0) {
			attachmentForMessage.push(attachment);
		}
	}
	if (!trimmedText && attachmentForMessage.length === 0) {
		return json(
			{ error: 'invalid_body', message: 'text or attachments are required' },
			{ status: 400 }
		);
	}
	const userMessage: SparkAgentMessage = {
		id: messageId,
		role: 'user',
		author: { userId },
		createdAt: now,
		content: resolveContentParts(trimmedText, attachmentForMessage)
	};
	const assistantMessage: SparkAgentMessage = {
		id: assistantMessageId,
		role: 'assistant',
		createdAt: now,
		content: [{ type: 'text', text: '' }]
	};

	appendMessage(conversation, userMessage);
	appendMessage(conversation, assistantMessage);

	if (attachmentForMessage.length > 0) {
		const ids = new Set(attachmentForMessage.map((entry) => entry.id));
		conversationAttachments = conversationAttachments.map((entry) => {
			if (!ids.has(entry.id)) {
				return entry;
			}
			return {
				...entry,
				status: 'attached',
				messageId,
				updatedAt: now
			};
		});
	}

	try {
		await setFirestoreDocument({
			serviceAccountJson,
			documentPath: conversationDocPath,
			data: toConversationPayload({
				...conversation,
				updatedAt: now,
				lastMessageAt: now,
				messages: conversation.messages,
				attachments: conversationAttachments
			})
		});
	} catch (error) {
		console.error('Spark AI Agent conversation write failed', {
			error: error instanceof Error ? error.message : String(error),
			userId,
			conversationId
		});
		return json(
			{
				error: 'conversation_write_failed',
				message: 'Unable to persist your message. Please try again.'
			},
			{ status: 500 }
		);
	}

	const acceptsSse = request.headers.get('accept')?.includes('text/event-stream') ?? false;
	const canUseGemini = hasGeminiCredentials();
	const allowFallback = dev;

	const runAgentResponse = async (
		sendEvent?: (event: { event: string; data: string }) => void,
		closeStream?: () => void
	): Promise<void> => {
		let assistantText = '';
		let lastUpdate = 0;
		let pendingFlush: NodeJS.Timeout | null = null;
		let flushInFlight = false;

		const flushUpdate = async (force: boolean): Promise<void> => {
			const nowTimestampValue = new Date();
			const elapsed = Date.now() - lastUpdate;
			if (!force && elapsed < MIN_UPDATE_INTERVAL_MS) {
				if (!pendingFlush) {
					pendingFlush = setTimeout(() => {
						pendingFlush = null;
						void flushUpdate(true);
					}, MIN_UPDATE_INTERVAL_MS - elapsed);
				}
				return;
			}
			if (flushInFlight) {
				return;
			}
			flushInFlight = true;
			try {
				updateAssistantMessage(conversation, assistantMessageId, assistantText);
				conversation.updatedAt = nowTimestampValue;
				conversation.lastMessageAt = nowTimestampValue;
				await setFirestoreDocument({
					serviceAccountJson,
					documentPath: conversationDocPath,
					data: {
						updatedAt: nowTimestampValue,
						lastMessageAt: nowTimestampValue,
						messages: conversation.messages
					}
				});
				lastUpdate = Date.now();
			} finally {
				flushInFlight = false;
			}
		};

		const handleDelta = (delta: LlmTextDelta): void => {
			if (delta.thoughtDelta) {
				sendEvent?.({ event: 'thought', data: delta.thoughtDelta });
			}
			if (delta.textDelta) {
				assistantText += delta.textDelta;
				sendEvent?.({ event: 'text', data: delta.textDelta });
				void flushUpdate(false);
			}
		};

		try {
			if (!canUseGemini) {
				if (!allowFallback) {
					throw new Error('Gemini credentials are not configured');
				}
				await streamFallbackText(FALLBACK_RESPONSE, handleDelta);
				assistantText = FALLBACK_RESPONSE;
			} else {
				await generateAssistantResponse(
					conversation,
					{
						userId,
						bucketName,
						messageId,
						attachments: attachmentForMessage
					},
					{ onDelta: handleDelta }
				);
			}
			await flushUpdate(true);
			sendEvent?.({
				event: 'done',
				data: JSON.stringify({
					conversationId,
					messageId: assistantMessageId
				})
			});
		} catch (error) {
			console.error('Failed to generate Spark AI Agent response', { error, userId });
			const fallback = 'Sorry — Spark AI Agent could not respond just now. Please try again.';
			assistantText = fallback;
			await flushUpdate(true);
			sendEvent?.({
				event: 'error',
				data: JSON.stringify({
					error: 'generation_failed',
					message: fallback,
					conversationId,
					messageId: assistantMessageId
				})
			});
		} finally {
			if (pendingFlush) {
				clearTimeout(pendingFlush);
			}
			closeStream?.();
		}
	};

	if (!acceptsSse) {
		void runAgentResponse();
		return json({ conversationId, messageId }, { status: 202 });
	}

	const { stream, send, close } = createSseStream({ signal: request.signal });
	const response = sseResponse(stream);

	send({
		event: 'meta',
		data: JSON.stringify({
			conversationId,
			messageId,
			assistantMessageId
		})
	});

	void runAgentResponse((event) => send(event), close);

	return response;
};
