import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { createSseStream, sseResponse } from '$lib/server/utils/sse';
import {
	createTask,
	HANDWRITING_TRANSCRIPTION_SKILL_TEXT,
	resolveWorkspacePathContentType,
	upsertWorkspaceStorageLinkFileDoc,
	upsertWorkspaceTextFileDoc
} from '@spark/llm';
import { runAgentLoop, tool } from '@ljoukov/llm';
import type {
	LlmContentPart,
	LlmInputMessage,
	LlmToolSet
} from '@ljoukov/llm';
import {
	SparkAgentAttachmentSchema,
	type SparkAgentAttachment,
	type SparkAgentContentPart,
	type SparkAgentMessage
} from '@spark/schemas';
import {
	DEFAULT_GRADER_OLYMPIAD_KEY,
	DEFAULT_GRADER_OLYMPIAD_LABEL,
	GRADER_PROBLEMS_DIR,
	GRADER_SUMMARY_PATH,
	createGraderRun,
	patchGraderRun
} from '$lib/server/grader/repo';
import { dev } from '$app/environment';
import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
	getFirestoreDocument,
	patchFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import { encodeBytesToBase64 } from '$lib/server/gcp/base64';
import { env } from '$env/dynamic/private';
import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import {
	listSessions,
	getSession,
	saveSession,
	setCurrentSessionId
} from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import sparkChatSystemPrompt from '$lib/server/agent/spark-chat-system-prompt.md?raw';
import lessonTaskTemplate from '$lib/server/lessonAgent/task-template.md?raw';
import lessonSchemaReadme from '$lib/server/lessonAgent/schema/README.md?raw';
import lessonSessionSchemaJson from '$lib/server/lessonAgent/schema/session.schema.json?raw';
import lessonQuizSchemaJson from '$lib/server/lessonAgent/schema/quiz.schema.json?raw';
import lessonCodingProblemSchemaJson from '$lib/server/lessonAgent/schema/coding_problem.schema.json?raw';
import lessonMediaSchemaJson from '$lib/server/lessonAgent/schema/media.schema.json?raw';
import lessonPromptSessionDraft from '$lib/server/lessonAgent/prompts/session-draft.md?raw';
import lessonPromptSessionGrade from '$lib/server/lessonAgent/prompts/session-grade.md?raw';
import lessonPromptSessionRevise from '$lib/server/lessonAgent/prompts/session-revise.md?raw';
import lessonPromptQuizDraft from '$lib/server/lessonAgent/prompts/quiz-draft.md?raw';
import lessonPromptQuizGrade from '$lib/server/lessonAgent/prompts/quiz-grade.md?raw';
import lessonPromptQuizRevise from '$lib/server/lessonAgent/prompts/quiz-revise.md?raw';
import lessonPromptCodeDraft from '$lib/server/lessonAgent/prompts/code-draft.md?raw';
import lessonPromptCodeGrade from '$lib/server/lessonAgent/prompts/code-grade.md?raw';
import lessonPromptCodeRevise from '$lib/server/lessonAgent/prompts/code-revise.md?raw';
import graderTaskTemplate from '$lib/server/graderAgent/task-template.md?raw';

const MIN_UPDATE_INTERVAL_MS = 500;
const MAX_HISTORY_MESSAGES = 20;
const MODEL_ID = 'chatgpt-gpt-5.3-codex' as const;
const OPENAI_REASONING_EFFORT = 'medium' as const;
const SPARK_AGENT_MAX_TOOL_STEPS = 256;
const GENERATION_MAX_ATTEMPTS = 3;
const GENERATION_RETRY_BASE_DELAY_MS = 800;
const GENERATION_RETRY_MAX_DELAY_MS = 4_000;
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/heic',
	'image/heif',
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
const GRADER_ATTACHMENT_LIMIT = 24;
const GRADER_UPLOADS_MANIFEST_PATH = 'grader/uploads/index.json';

const attachmentSchema = z.object({
	id: z.string().trim().min(1, 'id is required'),
	storagePath: z.string().trim().min(1, 'storagePath is required'),
	contentType: z.string().trim().min(1, 'contentType is required'),
	filename: z.string().trim().min(1).optional(),
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
				code: 'custom',
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

const SYSTEM_PROMPT = sparkChatSystemPrompt.trim();
const MAX_ERROR_LOG_DEPTH = 100;

type SparkChatDelta = {
	thoughtDelta?: string;
	textDelta?: string;
};

const ROLE_TO_LLM: Record<Exclude<SparkAgentMessage['role'], 'tool'>, LlmInputMessage['role']> = {
	user: 'user',
	assistant: 'assistant',
	system: 'system'
};

function serializeErrorContext(value: unknown, depth: number, seen: WeakSet<object>): unknown {
	if (depth <= 0) {
		return '[Max depth reached]';
	}
	if (value instanceof Error) {
		return serializeErrorForLog(value, depth - 1, seen);
	}
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (typeof value !== 'object' || value === null) {
		return value;
	}
	if (seen.has(value)) {
		return '[Circular]';
	}
	seen.add(value);
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		for (const item of value) {
			result.push(serializeErrorContext(item, depth - 1, seen));
		}
		return result;
	}
	const result: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		result[key] = serializeErrorContext(nestedValue, depth - 1, seen);
	}
	return result;
}

