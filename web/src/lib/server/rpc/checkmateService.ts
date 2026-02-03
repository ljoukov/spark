import { extractBearerToken } from '$lib/server/auth/apiAuth';
import { CheckMateWaitUntilContextKey } from '$lib/server/rpc/checkmateContext';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { logServerEvent } from '$lib/server/utils/logger';
import {
	CheckMateChatMessageProto_Role,
	CheckMateChatSummaryProtoSchema,
	CheckMateChatStatusProtoSchema,
	CheckMateChatStatusProto_State,
	CheckMateService,
	StreamChatResponseProtoSchema,
	type CheckMateChatSummaryProto,
	type CheckMateChatStatusProto,
	type StreamChatResponseProto
} from '$proto';
import { create } from '@bufbuild/protobuf';
import { TimestampSchema } from '$proto/gen/google/protobuf/timestamp_pb';
import {
	generateText,
	type LlmContent,
	type LlmTextDelta,
	type LlmTextModelId
} from '@spark/llm';
import type { ConnectRouter, HandlerContext } from '@connectrpc/connect';
import { Code, ConnectError } from '@connectrpc/connect';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument
} from '$lib/server/gcp/firestoreRest';

const STREAM_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';
const CONVERSATION_UPDATE_INTERVAL_MS = 10_000;
const CHAT_LIST_DEFAULT_LIMIT = 50;
const CHAT_LIST_MAX_LIMIT = 100;

const GreetRequestSchema = z.object({
	name: z.string().min(1)
});

const ChatMessageRoleSchema = z.union([
	z.literal(CheckMateChatMessageProto_Role.USER),
	z.literal(CheckMateChatMessageProto_Role.ASSISTANT)
]);

const ChatMessageSchema = z.object({
	role: ChatMessageRoleSchema,
	text: z.string().trim().min(1)
});

const StreamChatRequestSchema = z.object({
	messages: z.array(ChatMessageSchema).min(1),
	conversationId: z.string().trim().optional()
});

const ListChatsRequestSchema = z
	.object({
		limit: z.number().int().min(0).max(CHAT_LIST_MAX_LIMIT).optional()
	})
	.transform(({ limit }) => ({
		limit: limit && limit > 0 ? limit : CHAT_LIST_DEFAULT_LIMIT
	}));

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

async function requireAuth(context: HandlerContext): Promise<string> {
	const authHeader = context.requestHeader.get('authorization');
	const token = extractBearerToken(authHeader);
	if (!token) {
		logServerEvent({
			level: 'warn',
			message: 'CheckMate auth missing.',
			context: {
				hasAuthHeader: Boolean(authHeader)
			}
		});
		throw new ConnectError('Missing authentication token.', Code.Unauthenticated);
	}
	try {
		const decoded = await verifyFirebaseIdToken(token);
		return decoded.sub;
	} catch (error) {
		logServerEvent({
			level: 'warn',
			message: 'CheckMate auth failed.',
			context: {
				error: error instanceof Error ? error.message : String(error)
			}
		});
		throw new ConnectError('Invalid or expired authentication token.', Code.Unauthenticated);
	}
}

function resolveConversationCollectionPath(userId: string): string {
	// Stored under /{userId}/client/checkmate_conversations/{conversationId}
	return `${userId}/client/checkmate_conversations`;
}

function resolveConversationDocPath(userId: string, conversationId: string): string {
	return `${resolveConversationCollectionPath(userId)}/${conversationId}`;
}

function toLlmContents(messages: z.infer<typeof ChatMessageSchema>[]): LlmContent[] {
	return messages.map((message) => ({
		role: message.role === CheckMateChatMessageProto_Role.USER ? 'user' : 'model',
		parts: [{ type: 'text', text: message.text }]
	}));
}

type ConversationMessage = {
	role: 'user' | 'assistant' | 'thinking';
	text: string;
};

type ConversationStatusState = 'idle' | 'streaming' | 'error';

type ConversationStatus = {
	state: ConversationStatusState;
	updatedAt: Date;
	errorMessage?: string;
};

