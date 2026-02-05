import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { SparkAgentConversationSchema, type SparkAgentConversation } from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required'),
	conversationId: z.string().trim().min(1, 'conversationId is required')
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function toIso(value: Date): string {
	return value.toISOString();
}

function serializeConversation(conversation: SparkAgentConversation): {
	id: string;
	familyId: string | null;
	participantIds: string[];
	createdAt: string;
	updatedAt: string;
	lastMessageAt: string;
	messages: Array<{
		id: string;
		role: SparkAgentConversation['messages'][number]['role'];
		createdAt: string;
		author: SparkAgentConversation['messages'][number]['author'] | null;
		content: SparkAgentConversation['messages'][number]['content'];
	}>;
	attachments: Array<{
		id: string;
		storagePath: string;
		contentType: string;
		filename?: string;
		downloadUrl?: string;
		sizeBytes: number;
		pageCount?: number;
		status: string;
		createdAt: string;
		updatedAt: string;
		messageId?: string;
		error?: string;
	}>;
} {
	return {
		id: conversation.id,
		familyId: conversation.familyId ?? null,
		participantIds: conversation.participantIds,
		createdAt: toIso(conversation.createdAt),
		updatedAt: toIso(conversation.updatedAt),
		lastMessageAt: toIso(conversation.lastMessageAt),
		messages: conversation.messages.map((message) => ({
			id: message.id,
			role: message.role,
			createdAt: toIso(message.createdAt),
			author: message.author ?? null,
			content: message.content
		})),
		attachments: (conversation.attachments ?? []).map((attachment) => ({
			id: attachment.id,
			storagePath: attachment.storagePath,
			contentType: attachment.contentType,
			filename: attachment.filename,
			downloadUrl: attachment.downloadUrl,
			sizeBytes: attachment.sizeBytes,
			pageCount: attachment.pageCount,
			status: attachment.status,
			createdAt: toIso(attachment.createdAt),
			updatedAt: toIso(attachment.updatedAt),
			messageId: attachment.messageId,
			error: attachment.error
		}))
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId, conversationId } = paramsSchema.parse(params);

	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `${userId}/client/conversations/${conversationId}`
	});

	if (!snapshot.exists || !snapshot.data) {
		return {
			conversationDocFound: false,
			conversationParseOk: false,
			conversation: null,
			parseIssues: []
		};
	}

	const parsed = SparkAgentConversationSchema.safeParse({ id: conversationId, ...(snapshot.data ?? {}) });
	if (!parsed.success) {
		return {
			conversationDocFound: true,
			conversationParseOk: false,
			conversation: null,
			parseIssues: parsed.error.issues.map((issue) => ({
				path: issue.path.join('.'),
				message: issue.message
			}))
		};
	}

	return {
		conversationDocFound: true,
		conversationParseOk: true,
		conversation: serializeConversation(parsed.data),
		parseIssues: []
	};
};