function serializeErrorForLog(
	error: unknown,
	depth = MAX_ERROR_LOG_DEPTH,
	seen = new WeakSet<object>()
): Record<string, unknown> {
	if (error instanceof Error) {
		if (seen.has(error)) {
			return {
				type: error.constructor?.name ?? 'Error',
				message: '[Circular error reference]'
			};
		}
		seen.add(error);
		const result: Record<string, unknown> = {
			type: error.constructor?.name ?? 'Error',
			name: error.name,
			message: error.message
		};
		if (error.stack) {
			result.stack = error.stack;
		}
		const cause = (error as Error & { cause?: unknown }).cause;
		if (cause !== undefined) {
			result.cause = serializeErrorContext(cause, depth - 1, seen);
		}
		for (const [key, value] of Object.entries(error)) {
			if (!(key in result)) {
				result[key] = serializeErrorContext(value, depth - 1, seen);
			}
		}
		return result;
	}
	if (error === null) {
		return { type: 'null', value: null };
	}
	if (error === undefined) {
		return { type: 'undefined', value: 'undefined' };
	}
	return {
		type: typeof error,
		value: serializeErrorContext(error, depth - 1, seen)
	};
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
	const attachments = normalizeAttachments(raw?.attachments, now);
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
		messages,
		attachments
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

function toAttachmentInput(entry: SparkAgentAttachment): z.infer<typeof attachmentSchema> | null {
	if (entry.status === 'failed' || entry.status === 'uploading') {
		return null;
	}
	return {
		id: entry.id,
		storagePath: entry.storagePath,
		contentType: entry.contentType,
		filename: entry.filename,
		sizeBytes: entry.sizeBytes,
		pageCount: entry.pageCount
	};
}

function toAttachmentFromMessagePart(
	part: SparkAgentContentPart
): z.infer<typeof attachmentSchema> | null {
	if (part.type !== 'image' && part.type !== 'file') {
		return null;
	}
	const fallbackId = `${part.file.storagePath}#${part.file.contentType}`;
	const attachmentId =
		typeof part.file.id === 'string' && part.file.id.trim().length > 0 ? part.file.id : fallbackId;
	return {
		id: attachmentId,
		storagePath: part.file.storagePath,
		contentType: part.file.contentType,
		filename: part.file.filename,
		sizeBytes: part.file.sizeBytes,
		pageCount: part.file.pageCount
	};
}

function resolveAttachmentsForToolCall(options: {
	conversation: ConversationDoc;
	currentMessageId: string;
	currentMessageAttachments: z.infer<typeof attachmentSchema>[];
	limit: number;
}): z.infer<typeof attachmentSchema>[] {
	const knownAttachments = (options.conversation.attachments ?? [])
		.map((entry) => toAttachmentInput(entry))
		.filter((entry): entry is z.infer<typeof attachmentSchema> => entry !== null);
	const attachmentById = new Map<string, z.infer<typeof attachmentSchema>>();
	for (const entry of knownAttachments) {
		attachmentById.set(entry.id, entry);
	}
	for (const entry of options.currentMessageAttachments) {
		attachmentById.set(entry.id, entry);
	}
	const selected: z.infer<typeof attachmentSchema>[] = [];
	const seen = new Set<string>();
	const pushAttachment = (entry: z.infer<typeof attachmentSchema>): void => {
		if (seen.has(entry.id)) {
			return;
		}
		seen.add(entry.id);
		selected.push(entry);
	};
	for (const entry of options.currentMessageAttachments) {
		pushAttachment(entry);
	}
	for (let index = options.conversation.messages.length - 1; index >= 0; index -= 1) {
		if (selected.length >= options.limit) {
			break;
		}
		const message = options.conversation.messages[index];
		if (!message || message.role !== 'user') {
			continue;
		}
		const isCurrentMessage = message.id === options.currentMessageId;
		if (!isCurrentMessage && selected.length >= options.limit) {
			continue;
		}
		for (const part of message.content) {
			if (selected.length >= options.limit) {
				break;
			}
			const fromPart = toAttachmentFromMessagePart(part);
			if (!fromPart) {
				continue;
			}
			const normalized = attachmentById.get(fromPart.id) ?? fromPart;
			attachmentById.set(normalized.id, normalized);
			pushAttachment(normalized);
		}
	}
	for (const entry of knownAttachments) {
		if (selected.length >= options.limit) {
			break;
		}
		pushAttachment(entry);
	}
	return selected.slice(0, options.limit);
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
	options: { userId: string; bucketName: string; serviceAccountJson: string },
	attachments: z.infer<typeof attachmentSchema>[]
): Promise<LlmContentPart[]> {
	if (attachments.length === 0) {
		return [];
	}
	const downloadTasks = attachments.map(async (attachment) => {
		if (!isSupportedAttachmentMime(attachment.contentType)) {
			throw new Error(`Unsupported attachment type ${attachment.contentType}`);
		}

		const expectedPrefix = `spark/uploads/${options.userId}/`;
		if (!attachment.storagePath.startsWith(expectedPrefix)) {
			throw new Error(`Attachment ${attachment.id} storagePath is invalid`);
		}

		const result = await downloadStorageObject({
			serviceAccountJson: options.serviceAccountJson,
			bucketName: options.bucketName,
			objectName: attachment.storagePath,
			timeoutMs: ATTACHMENT_DOWNLOAD_TIMEOUT_MS
		});
		const bytes = result.bytes;
		if (bytes.length === 0) {
			throw new Error(`Attachment ${attachment.id} is empty`);
		}
		if (bytes.length > MAX_ATTACHMENT_BYTES) {
			throw new Error(`Attachment ${attachment.id} exceeds 25 MB limit`);
		}
		return {
			data: bytes,
			mimeType: attachment.contentType
		};
	});
	const buffers = await Promise.all(downloadTasks);
	return buffers.map((entry) => ({
		type: 'inlineData',
		data: encodeBytesToBase64(entry.data),
		mimeType: entry.mimeType
	}));
}

function buildLlmInputMessages(
	messages: SparkAgentMessage[],
	options?: { attachmentMessageId?: string; attachmentParts?: LlmContentPart[] }
): LlmInputMessage[] {
	const input: LlmInputMessage[] = [];
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
		if (message.role === 'tool' || (!text && !hasAttachmentParts)) {
			continue;
		}
		const parts: LlmContentPart[] = [];
		if (hasAttachmentParts && options?.attachmentParts) {
			parts.push(...options.attachmentParts);
		}
		if (text) {
			parts.push({ type: 'text', text });
		}
		input.push({
			role: ROLE_TO_LLM[message.role],
			content: parts
		});
	}
	return input;
}

type StreamHandlers = {
	onDelta?: (delta: SparkChatDelta) => void;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function resolveErrorStatusCode(error: unknown, depth = 0): number | null {
	if (depth > 3) {
		return null;
	}
	if (!error || typeof error !== 'object') {
		return null;
	}
	const asRecord = error as {
		status?: unknown;
		code?: unknown;
		response?: { status?: unknown };
		cause?: unknown;
	};
	if (typeof asRecord.status === 'number' && Number.isFinite(asRecord.status)) {
		return asRecord.status;
	}
	if (
		asRecord.response &&
		typeof asRecord.response.status === 'number' &&
		Number.isFinite(asRecord.response.status)
	) {
		return asRecord.response.status;
	}
	if (typeof asRecord.code === 'number' && Number.isFinite(asRecord.code)) {
		return asRecord.code;
	}
	if (typeof asRecord.code === 'string') {
		const parsed = Number.parseInt(asRecord.code, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	if (asRecord.cause !== undefined) {
		return resolveErrorStatusCode(asRecord.cause, depth + 1);
	}
	return null;
}

function isRetryableGenerationError(error: unknown): boolean {
	const statusCode = resolveErrorStatusCode(error);
	if (statusCode === 408 || statusCode === 425 || statusCode === 429) {
		return true;
	}
	if (typeof statusCode === 'number' && statusCode >= 500) {
		return true;
	}
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (
			message.includes('resource exhausted') ||
			message.includes('rate limit') ||
			message.includes('too many requests') ||
			message.includes('temporarily unavailable')
		) {
			return true;
		}
	}
	return false;
}

function resolveGenerationRetryDelayMs(attempt: number): number {
	const exponential = GENERATION_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
	const capped = Math.min(exponential, GENERATION_RETRY_MAX_DELAY_MS);
	const jitter = Math.floor(Math.random() * 250);
	return capped + jitter;
}

function requireTasksEnv(): { serviceUrl: string; apiKey: string } {
	const serviceUrl = env.TASKS_SERVICE_URL;
	if (!serviceUrl || serviceUrl.trim().length === 0) {
		throw new Error('TASKS_SERVICE_URL is missing');
	}
	const apiKey = env.TASKS_API_KEY;
	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('TASKS_API_KEY is missing');
	}
	return { serviceUrl, apiKey };
}

function sanitizeWorkspaceAttachmentFilename(value: string): string {
	return value.trim().replace(/[/\\]+/g, '-');
}

function resolveWorkspaceAttachmentPath(attachment: {
	id: string;
	filename?: string;
}): string {
	const raw = sanitizeWorkspaceAttachmentFilename(attachment.filename ?? attachment.id);
	const filename = raw.length > 0 ? raw : attachment.id;
	return `grader/uploads/${filename}`;
}

async function writeWorkspaceTextFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	path: string;
	content: string;
	now: Date;
}): Promise<void> {
	await upsertWorkspaceTextFileDoc({
		serviceAccountJson: options.serviceAccountJson,
		userId: options.userId,
		workspaceId: options.workspaceId,
		filePath: options.path,
		content: options.content,
		contentType: resolveWorkspacePathContentType(options.path),
		createdAt: options.now,
		updatedAt: options.now
	});
}

async function writeWorkspaceStorageLinkFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	path: string;
	storagePath: string;
	contentType: string;
	sizeBytes: number;
	now: Date;
}): Promise<void> {
	await upsertWorkspaceStorageLinkFileDoc({
		serviceAccountJson: options.serviceAccountJson,
		userId: options.userId,
		workspaceId: options.workspaceId,
		filePath: options.path,
		storagePath: options.storagePath,
		contentType: options.contentType,
		sizeBytes: options.sizeBytes,
		createdAt: options.now,
		updatedAt: options.now
	});
}

function normalizeOlympiadKey(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '_')
		.replace(/^_+|_+$/gu, '');
	if (normalized.length > 0) {
		return normalized.slice(0, 64);
	}
	return DEFAULT_GRADER_OLYMPIAD_KEY;
}

const graderCreateSchema = z
	.object({
		olympiad: nullableOptionalString().describe(
			'Optional olympiad name override for this learner (for example: Hamilton Olympiad by UKMT).'
		),
		referenceSourcePolicy: z
			.enum(['uploaded-only', 'allow-online-search-when-problems-missing'])
			.optional()
			.describe(
				[
					'Controls whether the grader may search online for missing problem statements/official references.',
					'- uploaded-only: use uploaded/pasted materials only; do not search online.',
					'- allow-online-search-when-problems-missing: online search is allowed only when problem statements are missing/unclear.'
				].join('\n')
			),
		notes: nullableOptionalString().describe(
			'Optional grading focus for this run (for example: focus on proof rigor and notation).'
		)
	})
	.strict();

function buildGraderBrief(options: {
	sourceText?: string;
	input: z.infer<typeof graderCreateSchema>;
	attachments: z.infer<typeof attachmentSchema>[];
}): string {
	const referenceSourcePolicy = options.input.referenceSourcePolicy ?? 'uploaded-only';
	const referenceSourcePolicyText =
		referenceSourcePolicy === 'allow-online-search-when-problems-missing'
			? 'allow-online-search-when-problems-missing (search online only when problem statements are missing or unclear)'
			: 'uploaded-only (do not search online; rely on uploaded/pasted materials)';
	const lines: string[] = ['# Grader request'];
	const rawSource = options.sourceText?.trim();
	if (rawSource && rawSource.length > 0) {
		lines.push('', '## Original user message', '```', rawSource, '```');
	}
	const olympiadOverride = options.input.olympiad?.trim();
	if (olympiadOverride && olympiadOverride.length > 0) {
		lines.push('', '## Requested olympiad override', `- ${olympiadOverride}`);
	}
	if (options.input.notes) {
		lines.push('', '## User grading focus', options.input.notes.trim());
	}
	lines.push('', '## Reference source policy', `- ${referenceSourcePolicyText}`);
	if (options.attachments.length > 0) {
		lines.push('', '## Uploaded work');
		let index = 0;
		for (const attachment of options.attachments) {
			index += 1;
			const label = attachment.filename?.trim() || attachment.id;
			const pages =
				typeof attachment.pageCount === 'number' && attachment.pageCount > 0
					? `, pages=${attachment.pageCount.toString()}`
					: '';
			lines.push(
				`- ${index}. ${label} (${attachment.contentType}, size=${attachment.sizeBytes.toString()}${pages})`
			);
		}
	} else {
		lines.push('', '## Uploaded work', '- No attachments were included for this run.');
	}
	lines.push(
		'',
		'## Objectives',
		'- Identify olympiad + year/paper from uploaded learner materials.',
		'- Transcribe student work, problem statements, and any official solutions from uploads first.',
		'- For student submissions, keep transcription complete and faithful, then rewrite each problem into a numbered list of student statements/sentences in source order without retelling.',
		'- Preserve the student\'s variable names, formulas, terminology, and method choice as closely as possible while doing that cleanup.',
		'- Respect the reference source policy before any online search.',
		'- Feedback should be line-by-line against those numbered student statements.',
		'- If official solutions are missing, solve each problem carefully before grading and match the student\'s level/terminology/methods where reasonable.'
	);
	return lines.join('\n').trim() + '\n';
}

function renderGraderTask(options: {
	runId: string;
	workspaceId: string;
}): string {
	const baseTask = graderTaskTemplate
		.replaceAll('{{RUN_ID}}', options.runId)
		.replaceAll('{{WORKSPACE_ID}}', options.workspaceId)
		.trim();
	const transcriptionSkillSection = [
		'',
		'## Handwriting transcription workflow (must follow)',
		'Use this skill for extraction-first transcription of uploaded student work, problem statements, and official solutions.',
		'',
		'~~~markdown',
		HANDWRITING_TRANSCRIPTION_SKILL_TEXT,
		'~~~',
		'',
		'Grader-specific override:',
		'- When uploaded files are transcription targets, include them in the same initial `extract_text` call via `documentPaths`.',
		'- Leave `supportingPaths` unset unless a file is disambiguation-only and is not itself a transcription target.',
		'- Student solution transcription must be complete and faithful: after extraction, split each problem into a numbered list of student statements/sentences in source order.',
		'- Preserve student variable names, formulas, terminology, and method choices as closely as possible; allow only numbering, line-break cleanup, and obvious spelling fixes that do not change meaning.',
		'- Final grading feedback must be line-by-line against that numbered transcript.',
		'- When official solutions are missing, derived solutions should stay at the student\'s level and reuse their terminology/method style where reasonable.',
		'',
		'Run-mode constraints for grader runs:',
		"- Keep transcription and source gathering on the main agent only.",
		"- After transcription, use subagents for per-problem work: exactly 1 subagent per problem for solving/assessment.",
		"- Keep reference-text extraction disabled; rely on explicit `extract_text` instructions and direct source fidelity.",
	].join('\n');
	return `${baseTask}${transcriptionSkillSection}`.trim().concat('\n');
}

