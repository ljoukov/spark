import { extractBearerToken } from '$lib/server/auth/apiAuth';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { logServerEvent } from '$lib/server/utils/logger';
import {
	CheckMateChatMessageProto_Role,
	CheckMateService,
	StreamChatResponseProtoSchema,
	type StreamChatResponseProto
} from '$proto';
import { create } from '@bufbuild/protobuf';
import {
	generateText,
	loadEnvFromFile,
	type LlmContent,
	type LlmTextDelta,
	type LlmTextModelId
} from '@spark/llm';
import type { ConnectRouter, HandlerContext } from '@connectrpc/connect';
import { Code, ConnectError } from '@connectrpc/connect';
import path from 'node:path';
import { z } from 'zod';

const STREAM_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';

const GreetRequestSchema = z.object({
	name: z.string().min(1)
});

const ChatMessageSchema = z
	.object({
		role: z.nativeEnum(CheckMateChatMessageProto_Role),
		text: z.string().trim().min(1)
	})
	.refine((value) => value.role !== CheckMateChatMessageProto_Role.UNSPECIFIED, {
		message: 'Role is required'
	});

const StreamChatRequestSchema = z.object({
	messages: z.array(ChatMessageSchema).min(1)
});

let checkMateEnvLoaded = false;

async function requireAuth(context: HandlerContext): Promise<void> {
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
		await verifyFirebaseIdToken(token);
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

function loadCheckMateEnv(): void {
	if (checkMateEnvLoaded) {
		return;
	}
	const cwd = process.cwd();
	const envPath = cwd.endsWith(`${path.sep}web`)
		? path.join(cwd, '.env.local')
		: path.join(cwd, 'web', '.env.local');
	loadEnvFromFile(envPath, { override: false });
	checkMateEnvLoaded = true;
}

function toLlmContents(messages: z.infer<typeof ChatMessageSchema>[]): LlmContent[] {
	return messages.map((message) => ({
		role: message.role === CheckMateChatMessageProto_Role.USER ? 'user' : 'model',
		parts: [{ type: 'text', text: message.text }]
	}));
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
		async *streamChat(request, context) {
			loadCheckMateEnv();
			logServerEvent({
				message: 'CheckMate StreamChat request received.',
				context: {
					messageCount: request.messages.length
				}
			});
			await requireAuth(context);
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
			try {
				const queue: StreamChatResponseProto[] = [];
				let streamDone = false;
				let streamError: Error | null = null;
				let notify: (() => void) | null = null;

				const flush = (): void => {
					if (!notify) {
						return;
					}
					const resolve = notify;
					notify = null;
					resolve();
				};

				const enqueue = (delta: LlmTextDelta): void => {
					if (delta.thoughtDelta) {
						queue.push(
							create(StreamChatResponseProtoSchema, {
								payload: {
									case: 'thinkingDelta',
									value: delta.thoughtDelta
								}
							})
						);
					}
					if (delta.textDelta) {
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

				void generateText({
					modelId: STREAM_MODEL_ID,
					contents,
					onDelta: enqueue
				})
					.then(() => {
						queue.push(
							create(StreamChatResponseProtoSchema, {
								payload: {
									case: 'done',
									value: true
								}
							})
						);
						streamDone = true;
						flush();
					})
					.catch((error) => {
						streamError = error instanceof Error ? error : new Error(String(error));
						streamDone = true;
						flush();
					});

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