type ConversationDoc = {
	id: string;
	participantIds: string[];
	createdAt: Date;
	updatedAt: Date;
	lastMessageAt: Date;
	messages: ConversationMessage[];
	status?: ConversationStatus;
};

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

function resolveConversationId(value: string | undefined): string {
	if (value && value.trim().length > 0) {
		return value.trim();
	}
	return randomUUID();
}

function toConversationMessages(
	messages: z.infer<typeof ChatMessageSchema>[]
): ConversationMessage[] {
	const mapped: ConversationMessage[] = [];
	for (const message of messages) {
		mapped.push({
			role: message.role === CheckMateChatMessageProto_Role.USER ? 'user' : 'assistant',
			text: message.text
		});
	}
	return mapped;
}

function updateAssistantMessage(
	messages: ConversationMessage[],
	assistantIndex: number,
	text: string
): void {
	if (assistantIndex < 0 || assistantIndex >= messages.length) {
		return;
	}
	messages[assistantIndex] = { role: 'assistant', text };
}

function updateThinkingMessage(
	messages: ConversationMessage[],
	thinkingIndex: number,
	text: string
): void {
	if (thinkingIndex < 0 || thinkingIndex >= messages.length) {
		return;
	}
	messages[thinkingIndex] = { role: 'thinking', text };
}

function statusStateToProto(state: ConversationStatusState): CheckMateChatStatusProto_State {
	const mapping: Record<ConversationStatusState, CheckMateChatStatusProto_State> = {
		idle: CheckMateChatStatusProto_State.IDLE,
		streaming: CheckMateChatStatusProto_State.STREAMING,
		error: CheckMateChatStatusProto_State.ERROR
	};
	return mapping[state];
}

function parseStatusState(value: unknown): ConversationStatusState | null {
	if (value === 'idle' || value === 'streaming' || value === 'error') {
		return value;
	}
	if (typeof value === 'number') {
		switch (value) {
			case CheckMateChatStatusProto_State.IDLE:
				return 'idle';
			case CheckMateChatStatusProto_State.STREAMING:
				return 'streaming';
			case CheckMateChatStatusProto_State.ERROR:
				return 'error';
			default:
				return null;
		}
	}
	return null;
}

function parseConversationStatus(value: unknown): ConversationStatus | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const record = value as { state?: unknown; updatedAt?: unknown; errorMessage?: unknown };
	const state = parseStatusState(record.state);
	if (!state) {
		return null;
	}
	const updatedAt = resolveTimestamp(record.updatedAt, new Date());
	const errorMessage =
		typeof record.errorMessage === 'string' && record.errorMessage.trim().length > 0
			? record.errorMessage.trim()
			: undefined;
	return {
		state,
		updatedAt,
		errorMessage
	};
}

function extractFirstLine(text: string): string {
	const lines = text.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return '';
}

function resolveConversationTitle(messages: ConversationMessage[]): string {
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		const firstLine = extractFirstLine(message.text);
		if (firstLine.length > 0) {
			return firstLine;
		}
	}
	if (messages.length > 0) {
		const firstLine = extractFirstLine(messages[0]?.text ?? '');
		if (firstLine.length > 0) {
			return firstLine;
		}
	}
	return 'New chat';
}

function resolveConversationSnippet(messages: ConversationMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
			continue;
		}
		const firstLine = extractFirstLine(message.text ?? '');
		if (firstLine.length > 0) {
			return firstLine;
		}
	}
	return '';
}

function parseConversationMessages(value: unknown): ConversationMessage[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const parsed: ConversationMessage[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const record = entry as { role?: unknown; text?: unknown };
		if (record.role !== 'user' && record.role !== 'assistant' && record.role !== 'thinking') {
			continue;
		}
		const text = typeof record.text === 'string' ? record.text : '';
		parsed.push({ role: record.role, text });
	}
	return parsed;
}

function toTimestampProto(date: Date) {
	const millis = date.getTime();
	const seconds = BigInt(Math.floor(millis / 1000));
	const nanos = Math.floor((millis % 1000) * 1_000_000);
	return create(TimestampSchema, { seconds, nanos });
}