function buildGraderAgentPrompt(options: {
	runId: string;
	workspaceId: string;
	summaryPath: string;
	problemsDir: string;
}): string {
	return [
		'Grade an olympiad student submission from uploaded work and produce structured outputs.',
		'',
		`graderRunId: ${options.runId}`,
		`workspaceId: ${options.workspaceId}`,
		'',
		'Read and follow these files first:',
		'- brief.md',
		'- request.json',
		'- grader/task.md',
		'- grader/uploads/index.json',
		'- Respect request.json input.referenceSourcePolicy for online-search permissions.',
		'',
		'Deliverables:',
		'1) Write `grader/output/transcription.md` from a transcription-first extraction pass, then normalize student work into numbered statements/sentences (not a summary)',
		`2) Write per-problem markdown files under ${options.problemsDir}/ with line-by-line feedback keyed to those numbered statements`,
		`3) Write ${options.summaryPath}`,
		'4) When official solutions are missing, derive solutions at the student\'s level where reasonable and call done with olympiad/year and total marks summary'
	].join('\n');
}

const quizQuestionKindSchema = z
	.enum(['multiple-choice', 'type-answer', 'info-card'])
	.describe('Quiz question kind.');

const quizQuestionKindCountSchema = z
	.object({
		kind: quizQuestionKindSchema.describe('Question kind.'),
		count: z.number().int().min(1).max(50).describe('How many questions of this kind.')
	})
	.strict();

const quizPreferencesSchema = z
	.object({
		questionCount: z
			.number()
			.int()
			.min(1)
			.max(50)
			.describe('Total number of questions for this quiz plan item.')
			.optional(),
		questionKinds: z
			.array(quizQuestionKindCountSchema)
			.min(1)
			.describe('Exact mix of question kinds for this quiz plan item.')
			.optional()
	})
	.strict()
	.superRefine((value, ctx) => {
		if (!value.questionCount && !value.questionKinds) {
			return;
		}
		const kinds = value.questionKinds ?? [];
		const seenKinds = new Set<string>();
		let sum = 0;
		for (const entry of kinds) {
			if (seenKinds.has(entry.kind)) {
				ctx.addIssue({
					code: 'custom',
					path: ['questionKinds'],
					message: `Duplicate question kind "${entry.kind}"`
				});
			}
			seenKinds.add(entry.kind);
			sum += entry.count;
		}
		if (
			typeof value.questionCount === 'number' &&
			kinds.length > 0 &&
			sum !== value.questionCount
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['questionKinds'],
				message: `questionKinds sum (${sum}) must equal questionCount (${value.questionCount})`
			});
		}
	});

function nullableOptionalString() {
	return z
		.preprocess((value) => {
			if (value === null || value === undefined) {
				return undefined;
			}
			if (typeof value === 'string') {
				const trimmed = value.trim();
				return trimmed.length > 0 ? trimmed : undefined;
			}
			return value;
		}, z.string().trim().min(1).optional())
		.optional();
}

const nullableOptionalQuizPreferencesSchema = z
	.preprocess((value) => {
		if (value === null || value === undefined) {
			return undefined;
		}
		return value;
	}, quizPreferencesSchema.optional())
	.optional();

const planItemPreferencesSchema = z
	.object({
		kind: z
			.enum(['quiz', 'coding_problem', 'problem', 'media'])
			.transform((value): 'quiz' | 'coding_problem' | 'media' => {
				if (value === 'problem') {
					return 'coding_problem';
				}
				return value;
			})
			.describe(
				'Plan item kind: quiz, coding_problem (Python competitive programming), or media/story.'
			),
		title: nullableOptionalString().describe('Optional short title for the plan item.'),
		description: nullableOptionalString().describe('Optional description for the plan item.'),
		quiz: nullableOptionalQuizPreferencesSchema.describe(
			'Quiz constraints (only when kind="quiz").'
		)
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.kind !== 'quiz' && value.quiz) {
			ctx.addIssue({
				code: 'custom',
				path: ['quiz'],
				message: 'quiz preferences can only be set when kind="quiz"'
			});
		}
	});

const planPreferencesSchema = z
	.object({
		items: z
			.array(planItemPreferencesSchema)
			.min(1)
			.max(20)
			.describe('Preferred plan items. Array length controls number of plan items.')
	})
	.strict()
	.describe(
		'Optional plan shape preferences. Use this to control lesson length (instead of a duration in minutes).'
	)
	.optional();

const materialsSchema = z.preprocess(
	(value) => {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value === 'string') {
			const entries = value
				.split(/[\n,;]+/u)
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
			return entries.length > 0 ? entries : undefined;
		}
		return value;
	},
	z.array(z.string().trim().min(1)).optional()
);

const lessonCreateSchema = z.object({
	topic: z.string().trim().min(1).describe('Lesson topic.'),
	title: nullableOptionalString().describe('Optional lesson title override.'),
	level: nullableOptionalString().describe('Optional learner level.'),
	goal: nullableOptionalString().describe('Optional learning goal.'),
	sourceContext: nullableOptionalString().describe(
		'Optional key details extracted from user-provided images or PDFs that should be reflected in the lesson.'
	),
	plan: planPreferencesSchema,
	materials: materialsSchema.describe('Optional list of materials/links to incorporate.')
});

function buildLessonBrief(input: z.infer<typeof lessonCreateSchema>, sourceText?: string): string {
	const lines: string[] = ['# Lesson request', '', `## Topic`, input.topic.trim()];
	const raw = sourceText?.trim();
	if (raw && raw.length > 0) {
		lines.push('', '## Original user message', '```', raw, '```');
	}
	if (input.title) {
		lines.push('', '## Title', input.title.trim());
	}
	if (input.level) {
		lines.push('', '## Level', input.level.trim());
	}
	if (input.goal) {
		lines.push('', '## Goal', input.goal.trim());
	}
	if (input.sourceContext) {
		lines.push('', '## Source context', input.sourceContext.trim());
	}
	if (input.plan?.items && input.plan.items.length > 0) {
		lines.push('', '## Plan preferences');
		lines.push(`- Total plan items: ${input.plan.items.length}`);
		let index = 0;
		for (const item of input.plan.items) {
			index += 1;
			const titleSuffix = item.title ? ` — ${item.title.trim()}` : '';
			if (item.kind === 'quiz') {
				const questionCount =
					item.quiz?.questionCount ??
					(item.quiz?.questionKinds
						? item.quiz.questionKinds.reduce((sum, entry) => sum + entry.count, 0)
						: null);
				const kinds =
					item.quiz?.questionKinds && item.quiz.questionKinds.length > 0
						? item.quiz.questionKinds.map((entry) => `${entry.kind}: ${entry.count}`).join(', ')
						: null;
				const detailBits = [
					questionCount ? `${questionCount} questions` : null,
					kinds ? `mix: ${kinds}` : null
				].filter((value): value is string => Boolean(value));
				const details = detailBits.length > 0 ? ` (${detailBits.join('; ')})` : '';
				lines.push(`- ${index}. quiz${titleSuffix}${details}`);
				continue;
			}
			lines.push(`- ${index}. ${item.kind}${titleSuffix}`);
		}
		lines.push(
			'',
			'Notes:',
			'- Lesson duration is inferred from plan items + question counts (no fixed minutes).'
		);
	}
	if (input.materials && input.materials.length > 0) {
		lines.push('', '## Materials');
		for (const item of input.materials) {
			lines.push(`- ${item}`);
		}
	}
	lines.push(
		'',
		'## Notes',
		'- Publish this lesson into the user’s sessions (not welcome templates).'
	);
	return lines.join('\n').trim() + '\n';
}

