import { getFirestoreDocument, listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import {
	SparkAgentRunLogSchema,
	SparkAgentStateSchema,
	SparkAgentWorkspaceFileSchema,
	type SparkAgentRunLog,
	type SparkAgentState,
	type SparkAgentWorkspaceFile
} from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required'),
	agentId: z.string().trim().min(1, 'agentId is required')
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function toIso(value: Date | undefined): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

function decodeFileId(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseLogTimestamp(key: string): Date | null {
	const match = /^t(\\d{13})_\\d{3}$/.exec(key);
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

function serializeAgent(agent: SparkAgentState): {
	id: string;
	prompt: string;
	status: string;
	workspaceId: string;
	stopRequested: boolean;
	createdAt: string;
	updatedAt: string;
	statesTimeline: Array<{ state: string; timestamp: string }>;
	resultSummary: string | null;
	error: string | null;
} {
	return {
		id: agent.id,
		prompt: agent.prompt,
		status: agent.status,
		workspaceId: agent.workspaceId,
		stopRequested: Boolean(agent.stop_requested),
		createdAt: agent.createdAt.toISOString(),
		updatedAt: agent.updatedAt.toISOString(),
		statesTimeline: agent.statesTimeline.map((entry) => ({
			state: entry.state,
			timestamp: entry.timestamp.toISOString()
		})),
		resultSummary: agent.resultSummary ?? null,
		error: agent.error ?? null
	};
}

function serializeFiles(files: SparkAgentWorkspaceFile[]): Array<{
	path: string;
	fileId: string;
	createdAt: string;
	updatedAt: string;
	sizeBytes: number | null;
	contentType: string | null;
}> {
	return files.map((file) => ({
		path: file.path,
		fileId: encodeURIComponent(file.path),
		createdAt: file.createdAt.toISOString(),
		updatedAt: file.updatedAt.toISOString(),
		sizeBytes: typeof file.sizeBytes === 'number' ? file.sizeBytes : null,
		contentType: file.contentType ?? null
	}));
}

function serializeLog(log: SparkAgentRunLog): {
	updatedAt: string | null;
	stream: { updatedAt: string | null; assistant: string; thoughts: string } | null;
	stats: SparkAgentRunLog['stats'] | null;
	lines: Array<{ key: string; timestamp: string; line: string }>;
} {
	return {
		updatedAt: toIso(log.updatedAt),
		stream: log.stream
			? {
					updatedAt: toIso(log.stream.updatedAt),
					assistant: log.stream.assistant ?? '',
					thoughts: log.stream.thoughts ?? ''
				}
			: null,
		stats: log.stats ?? null,
		lines: log.lines.map((entry) => ({
			key: entry.key,
			timestamp: entry.timestamp.toISOString(),
			line: entry.line
		}))
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId, agentId } = paramsSchema.parse(params);

	const serviceAccountJson = requireServiceAccountJson();
	const agentDocPath = `users/${userId}/agents/${agentId}`;
	const agentSnap = await getFirestoreDocument({ serviceAccountJson, documentPath: agentDocPath });

	if (!agentSnap.exists || !agentSnap.data) {
		return {
			agentDocFound: false,
			agentParseOk: false,
			agent: null,
			parseIssues: [],
			files: [],
			log: null
		};
	}

	const agentParsed = SparkAgentStateSchema.safeParse({ id: agentId, ...(agentSnap.data ?? {}) });
	if (!agentParsed.success) {
		return {
			agentDocFound: true,
			agentParseOk: false,
			agent: null,
			parseIssues: agentParsed.error.issues.map((issue) => ({
				path: issue.path.join('.'),
				message: issue.message
			})),
			files: [],
			log: null
		};
	}

	const agent = agentParsed.data;

	const filesDocs = await listFirestoreDocuments({
		serviceAccountJson,
		collectionPath: `users/${userId}/workspace/${agent.workspaceId}/files`,
		limit: 200,
		orderBy: 'path asc'
	});

	const files: SparkAgentWorkspaceFile[] = [];
	for (const fileDoc of filesDocs) {
		const data = fileDoc.data ?? {};
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
		const payload: Record<string, unknown> = { lines: limitedEntries };
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

	return {
		agentDocFound: true,
		agentParseOk: true,
		agent: serializeAgent(agent),
		parseIssues: [],
		files: serializeFiles(files),
		log: log ? serializeLog(log) : null
	};
};

