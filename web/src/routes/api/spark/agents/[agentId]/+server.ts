import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument, listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import {
	SparkAgentStateSchema,
	SparkAgentRunLogSchema,
	SparkAgentWorkspaceFileSchema,
	type SparkAgentState,
	type SparkAgentRunLog,
	type SparkAgentWorkspaceFile
} from '@spark/schemas';

const paramsSchema = z.object({
	agentId: z.string().trim().min(1)
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function decodeFileId(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseLogTimestamp(key: string): Date | null {
	const match = /^t(\d{13})_\d{3}$/.exec(key);
	if (!match) {
		return null;
	}
	const ms = Number.parseInt(match[1] ?? '', 10);
	if (!Number.isFinite(ms)) {
		return null;
	}
	return new Date(ms);
}

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

export const GET: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;
	const serviceAccountJson = requireServiceAccountJson();

	let parsedParams: z.infer<typeof paramsSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_params', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_params' }, { status: 400 });
	}

	const agentDocPath = `users/${userId}/agents/${parsedParams.agentId}`;
	const agentSnap = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: agentDocPath
	});
	if (!agentSnap.exists || !agentSnap.data) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const agentParsed = SparkAgentStateSchema.safeParse({
		id: parsedParams.agentId,
		...agentSnap.data
	});
	if (!agentParsed.success) {
		return json({ error: 'invalid_agent' }, { status: 500 });
	}

	const agent: SparkAgentState = agentParsed.data;
	const filesDocs = await listFirestoreDocuments({
		serviceAccountJson,
		collectionPath: `users/${userId}/workspace/${agent.workspaceId}/files`,
		limit: 200,
		orderBy: 'path asc'
	});

	const files: SparkAgentWorkspaceFile[] = [];
	for (const fileDoc of filesDocs) {
		const data = fileDoc.data;
		const payload = {
			...data,
			path:
				typeof data.path === 'string' && data.path.trim().length > 0
					? data.path.trim()
					: decodeFileId(docIdFromPath(fileDoc.documentPath))
		};
		const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
		if (!parsed.success) {
			continue;
		}
		files.push(parsed.data);
	}

	let log: SparkAgentRunLog | null = null;
	const logSnap = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: `${agentDocPath}/logs/log`
	});
	if (logSnap.exists && logSnap.data) {
		const data = logSnap.data ?? {};
		const rawLines = data.lines && typeof data.lines === 'object' ? data.lines : null;
		const entries: Array<{ key: string; timestamp: Date; line: string }> = [];
		if (rawLines && !Array.isArray(rawLines)) {
			for (const [key, value] of Object.entries(rawLines as Record<string, unknown>)) {
				if (typeof value !== 'string') {
					continue;
				}
				const timestamp = parseLogTimestamp(key) ?? null;
				if (!timestamp) {
					continue;
				}
				entries.push({ key, timestamp, line: value });
			}
		}
		entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
		const limitedEntries = entries.slice(-2000);
		const payload: Record<string, unknown> = {
			lines: limitedEntries
		};
		if (data.updatedAt !== undefined) {
			payload.updatedAt = data.updatedAt;
		}
		if (data.stats && typeof data.stats === 'object') {
			payload.stats = data.stats;
		}
		if (data.stream && typeof data.stream === 'object') {
			payload.stream = data.stream;
		}
		const parsed = SparkAgentRunLogSchema.safeParse(payload);
		if (parsed.success) {
			log = parsed.data;
		}
	}

	return json({ agent, files, log }, { status: 200 });
};