function renderLessonTask(options: {
	template: string;
	sessionId: string;
	workspaceId: string;
	input: z.infer<typeof lessonCreateSchema>;
}): string {
	const title = options.input.title?.trim() ?? '—';
	const level = options.input.level?.trim() ?? '—';
	const goal = options.input.goal?.trim() ?? '—';
	const planItems =
		options.input.plan?.items && options.input.plan.items.length > 0
			? options.input.plan.items
					.map((item, index) => {
						const titleSuffix = item.title ? ` — ${item.title.trim()}` : '';
						if (item.kind !== 'quiz') {
							return `- ${index + 1}. ${item.kind}${titleSuffix}`;
						}
						const questionCount =
							item.quiz?.questionCount ??
							(item.quiz?.questionKinds
								? item.quiz.questionKinds.reduce((sum, entry) => sum + entry.count, 0)
								: null);
						const kinds =
							item.quiz?.questionKinds && item.quiz.questionKinds.length > 0
								? item.quiz.questionKinds.map((entry) => `${entry.kind}: ${entry.count}`).join(', ')
								: null;
						const detailBits = [
							questionCount ? `${questionCount} questions` : null,
							kinds ? `mix: ${kinds}` : null
						].filter((value): value is string => Boolean(value));
						const details = detailBits.length > 0 ? ` (${detailBits.join('; ')})` : '';
						return `- ${index + 1}. quiz${titleSuffix}${details}`;
					})
					.join('\n')
			: '- —';
	const materials =
		options.input.materials && options.input.materials.length > 0
			? options.input.materials.map((item) => `- ${item}`).join('\n')
			: '- —';

	return options.template
		.replaceAll('{{SESSION_ID}}', options.sessionId)
		.replaceAll('{{WORKSPACE_ID}}', options.workspaceId)
		.replaceAll('{{TOPIC}}', options.input.topic.trim())
		.replaceAll('{{TITLE}}', title)
		.replaceAll('{{LEVEL}}', level)
		.replaceAll('{{GOAL}}', goal)
		.replaceAll('{{PLAN_ITEMS_BULLETS}}', planItems)
		.replaceAll('{{MATERIALS_BULLETS}}', materials)
		.trim()
		.concat('\n');
}

