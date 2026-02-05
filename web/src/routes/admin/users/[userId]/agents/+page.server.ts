import { listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import { SparkAgentStateSchema } from '@spark/schemas';
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

const AGENT_RUN_LIST_LIMIT = 50;

export const load: PageServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);

	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `users/${userId}/agents`,
		limit: AGENT_RUN_LIST_LIMIT,
		orderBy: 'updatedAt desc'
	});

	const agents: Array<{
		id: string;
		status: string;
		stopRequested: boolean;
		workspaceId: string;
		promptPreview: string;
		createdAt: string;
		updatedAt: string;
		resultSummary: string | null;
		error: string | null;
	}> = [];

	for (const doc of docs) {
		const id = docIdFromPath(doc.documentPath);
		const parsed = SparkAgentStateSchema.safeParse({ id, ...(doc.data ?? {}) });
		if (!parsed.success) {
			continue;
		}
		const prompt = parsed.data.prompt.trim();
		agents.push({
			id: parsed.data.id,
			status: parsed.data.status,
			stopRequested: Boolean(parsed.data.stop_requested),
			workspaceId: parsed.data.workspaceId,
			promptPreview: prompt.length > 180 ? `${prompt.slice(0, 180)}…` : prompt,
			createdAt: toIso(parsed.data.createdAt),
			updatedAt: toIso(parsed.data.updatedAt),
			resultSummary: parsed.data.resultSummary ?? null,
			error: parsed.data.error ?? null
		});
	}

	return { agents };
};

