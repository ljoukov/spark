import { listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import { SparkAgentConversationSchema, type SparkAgentConversation } from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required')
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

function toIso(value: Date): string {
	return value.toISOString();
}

function textPreview(conversation: SparkAgentConversation): string {
	const last = conversation.messages[conversation.messages.length - 1];
	if (!last) {
		return '';
	}
	for (const part of last.content) {
		if (part.type === 'text') {
			return part.text.trim();
		}
	}
	return '';
}

const CONVERSATION_LIST_LIMIT = 50;

export const load: PageServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);

	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `${userId}/client/conversations`,
		limit: CONVERSATION_LIST_LIMIT,
		orderBy: 'lastMessageAt desc'
	});

	const conversations: Array<{
		id: string;
		familyId: string | null;
		participantIds: string[];
		createdAt: string | null;
		lastMessageAt: string | null;
		messageCount: number;
		preview: string;
	}> = [];

	for (const doc of docs) {
		const id = docIdFromPath(doc.documentPath);
		const parsed = SparkAgentConversationSchema.safeParse({ id, ...(doc.data ?? {}) });
		if (parsed.success) {
			const preview = textPreview(parsed.data);
			conversations.push({
				id: parsed.data.id,
				familyId: parsed.data.familyId ?? null,
				participantIds: parsed.data.participantIds,
				createdAt: toIso(parsed.data.createdAt),
				lastMessageAt: toIso(parsed.data.lastMessageAt),
				messageCount: parsed.data.messages.length,
				preview: preview.slice(0, 140)
			});
			continue;
		}

		const messages = Array.isArray(doc.data?.messages) ? doc.data?.messages : [];
		conversations.push({
			id,
			familyId: typeof doc.data?.familyId === 'string' ? doc.data.familyId : null,
			participantIds: Array.isArray(doc.data?.participantIds)
				? doc.data.participantIds.filter((value): value is string => typeof value === 'string')
				: [],
			createdAt: null,
			lastMessageAt: null,
			messageCount: messages.length,
			preview: ''
		});
	}

	return {
		conversations
	};
};