function buildSparkChatTools(options: {
	userId: string;
	serviceAccountJson: string;
	sourceText?: string;
	conversationId?: string;
	attachmentsForMessage: z.infer<typeof attachmentSchema>[];
	requiresAttachmentContext?: boolean;
	attachmentLabels?: string[];
}): LlmToolSet {
	const {
		userId,
		serviceAccountJson,
		sourceText,
		conversationId,
		attachmentsForMessage,
		requiresAttachmentContext = false,
		attachmentLabels = []
	} = options;
	return {
		list_lessons: tool({
			description: 'List the user’s lessons (sessions), newest first, with status and progress.',
			inputSchema: z
				.object({
					limit: z.number().int().min(1).max(50).optional()
				})
				.strict(),
			execute: async ({ limit }) => {
				const sessions = await listSessions(userId, limit ?? 20);
				const states = await Promise.all(
					sessions.map((session) => getSessionState(userId, session.id))
				);
				const lessons = sessions.map((session, index) => {
					const state = states[index];
					const { completed, total } = countCompletedSteps(session, state);
					const status = deriveLessonStatus(session, state);
					return {
						id: session.id,
						title: session.title,
						tagline: session.tagline ?? session.summary ?? null,
						emoji: session.emoji ?? '📘',
						status,
						createdAt: session.createdAt.toISOString(),
						completed,
						total,
						href: `/spark/lesson/${session.id}`
					};
				});
				return { lessons };
			}
		}),
		get_lesson_status: tool({
			description: 'Get a lesson’s status, title, and step progress.',
			inputSchema: z
				.object({
					sessionId: z.string().trim().min(1)
				})
				.strict(),
			execute: async ({ sessionId }) => {
				const session = await getSession(userId, sessionId);
				if (!session) {
					return { found: false, sessionId };
				}
				const state = await getSessionState(userId, sessionId);
				const status = deriveLessonStatus(session, state);
				const { completed, total } = countCompletedSteps(session, state);
				return {
					found: true,
					sessionId,
					title: session.title,
					status,
					createdAt: session.createdAt.toISOString(),
					completed,
					total,
					href: `/spark/lesson/${session.id}`
				};
			}
		}),
		create_lesson: tool({
			description: [
				'Start creating a new lesson (published into the user’s sessions, not welcome templates).',
				'Creates a workspace with brief.md and launches a background agent to generate and publish the lesson.',
				'Lesson length is controlled via plan shape (no fixed duration minutes).',
				'If the user attached images/PDFs, include the key extracted details in sourceContext.',
				'',
				'Plan shape:',
				'- Provide plan.items; the array length sets the number of plan items.',
				'- For quiz items, you can set quiz.questionCount and/or quiz.questionKinds (counts per kind).',
				'',
				'Returns href and lessonsHref for navigation.'
			].join('\n'),
			inputSchema: lessonCreateSchema,
			execute: async (input) => {
				if (requiresAttachmentContext && !input.sourceContext?.trim()) {
					const labels =
						attachmentLabels.length > 0
							? attachmentLabels.join(', ')
							: 'uploaded image/PDF attachments';
					throw new Error(
						`sourceContext is required when the user uploads attachments. Inspect the attachment content and provide the key details (level, topic constraints, goals, exam board) in sourceContext before calling create_lesson. Attachments: ${labels}`
					);
				}
				let sessionId: string | null = null;
				let sessionSaved = false;
				try {
					const tasksEnv = requireTasksEnv();

					sessionId = randomUUID();
					const workspaceId = randomUUID();
					const agentId = randomUUID();
					const now = new Date();

					await saveSession(userId, {
						id: sessionId,
						title: input.title ?? input.topic,
						createdAt: now,
						status: 'generating',
						plan: [],
						nextLessonProposals: [],
						topics: [input.topic]
					});
					sessionSaved = true;
					await setCurrentSessionId(userId, sessionId).catch((error) => {
						console.warn('Unable to set current lesson', error);
					});

					const brief = buildLessonBrief(input, sourceText);

					await setFirestoreDocument({
						serviceAccountJson,
						documentPath: `users/${userId}/workspace/${workspaceId}`,
						data: {
							id: workspaceId,
							agentId,
							createdAt: now,
							updatedAt: now
						}
					});

					await writeWorkspaceTextFile({
						serviceAccountJson,
						userId,
						workspaceId,
						path: 'brief.md',
						content: brief,
						now
					});
					await writeWorkspaceTextFile({
						serviceAccountJson,
						userId,
						workspaceId,
						path: 'request.json',
						content: JSON.stringify(
							{
								sessionId,
								createdAt: now.toISOString(),
								input
							},
							null,
							2
						),
						now
					});

					const lessonTask = renderLessonTask({
						template: lessonTaskTemplate,
						sessionId,
						workspaceId,
						input
					});
					const requirements = [
						'# Requirements and decisions',
						'',
						'Fill this file with:',
						'- Hard requirements from brief.md (topic, level, goal, plan shape, materials).',
						'- Decisions: includeCoding (true/false), includeStory (true/false).',
						'- If plan preferences were provided, restate them here as constraints (plan items + question counts/types).',
						'- Any assumptions you are making.',
						'',
						`Session ID: ${sessionId}`,
						`Workspace ID: ${workspaceId}`,
						''
					].join('\n');
					const plan = [
						'# Plan',
						'',
						'- [running] Read brief.md, request.json, and lesson/task.md.',
						'- [pending] Write lesson/requirements.md (hard requirements + decisions).',
						'- [pending] Generate session draft (generate_text → lesson/drafts/session.md).',
						'- [pending] Grade + revise session draft until pass (lesson/feedback/session-grade.md).',
						'- [pending] Generate quiz drafts (generate_text → lesson/drafts/quiz/*.md).',
						'- [pending] Grade + revise quiz drafts (lesson/feedback/quiz/<planItemId>-grade.md).',
						'- [pending] Generate code problem drafts if needed (lesson/drafts/code/*.md).',
						'- [pending] Grade + revise code problem drafts (lesson/feedback/code/<planItemId>-grade.md).',
						'- [pending] Compile output JSON files under lesson/output/ (generate_json from drafts + schema).',
						'- [pending] Validate output JSON (validate_json; fix issues until ok=true).',
						'- [pending] Verify code problems with python_exec (if coding).',
						'- [pending] Call publish_lesson (fix errors until published).',
						'- [pending] Call done.'
					].join('\n');

					await Promise.all([
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/task.md',
							content: lessonTask,
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/plan.md',
							content: plan + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/requirements.md',
							content: requirements,
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/schema/README.md',
							content: lessonSchemaReadme.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/schema/session.schema.json',
							content: lessonSessionSchemaJson.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/schema/quiz.schema.json',
							content: lessonQuizSchemaJson.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/schema/coding_problem.schema.json',
							content: lessonCodingProblemSchemaJson.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/schema/media.schema.json',
							content: lessonMediaSchemaJson.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/session-draft.md',
							content: lessonPromptSessionDraft.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/session-grade.md',
							content: lessonPromptSessionGrade.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/session-revise.md',
							content: lessonPromptSessionRevise.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/quiz-draft.md',
							content: lessonPromptQuizDraft.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/quiz-grade.md',
							content: lessonPromptQuizGrade.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/quiz-revise.md',
							content: lessonPromptQuizRevise.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/code-draft.md',
							content: lessonPromptCodeDraft.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/code-grade.md',
							content: lessonPromptCodeGrade.trim() + '\n',
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'lesson/prompts/code-revise.md',
							content: lessonPromptCodeRevise.trim() + '\n',
							now
						})
					]);

					const prompt = [
						'Create and publish a Spark lesson using the workspace files (brief.md + lesson/*).',
						'',
						`sessionId: ${sessionId}`,
						`workspaceId: ${workspaceId}`,
						'',
						'Instructions:',
						'1) Read brief.md, request.json, and lesson/task.md.',
						'2) Fill lesson/requirements.md with hard requirements + decisions (includeCoding/includeStory).',
						'3) Use generate_text + the templates in lesson/prompts/ to draft/revise Markdown under lesson/drafts/ and to write grading reports under lesson/feedback/.',
						'   - Avoid asking generate_text to emit large JSON (it is less reliable than Markdown).',
						'4) Compile Firestore-ready JSON under lesson/output/ from the Markdown drafts using generate_json + validate_json.',
						'   - For each JSON output: generate_json({ sourcePath, schemaPath, outputPath }) then validate_json({ schemaPath, inputPath: outputPath }) and fix until ok=true.',
						'',
						'Examples:',
						" - generate_text({ promptPath: 'lesson/prompts/session-draft.md', outputPath: 'lesson/drafts/session.md' })",
						" - generate_text({ promptPath: 'lesson/prompts/session-grade.md', outputPath: 'lesson/feedback/session-grade.md' })  (must pass=true before publishing)",
						" - generate_text({ promptPath: 'lesson/prompts/quiz-draft.md', outputPath: 'lesson/drafts/quiz/q1.md' })",
						" - generate_text({ promptPath: 'lesson/prompts/quiz-grade.md', inputPaths: ['lesson/drafts/quiz/q1.md'], outputPath: 'lesson/feedback/quiz/q1-grade.md' })",
						" - generate_json({ sourcePath: 'lesson/drafts/session.md', schemaPath: 'lesson/schema/session.schema.json', outputPath: 'lesson/output/session.json' })",
						" - validate_json({ schemaPath: 'lesson/schema/session.schema.json', inputPath: 'lesson/output/session.json' })",
						'',
						'5) Call publish_lesson with:',
						`   - sessionId: ${sessionId}`,
						"   - sessionPath: 'lesson/output/session.json'",
						"   - briefPath: 'brief.md' (optional fallback for topic/topics)",
						'   - includeCoding: true if you included any plan items with kind="coding_problem"; otherwise false.',
						'   - includeStory: true if you included any plan items with kind="media"; otherwise false.',
						'6) If publish_lesson fails, fix the files and retry.',
						'7) Call done with a short summary including the sessionId.',
						'',
						'Do not publish into welcome templates.'
					].join('\n');

					await setFirestoreDocument({
						serviceAccountJson,
						documentPath: `users/${userId}/agents/${agentId}`,
						data: {
							id: agentId,
							prompt,
							status: 'created',
							workspaceId,
							lessonSessionId: sessionId,
							createdAt: now,
							updatedAt: now,
							statesTimeline: [{ state: 'created', timestamp: now }]
						}
					});

					await createTask(
						{
							type: 'runAgent',
							runAgent: { userId, agentId, workspaceId }
						},
						{
							serviceUrl: tasksEnv.serviceUrl,
							apiKey: tasksEnv.apiKey,
							serviceAccountJson
						}
					);

					return {
						status: 'started',
						sessionId,
						agentId,
						workspaceId,
						href: `/spark/lesson/${sessionId}`,
						lessonsHref: '/spark/lessons'
					};
				} catch (error) {
					console.error('Spark lesson creation tool failed', {
						userId,
						topic: input.topic,
						error: serializeErrorForLog(error)
					});
					if (sessionSaved && sessionId) {
						await patchFirestoreDocument({
							serviceAccountJson,
							documentPath: `spark/${userId}/sessions/${sessionId}`,
							updates: {
								status: 'error',
								tagline: 'Lesson creation failed. Please try again.'
							}
						}).catch(() => undefined);
					}
					throw error;
				}
			}
		}),
		create_grader: tool({
			description: [
				'Start an olympiad grading run from the learner’s uploaded solutions.',
				'Creates a grader workspace, seeds grader/task.md, and launches a background agent.',
				'Use this when the learner asks to mark/grade olympiad paper solutions.',
				'Uploads can include student handwriting, problem statements, and optional official solutions/mark schemes.',
				'Set referenceSourcePolicy based on learner confirmation: uploaded-only by default; allow online search only when the learner explicitly approves and problems are missing.',
				'If uploads are present, they are attached to the grader agent context automatically.',
				'Returns href and graderRunsHref for navigation.'
			].join('\n'),
			inputSchema: graderCreateSchema,
			execute: async (input) => {
				const tasksEnv = requireTasksEnv();
				const runId = randomUUID();
				const workspaceId = randomUUID();
				const agentId = randomUUID();
				const now = new Date();
				let runCreated = false;
				try {
					const olympiadLabel = input.olympiad?.trim() || DEFAULT_GRADER_OLYMPIAD_LABEL;
					const olympiadKey = normalizeOlympiadKey(olympiadLabel);
					const runAttachments = attachmentsForMessage
						.slice(0, GRADER_ATTACHMENT_LIMIT)
						.map((attachment) => ({
							id: attachment.id,
							storagePath: attachment.storagePath,
							contentType: attachment.contentType,
							filename: attachment.filename,
							sizeBytes: attachment.sizeBytes
						}));
					const runWorkspaceAttachments = runAttachments.map((attachment) => ({
						...attachment,
						workspacePath: resolveWorkspaceAttachmentPath(attachment)
					}));
					await createGraderRun(userId, {
						id: runId,
						agentId,
						workspaceId,
						conversationId,
						userPrompt: sourceText?.trim() || input.notes || undefined,
						olympiadKey,
						olympiadLabel,
						summaryPath: GRADER_SUMMARY_PATH,
						problemsDir: GRADER_PROBLEMS_DIR,
						sourceAttachmentIds: runAttachments.map((attachment) => attachment.id),
						sourceAttachmentCount: runAttachments.length,
						status: 'created',
						createdAt: now,
						updatedAt: now
					});
					runCreated = true;
					await setFirestoreDocument({
						serviceAccountJson,
						documentPath: `users/${userId}/workspace/${workspaceId}`,
						data: {
							id: workspaceId,
							agentId,
							createdAt: now,
							updatedAt: now
						}
					});
					const brief = buildGraderBrief({
						sourceText,
						input,
						attachments: runAttachments
					});
					const graderTask = renderGraderTask({
						runId,
						workspaceId
					});
					const prompt = buildGraderAgentPrompt({
						runId,
						workspaceId,
						summaryPath: GRADER_SUMMARY_PATH,
						problemsDir: GRADER_PROBLEMS_DIR
					});
					await Promise.all([
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'brief.md',
							content: brief,
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'request.json',
							content: JSON.stringify(
								{
									runId,
									createdAt: now.toISOString(),
									conversationId: conversationId ?? null,
									sourceText: sourceText ?? null,
									input,
									attachments: runAttachments
								},
								null,
								2
							),
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: 'grader/task.md',
							content: graderTask,
							now
						}),
						writeWorkspaceTextFile({
							serviceAccountJson,
							userId,
							workspaceId,
							path: GRADER_UPLOADS_MANIFEST_PATH,
							content: JSON.stringify(
								{
									attachments: runWorkspaceAttachments
								},
								null,
								2
							),
							now
						}),
						...runWorkspaceAttachments.map((attachment) =>
							writeWorkspaceStorageLinkFile({
								serviceAccountJson,
								userId,
								workspaceId,
								path: attachment.workspacePath,
								storagePath: attachment.storagePath,
								contentType: attachment.contentType,
								sizeBytes: attachment.sizeBytes,
								now
							})
						)
					]);
					await setFirestoreDocument({
						serviceAccountJson,
						documentPath: `users/${userId}/agents/${agentId}`,
						data: {
							id: agentId,
							prompt,
							status: 'created',
							workspaceId,
							graderRunId: runId,
							graderSummaryPath: GRADER_SUMMARY_PATH,
							graderProblemsDir: GRADER_PROBLEMS_DIR,
							inputAttachments: runAttachments,
							graderInputAttachments: runAttachments,
							createdAt: now,
							updatedAt: now,
							statesTimeline: [{ state: 'created', timestamp: now }]
						}
					});
					await createTask(
						{
							type: 'runAgent',
							runAgent: { userId, agentId, workspaceId }
						},
						{
							serviceUrl: tasksEnv.serviceUrl,
							apiKey: tasksEnv.apiKey,
							serviceAccountJson
						}
					);
					return {
						status: 'started',
						runId,
						agentId,
						workspaceId,
						href: `/spark/grader/${runId}`,
						graderRunsHref: '/spark/grader'
					};
				} catch (error) {
					console.error('Spark grader creation tool failed', {
						userId,
						runId,
						error: serializeErrorForLog(error)
					});
					if (runCreated) {
						const message =
							error instanceof Error && error.message.trim().length > 0
								? error.message.trim()
								: 'Failed to start grader run.';
						await patchGraderRun(userId, runId, {
							status: 'failed',
							updatedAt: new Date(),
							completedAt: new Date(),
							error: message
						}).catch(() => undefined);
					}
					throw error;
				}
			}
		})
	};
}