function toStatusProto(status: ConversationStatus): CheckMateChatStatusProto {
	return create(CheckMateChatStatusProtoSchema, {
		state: statusStateToProto(status.state),
		updatedAt: toTimestampProto(status.updatedAt),
		errorMessage: status.errorMessage ?? ''
	});
}

function toConversationSummaryProto(
	conversationId: string,
	messages: ConversationMessage[],
	lastMessageAt: Date,
	status: ConversationStatus | null
): CheckMateChatSummaryProto {
	return create(CheckMateChatSummaryProtoSchema, {
		conversationId,
		title: resolveConversationTitle(messages),
		snippet: resolveConversationSnippet(messages),
		lastMessageAt: toTimestampProto(lastMessageAt),
		status: status ? toStatusProto(status) : undefined
	});
}

export function registerCheckMateRoutes(router: ConnectRouter): void {
	router.service(CheckMateService, {
		async greet(request, context) {
			logServerEvent({
				message: 'CheckMate Greet request received.',
				context: {
					nameLength: request.name.length
				}
			});
			await requireAuth(context);
			const parsed = GreetRequestSchema.safeParse(request);
			if (!parsed.success) {
				logServerEvent({
					level: 'warn',
					message: 'CheckMate Greet request invalid.',
					context: {
						issues: parsed.error.issues.map((issue) => issue.message)
					}
				});
				throw new ConnectError('Invalid request payload.', Code.InvalidArgument);
			}
			const response = { message: `Hello ${parsed.data.name}` };
			logServerEvent({
				message: 'CheckMate Greet response sent.',
				context: {
					nameLength: parsed.data.name.length
				}
			});
			return response;
		},
		async listChats(request, context) {
			logServerEvent({
				message: 'CheckMate ListChats request received.',
				context: {
					limit: String(request.limit)
				}
			});
			const userId = await requireAuth(context);
			const parsed = ListChatsRequestSchema.safeParse(request);
			if (!parsed.success) {
				logServerEvent({
					level: 'warn',
					message: 'CheckMate ListChats request invalid.',
					context: {
						issues: parsed.error.issues.map((issue) => issue.message)
					}
				});
				throw new ConnectError('Invalid request payload.', Code.InvalidArgument);
			}
			const limit = parsed.data.limit;
			let docs;
			try {
				docs = await listFirestoreDocuments({
					serviceAccountJson: requireServiceAccountJson(),
					collectionPath: resolveConversationCollectionPath(userId),
					limit,
					orderBy: 'lastMessageAt desc'
				});
			} catch (error) {
				logServerEvent({
					level: 'error',
					message: 'CheckMate ListChats fetch failed.',
					context: {
						error: error instanceof Error ? error.message : String(error)
					}
				});
				throw new ConnectError('Failed to load chats.', Code.Internal);
			}

			const chats: CheckMateChatSummaryProto[] = [];
			for (const doc of docs) {
				const data = doc.data;
				const messages = parseConversationMessages(data?.messages);
				const status = parseConversationStatus(data?.status);
				const lastMessageAt = resolveTimestamp(
					data?.lastMessageAt ?? data?.updatedAt ?? data?.createdAt,
					new Date()
				);
				const conversationId = doc.documentPath.split('/').filter(Boolean).pop() ?? doc.documentPath;
				chats.push(toConversationSummaryProto(conversationId, messages, lastMessageAt, status));
			}
			logServerEvent({
				message: 'CheckMate ListChats response sent.',
				context: {
					chatCount: String(chats.length)
				}
			});
			return { chats };
		},
		async *streamChat(request, context) {
			logServerEvent({
				message: 'CheckMate StreamChat request received.',
				context: {
					messageCount: request.messages.length
				}
			});
			const userId = await requireAuth(context);
			const parsed = StreamChatRequestSchema.safeParse(request);
			if (!parsed.success) {
				logServerEvent({
					level: 'warn',
					message: 'CheckMate StreamChat request invalid.',
					context: {
						issues: parsed.error.issues.map((issue) => issue.message)
					}
				});
				throw new ConnectError('Invalid request payload.', Code.InvalidArgument);
			}

			const contents = toLlmContents(parsed.data.messages);
			const conversationId = resolveConversationId(parsed.data.conversationId);
			const now = new Date();
			const conversationDocPath = resolveConversationDocPath(userId, conversationId);
			let createdAt = now;
			let participantIds: string[] = [userId];
			try {
				const snapshot = await getFirestoreDocument({
					serviceAccountJson: requireServiceAccountJson(),
					documentPath: conversationDocPath
				});
				if (snapshot.exists) {
					const data = snapshot.data;
					createdAt = resolveTimestamp(data?.createdAt, now);
					const rawParticipants = Array.isArray(data?.participantIds) ? data?.participantIds : null;
					if (rawParticipants && rawParticipants.length > 0) {
						participantIds = rawParticipants.filter(
							(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
						);
					}
				}
			} catch (error) {
				logServerEvent({
					level: 'warn',
					message: 'CheckMate conversation fetch failed.',
					context: {
						error: error instanceof Error ? error.message : String(error)
					}
				});
			}

			const conversationMessages = toConversationMessages(parsed.data.messages);
			conversationMessages.push({ role: 'assistant', text: '' });
			let assistantIndex = conversationMessages.length - 1;
			let thinkingIndex: number | null = null;
			let thinkingText = '';
			const initialStatus: ConversationStatus = {
				state: 'streaming',
				updatedAt: now,
				errorMessage: ''
			};
			const conversation: ConversationDoc = {
				id: conversationId,
				participantIds,
				createdAt,
				updatedAt: now,
				lastMessageAt: now,
				messages: conversationMessages,
				status: initialStatus
			};

			await patchFirestoreDocument({
				serviceAccountJson: requireServiceAccountJson(),
				documentPath: conversationDocPath,
				updates: conversation as unknown as Record<string, unknown>
			});

			try {
				const queue: StreamChatResponseProto[] = [];
				let streamDone = false;
				let streamError: Error | null = null;
				let notify: (() => void) | null = null;
				let streamActive = true;
				if (context.signal.aborted) {
					streamActive = false;
				} else {
					context.signal.addEventListener(
						'abort',
						() => {
							streamActive = false;
						},
						{ once: true }
					);
				}

				const emitStatus = (status: ConversationStatus): void => {
					if (!streamActive) {
						return;
					}
					queue.push(
						create(StreamChatResponseProtoSchema, {
							payload: {
								case: 'status',
								value: toStatusProto(status)
							}
						})
					);
					flush();
				};

				const persistStatus = async (status: ConversationStatus): Promise<void> => {
					conversation.status = status;
					conversation.updatedAt = status.updatedAt;
					try {
						await patchFirestoreDocument({
							serviceAccountJson: requireServiceAccountJson(),
							documentPath: conversationDocPath,
							updates: {
								status: {
									state: status.state,
									updatedAt: status.updatedAt,
									errorMessage: status.errorMessage ?? ''
								},
								updatedAt: status.updatedAt
							}
						});
					} catch (error) {
						logServerEvent({
							level: 'warn',
							message: 'CheckMate status update failed.',
							context: {
								error: error instanceof Error ? error.message : String(error)
							}
						});
					}
				};

				const flush = (): void => {
					if (!notify) {
						return;
					}
					const resolve = notify;
					notify = null;
					resolve();
				};

				const enqueue = (delta: LlmTextDelta): void => {
					if (delta.thoughtDelta && streamActive) {
						queue.push(
							create(StreamChatResponseProtoSchema, {
								payload: {
									case: 'thinkingDelta',
									value: delta.thoughtDelta
								}
							})
						);
					}
					if (delta.textDelta && streamActive) {
						queue.push(
							create(StreamChatResponseProtoSchema, {
								payload: {
									case: 'responseDelta',
									value: delta.textDelta
								}
							})
						);
					}
					flush();
				};

				emitStatus(initialStatus);

				const runGeneration = async (): Promise<void> => {
					let assistantText = '';
					let lastPersistedText = '';
					let hasPendingUpdate = false;
					let lastUpdate = Date.now();
					let pendingFlush: NodeJS.Timeout | null = null;
					let flushInFlight = false;

					const flushUpdate = async (force: boolean): Promise<void> => {
						if (!hasPendingUpdate && !force) {
							return;
						}
						if (!hasPendingUpdate && force) {
							return;
						}
						const nowTimestampValue = new Date();
						const elapsed = Date.now() - lastUpdate;
						if (!force && elapsed < CONVERSATION_UPDATE_INTERVAL_MS) {
							if (!pendingFlush) {
								pendingFlush = setTimeout(() => {
									pendingFlush = null;
									void flushUpdate(false);
								}, CONVERSATION_UPDATE_INTERVAL_MS - elapsed);
							}
							return;
						}
						if (flushInFlight) {
							return;
						}
						flushInFlight = true;
						try {
							updateAssistantMessage(conversationMessages, assistantIndex, assistantText);
							conversation.updatedAt = nowTimestampValue;
							conversation.lastMessageAt = nowTimestampValue;
							await patchFirestoreDocument({
								serviceAccountJson: requireServiceAccountJson(),
								documentPath: conversationDocPath,
								updates: {
									updatedAt: nowTimestampValue,
									lastMessageAt: nowTimestampValue,
									messages: conversationMessages
								}
							});
							lastPersistedText = assistantText;
							hasPendingUpdate = false;
							lastUpdate = Date.now();
						} finally {
							flushInFlight = false;
						}
					};

					const handleDelta = (delta: LlmTextDelta): void => {
						if (delta.thoughtDelta) {
							thinkingText += delta.thoughtDelta;
							if (thinkingIndex === null) {
								conversationMessages.splice(assistantIndex, 0, {
									role: 'thinking',
									text: thinkingText
								});
								thinkingIndex = assistantIndex;
								assistantIndex += 1;
							} else {
								updateThinkingMessage(conversationMessages, thinkingIndex, thinkingText);
							}
							hasPendingUpdate = true;
							enqueue({ thoughtDelta: delta.thoughtDelta });
							void flushUpdate(false);
						}
						if (delta.textDelta) {
							assistantText += delta.textDelta;
							hasPendingUpdate = assistantText !== lastPersistedText || hasPendingUpdate;
							enqueue({ textDelta: delta.textDelta });
							void flushUpdate(false);
						}
					};

					try {
						await generateText({
							modelId: STREAM_MODEL_ID,
							contents,
							onDelta: handleDelta
						});
						hasPendingUpdate = assistantText !== lastPersistedText;
						await flushUpdate(true);
						const finalStatus: ConversationStatus = {
							state: 'idle',
							updatedAt: new Date()
						};
						await persistStatus(finalStatus);
						emitStatus(finalStatus);
						if (streamActive) {
							queue.push(
								create(StreamChatResponseProtoSchema, {
									payload: {
										case: 'done',
										value: true
									}
								})
							);
						}
					} catch (error) {
						const resolvedError = error instanceof Error ? error : new Error(String(error));
						const errorStatus: ConversationStatus = {
							state: 'error',
							updatedAt: new Date(),
							errorMessage: resolvedError.message
						};
						await persistStatus(errorStatus);
						emitStatus(errorStatus);
						streamError = resolvedError;
					} finally {
						if (pendingFlush) {
							clearTimeout(pendingFlush);
						}
						streamDone = true;
						flush();
					}
				};

				const runTask = runGeneration();
				const waitUntil = context.values.get(CheckMateWaitUntilContextKey);
				if (waitUntil) {
					waitUntil(runTask);
				}

				while (true) {
					if (queue.length > 0) {
						const next = queue.shift();
						if (next) {
							yield next;
						}
						continue;
					}
					if (streamDone) {
						if (streamError) {
							throw streamError;
						}
						break;
					}
					await new Promise<void>((resolve) => {
						notify = resolve;
					});
				}
				logServerEvent({
					message: 'CheckMate StreamChat response completed.',
					context: {
						messageCount: parsed.data.messages.length
					}
				});
			} catch (error) {
				logServerEvent({
					level: 'error',
					message: 'CheckMate StreamChat response failed.',
					context: {
						error: error instanceof Error ? error.message : String(error)
					}
				});
				throw new ConnectError('Failed to stream response.', Code.Internal);
			}
		}
	});
}
