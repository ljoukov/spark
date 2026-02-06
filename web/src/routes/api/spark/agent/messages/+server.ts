import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { createSseStream, sseResponse } from '$lib/server/utils/sse';
import { createTask, runToolLoop, tool } from '@spark/llm';
import type { LlmContent, LlmContentPart, LlmTextDelta, LlmToolSet } from '@spark/llm';
import {
	SparkAgentAttachmentSchema,
	type SparkAgentAttachment,
	type SparkAgentContentPart,
	type SparkAgentMessage
} from '@spark/schemas';
import { dev } from '$app/environment';
import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getFirestoreDocument, patchFirestoreDocument, setFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import { encodeBytesToBase64 } from '$lib/server/gcp/base64';
import { env } from '$env/dynamic/private';
import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import { listSessions, getSession, saveSession, setCurrentSessionId } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import sparkChatSystemPrompt from '$lib/server/agent/spark-chat-system-prompt.md?raw';
import lessonTaskTemplate from '$lib/server/lessonAgent/task-template.md?raw';
import lessonSchemaReadme from '$lib/server/lessonAgent/schema/README.md?raw';
import lessonSessionSchemaJson from '$lib/server/lessonAgent/schema/session.schema.json?raw';
import lessonQuizSchemaJson from '$lib/server/lessonAgent/schema/quiz.schema.json?raw';
import lessonCodeSchemaJson from '$lib/server/lessonAgent/schema/code.schema.json?raw';
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

const MIN_UPDATE_INTERVAL_MS = 500;
const MAX_HISTORY_MESSAGES = 20;
const MODEL_ID = 'gemini-2.5-pro' as const;
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

const ROLE_TO_LLM: Record<SparkAgentMessage['role'], LlmContent['role']> = {
	user: 'user',
	assistant: 'model',
	system: 'system',
	tool: 'tool'
};

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

function encodeWorkspaceFileId(filePath: string): string {
	return encodeURIComponent(filePath);
}

async function writeWorkspaceTextFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	path: string;
	content: string;
	now: Date;
}): Promise<void> {
	const lowerPath = options.path.toLowerCase();
	const contentType = lowerPath.endsWith('.md')
		? 'text/markdown'
		: lowerPath.endsWith('.json')
			? 'application/json'
			: 'text/plain';
	const sizeBytes = new TextEncoder().encode(options.content).byteLength;
	await setFirestoreDocument({
		serviceAccountJson: options.serviceAccountJson,
		documentPath: `users/${options.userId}/workspace/${options.workspaceId}/files/${encodeWorkspaceFileId(
			options.path
		)}`,
		data: {
			path: options.path,
			content: options.content,
			contentType,
			sizeBytes,
			createdAt: options.now,
			updatedAt: options.now
		}
	});
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
		if (typeof value.questionCount === 'number' && kinds.length > 0 && sum !== value.questionCount) {
			ctx.addIssue({
				code: 'custom',
				path: ['questionKinds'],
				message: `questionKinds sum (${sum}) must equal questionCount (${value.questionCount})`
			});
		}
	});

const planItemPreferencesSchema = z
	.object({
		kind: z
			.enum(['quiz', 'problem', 'media'])
			.describe('Plan item kind: quiz, coding problem, or media/story.'),
		title: z.string().trim().min(1).describe('Optional short title for the plan item.').optional(),
		description: z
			.string()
			.trim()
			.min(1)
			.describe('Optional description for the plan item.')
			.optional(),
		quiz: quizPreferencesSchema.describe('Quiz constraints (only when kind="quiz").').optional()
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
	title: z.string().trim().min(1).describe('Optional lesson title override.').optional(),
	level: z.string().trim().min(1).describe('Optional learner level.').optional(),
	goal: z.string().trim().min(1).describe('Optional learning goal.').optional(),
	plan: planPreferencesSchema,
	materials: materialsSchema.describe('Optional list of materials/links to incorporate.')
});

function buildLessonBrief(
	input: z.infer<typeof lessonCreateSchema>,
	sourceText?: string
): string {
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
	lines.push('', '## Notes', '- Publish this lesson into the user’s sessions (not welcome templates).');
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
}): LlmToolSet {
	const { userId, serviceAccountJson, sourceText } = options;
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
				const states = await Promise.all(sessions.map((session) => getSessionState(userId, session.id)));
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
				'',
				'Plan shape:',
				'- Provide plan.items; the array length sets the number of plan items.',
				'- For quiz items, you can set quiz.questionCount and/or quiz.questionKinds (counts per kind).',
				'',
				'Returns href and lessonsHref for navigation.'
			].join('\n'),
			inputSchema: lessonCreateSchema,
			execute: async (input) => {
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
							path: 'lesson/schema/code.schema.json',
							content: lessonCodeSchemaJson.trim() + '\n',
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
						'   - includeCoding: true if you included any plan items with kind="problem"; otherwise false.',
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
						error: error instanceof Error ? error.message : String(error)
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
		})
	};
}

async function generateAssistantResponse(
	conversation: ConversationDoc,
	options: {
		userId: string;
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
	const contents = buildLlmContents(conversation.messages, {
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
	const tools = buildSparkChatTools({
		userId: options.userId,
		serviceAccountJson: options.serviceAccountJson,
		sourceText
	});
	const result = await runToolLoop({
		modelId: MODEL_ID,
		contents,
		tools,
		maxSteps: 12,
		onDelta: handlers.onDelta
	});
	return normalizeSparkLinks(result.text);
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
			/https?:\/\/[^\s)]+(\/spark\/lessons)(?=[\s)\].,!?]|$)/giu,
			'$1'
		);
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
		conversationAttachments = normalizeAttachments(snapshot.data?.attachments, now);
		conversation = resolveConversationDoc(
			snapshot.exists ? (snapshot.data ?? undefined) : undefined,
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
				assistantText = await generateAssistantResponse(
					conversation,
					{
						userId,
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