async function generateAssistantResponse(
	conversation: ConversationDoc,
	options: {
		userId: string;
		conversationId: string;
		bucketName: string;
		serviceAccountJson: string;
		messageId: string;
		attachments: z.infer<typeof attachmentSchema>[];
	},
	handlers: StreamHandlers
): Promise<string> {
	const attachmentParts = await downloadAttachmentParts(
		{
			userId: options.userId,
			bucketName: options.bucketName,
			serviceAccountJson: options.serviceAccountJson
		},
		options.attachments
	);
	const input = buildLlmInputMessages(conversation.messages, {
		attachmentMessageId: options.messageId,
		attachmentParts
	});
	const sourceText = (() => {
		const message = conversation.messages.find(
			(entry) => entry && entry.id === options.messageId && entry.role === 'user'
		);
		if (!message) {
			return undefined;
		}
		const text = extractTextParts(message.content);
		return text.length > 0 ? text : undefined;
	})();
	const attachmentsForTools = resolveAttachmentsForToolCall({
		conversation,
		currentMessageId: options.messageId,
		currentMessageAttachments: options.attachments,
		limit: GRADER_ATTACHMENT_LIMIT
	});
	const tools = buildSparkChatTools({
		userId: options.userId,
		serviceAccountJson: options.serviceAccountJson,
		sourceText,
		conversationId: options.conversationId,
		attachmentsForMessage: attachmentsForTools,
		requiresAttachmentContext: options.attachments.length > 0,
		attachmentLabels: options.attachments.map((attachment) => {
			const filename = attachment.filename?.trim();
			if (filename && filename.length > 0) {
				return filename;
			}
			const pageSuffix =
				typeof attachment.pageCount === 'number' && attachment.pageCount > 0
					? ` (${attachment.pageCount.toString()} pages)`
					: '';
			return `${attachment.contentType}${pageSuffix}`;
		})
	});
	const result = await runAgentLoop({
		model: MODEL_ID,
		input,
		instructions: SYSTEM_PROMPT,
		tools,
		maxSteps: SPARK_AGENT_MAX_TOOL_STEPS,
		thinkingLevel: OPENAI_REASONING_EFFORT,
		logging: {
			workspaceDir: path.join(
				os.tmpdir(),
				'spark-chat-logs',
				options.conversationId,
				options.messageId
			),
			mirrorToConsole: false,
			sink: {
				append: (line) => {
					console.log(`[spark-chat:${options.conversationId}] ${line}`);
				}
			}
		},
		onEvent: (event) => {
			if (event.type !== 'delta') {
				return;
			}
			if (event.channel === 'thought') {
				handlers.onDelta?.({ thoughtDelta: event.text });
				return;
			}
			handlers.onDelta?.({ textDelta: event.text });
		},
	});
	return normalizeSparkLinks(result.text);
}

