import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { createSseStream, sseResponse } from '$lib/server/utils/sse';
import { getFirebaseAdminFirestore, generateText, loadEnvFromFile, loadLocalEnv } from '@spark/llm';
import type { LlmContent, LlmTextDelta } from '@spark/llm';
import type { SparkAgentContentPart, SparkAgentMessage } from '@spark/schemas';
import { dev } from '$app/environment';
import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

const MIN_UPDATE_INTERVAL_MS = 500;
const MAX_HISTORY_MESSAGES = 20;
const MODEL_ID = 'gemini-flash-latest' as const;
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
	storagePath: z.string().trim().min(1, 'storagePath is required'),
	contentType: z.string().trim().min(1, 'contentType is required'),
	sizeBytes: z.number().int().min(1, 'sizeBytes must be positive'),
	pageCount: z.number().int().min(1).optional()
});

const requestSchema = z.object({
	conversationId: z.string().trim().min(1).optional(),
	text: z.string().trim().min(1, 'text is required'),
	attachments: z.array(attachmentSchema).optional(),
	targetUserId: z.string().trim().min(1).optional()
});

type ConversationDoc = {
	id: string;
	familyId?: string;
	participantIds: string[];
	createdAt: Date;
	updatedAt: Date;
	lastMessageAt: Date;
	messages: SparkAgentMessage[];
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
	raw: FirebaseFirestore.DocumentData | undefined,
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

function toConversationPayload(conversation: ConversationDoc): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		id: conversation.id,
		participantIds: conversation.participantIds,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		lastMessageAt: conversation.lastMessageAt,
		messages: conversation.messages
	};
	if (conversation.familyId) {
		payload.familyId = conversation.familyId;
	}
	return payload;
}

function resolveContentParts(
	text: string,
	attachments: z.infer<typeof attachmentSchema>[]
): SparkAgentContentPart[] {
	const parts: SparkAgentContentPart[] = [{ type: 'text', text }];
	for (const attachment of attachments) {
		const isImage = attachment.contentType.startsWith('image/');
		const filePart = {
			storagePath: attachment.storagePath,
			contentType: attachment.contentType,
			sizeBytes: attachment.sizeBytes,
			pageCount: attachment.pageCount
		};
		if (isImage) {
			parts.push({ type: 'image', file: filePart });
		} else {
			parts.push({ type: 'file', file: filePart });
		}
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

function buildLlmContents(messages: SparkAgentMessage[]): LlmContent[] {
	const contents: LlmContent[] = [{ role: 'user', parts: [{ type: 'text', text: SYSTEM_PROMPT }] }];
	const start = Math.max(0, messages.length - MAX_HISTORY_MESSAGES);
	for (let i = start; i < messages.length; i += 1) {
		const message = messages[i];
		if (!message) {
			continue;
		}
		const text = extractTextParts(message.content);
		if (!text) {
			continue;
		}
		contents.push({
			role: ROLE_TO_LLM[message.role],
			parts: [{ type: 'text', text }]
		});
	}
	return contents;
}

type StreamHandlers = {
	onDelta?: (delta: LlmTextDelta) => void;
};

async function generateAssistantResponse(
	conversation: ConversationDoc,
	handlers: StreamHandlers
): Promise<string> {
	const contents = buildLlmContents(conversation.messages);
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
	const firestore = getFirebaseAdminFirestore();
	const now = new Date();
	const conversationRef = firestore
		.collection(userId)
		.doc('client')
		.collection('conversations')
		.doc(conversationId);
	let conversation: ConversationDoc;

	try {
		const snapshot = await conversationRef.get();
		conversation = resolveConversationDoc(
			snapshot.exists ? snapshot.data() : undefined,
			userId,
			conversationId,
			now
		).conversation;
	} catch (error) {
		console.error('Spark AI Agent Firestore access failed', { error, userId });
		return json(
			{ error: 'server_misconfigured', message: 'Firestore unavailable' },
			{ status: 500 }
		);
	}

	const messageId = randomUUID();
	const assistantMessageId = randomUUID();
	const attachments = parsedBody.attachments ?? [];
	const trimmedText = parsedBody.text.trim();
	const userMessage: SparkAgentMessage = {
		id: messageId,
		role: 'user',
		author: { userId },
		createdAt: now,
		content: resolveContentParts(trimmedText, attachments)
	};
	const assistantMessage: SparkAgentMessage = {
		id: assistantMessageId,
		role: 'assistant',
		createdAt: now,
		content: [{ type: 'text', text: '' }]
	};

	appendMessage(conversation, userMessage);
	appendMessage(conversation, assistantMessage);

	await conversationRef.set(
		toConversationPayload({
			...conversation,
			updatedAt: now,
			lastMessageAt: now,
			messages: conversation.messages
		}),
		{ merge: true }
	);

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
				await conversationRef.set(
					{
						updatedAt: nowTimestampValue,
						lastMessageAt: nowTimestampValue,
						messages: conversation.messages
					},
					{ merge: true }
				);
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
				await generateAssistantResponse(conversation, { onDelta: handleDelta });
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