async function generateAssistantResponseWithRetries(
	conversation: ConversationDoc,
	options: {
		userId: string;
		conversationId: string;
		bucketName: string;
		serviceAccountJson: string;
		messageId: string;
		attachments: z.infer<typeof attachmentSchema>[];
	},
	handlers: StreamHandlers
): Promise<string> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= GENERATION_MAX_ATTEMPTS; attempt += 1) {
		let emittedDelta = false;
		try {
			return await generateAssistantResponse(
				conversation,
				{
					userId: options.userId,
					conversationId: options.conversationId,
					bucketName: options.bucketName,
					serviceAccountJson: options.serviceAccountJson,
					messageId: options.messageId,
					attachments: options.attachments
				},
				{
					onDelta: (delta) => {
						if (
							(typeof delta.textDelta === 'string' && delta.textDelta.length > 0) ||
							(typeof delta.thoughtDelta === 'string' && delta.thoughtDelta.length > 0)
						) {
							emittedDelta = true;
						}
						handlers.onDelta?.(delta);
					}
				}
			);
		} catch (error) {
			lastError = error;
			const statusCode = resolveErrorStatusCode(error);
			const retryable = isRetryableGenerationError(error);
			const canRetry = retryable && !emittedDelta && attempt < GENERATION_MAX_ATTEMPTS;
			console.warn('[spark-chat] generation attempt failed', {
				userId: options.userId,
				conversationId: options.conversationId,
				messageId: options.messageId,
				attempt,
				maxAttempts: GENERATION_MAX_ATTEMPTS,
				statusCode,
				retryable,
				emittedDelta,
				willRetry: canRetry,
				error: serializeErrorForLog(error)
			});
			if (!canRetry) {
				throw error;
			}
			const sleepMs = resolveGenerationRetryDelayMs(attempt);
			console.warn('[spark-chat] retry sleep before next generation attempt', {
				userId: options.userId,
				conversationId: options.conversationId,
				messageId: options.messageId,
				attempt,
				nextAttempt: attempt + 1,
				sleepMs
			});
			await sleep(sleepMs);
		}
	}
	if (lastError) {
		throw lastError;
	}
	throw new Error('Generation failed after all retry attempts.');
}

function hasGeminiCredentials(): boolean {
	return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

function normalizeSparkLinks(text: string): string {
	return text
		.replace(
			/https?:\/\/[^\s)]+(\/spark\/lesson\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/giu,
			'$1'
		)
		.replace(
			/https?:\/\/[^\s)]+(\/spark\/grader\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/giu,
			'$1'
		)
		.replace(/https?:\/\/[^\s)]+(\/spark\/lessons)(?=[\s)\].,!?]|$)/giu, '$1')
		.replace(/https?:\/\/[^\s)]+(\/spark\/grader)(?=[\s)\].,!?]|$)/giu, '$1');
}

async function streamFallbackText(
	text: string,
	onDelta: (delta: SparkChatDelta) => void
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
	const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
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
		console.error('Failed to parse Spark AI Agent request body', {
			userId,
			error: serializeErrorForLog(error)
		});
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
	let conversation: ConversationDoc = resolveConversationDoc(
		undefined,
		userId,
		conversationId,
		now
	).conversation;
	let conversationAttachments: SparkAgentAttachment[] = [];

	try {
		const snapshot = await getFirestoreDocument({
			serviceAccountJson,
			documentPath: conversationDocPath
		});
		const resolvedConversation = resolveConversationDoc(
			snapshot.exists ? (snapshot.data ?? undefined) : undefined,
			userId,
			conversationId,
			now
		);
		conversation = resolvedConversation.conversation;
		conversationAttachments = conversation.attachments ?? [];
	} catch (error) {
		console.error('Spark AI Agent Firestore unavailable', {
			userId,
			conversationId,
			error: serializeErrorForLog(error)
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
				sizeBytes: existing.sizeBytes,
				pageCount: existing.pageCount
			});
			continue;
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
	conversation.attachments = conversationAttachments;

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
			userId,
			conversationId,
			error: serializeErrorForLog(error)
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
				await patchFirestoreDocument({
					serviceAccountJson,
					documentPath: conversationDocPath,
					updates: {
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

		const handleDelta = (delta: SparkChatDelta): void => {
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
				assistantText = await generateAssistantResponseWithRetries(
					conversation,
					{
						userId,
						conversationId,
						bucketName,
						serviceAccountJson,
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
			console.error('Failed to generate Spark AI Agent response', {
				userId,
				conversationId,
				messageId: assistantMessageId,
				error: serializeErrorForLog(error)
			});
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
