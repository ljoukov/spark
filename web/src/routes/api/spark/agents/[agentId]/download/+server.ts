import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { zipSync, strToU8 } from 'fflate';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument, listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import {
	SparkAgentStateSchema,
	SparkAgentWorkspaceFileSchema,
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

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

function decodeFileId(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseLogTimestamp(key: string): { ms: number; seq: number } | null {
	const match = /^t(\d{13})_(\d{3})$/.exec(key);
	if (!match) {
		return null;
	}
	const ms = Number.parseInt(match[1] ?? '', 10);
	if (!Number.isFinite(ms)) {
		return null;
	}
	const seq = Number.parseInt(match[2] ?? '', 10);
	return { ms, seq: Number.isFinite(seq) ? seq : 0 };
}

function formatAgentLogText(data: Record<string, unknown> | null): string {
	if (!data) {
		return '';
	}
	const rawLines = data.lines && typeof data.lines === 'object' ? data.lines : null;
	if (!rawLines || Array.isArray(rawLines)) {
		return '';
	}
	const entries: Array<{ ms: number; seq: number; line: string }> = [];
	for (const [key, value] of Object.entries(rawLines as Record<string, unknown>)) {
		if (typeof value !== 'string') {
			continue;
		}
		const parsedTs = parseLogTimestamp(key);
		if (!parsedTs) {
			continue;
		}
		entries.push({ ms: parsedTs.ms, seq: parsedTs.seq, line: value });
	}
	entries.sort((a, b) => {
		const diff = a.ms - b.ms;
		if (diff !== 0) {
			return diff;
		}
		return a.seq - b.seq;
	});
	return entries.map((entry) => `${new Date(entry.ms).toISOString()} ${entry.line}`).join('\n') + '\n';
}

function toSafeWorkspaceZipPath(filePath: string): string | null {
	const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const parts = normalized.split('/').filter((part) => part.length > 0);
	if (parts.length === 0) {
		return null;
	}
	if (parts.some((part) => part === '..')) {
		return null;
	}
	return parts.join('/');
}

export const GET: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;
	const serviceAccountJson = requireServiceAccountJson();

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_params', issues: parsedParams.error.issues }, { status: 400 });
	}
	const agentId = parsedParams.data.agentId;

	const agentDocPath = `users/${userId}/agents/${agentId}`;
	const agentSnap = await getFirestoreDocument({ serviceAccountJson, documentPath: agentDocPath });
	if (!agentSnap.exists || !agentSnap.data) {
		return json({ error: 'not_found' }, { status: 404 });
	}
	const agentParsed = SparkAgentStateSchema.safeParse({ id: agentId, ...agentSnap.data });
	if (!agentParsed.success) {
		return json({ error: 'invalid_agent' }, { status: 500 });
	}
	const agent = agentParsed.data;

	const filesDocs = await listFirestoreDocuments({
		serviceAccountJson,
		collectionPath: `users/${userId}/workspace/${agent.workspaceId}/files`,
		limit: 1000,
		orderBy: 'path asc'
	});

	const workspaceFiles: SparkAgentWorkspaceFile[] = [];
	for (const docSnap of filesDocs) {
		const data = docSnap.data ?? {};
		const payload = {
			...data,
			path:
				typeof data.path === 'string' && data.path.trim().length > 0
					? data.path.trim()
					: decodeFileId(docIdFromPath(docSnap.documentPath))
		};
		const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
		if (!parsed.success) {
			continue;
		}
		workspaceFiles.push(parsed.data);
	}

	const logSnap = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: `${agentDocPath}/logs/log`
	});
	const agentLogText = formatAgentLogText(logSnap.exists ? logSnap.data : null);

	const archiveLabel = `spark-agent-${agentId}`;
	const archiveEntries: Record<string, Uint8Array> = {
		'agent.log': strToU8(agentLogText)
	};
	for (const file of workspaceFiles) {
		const safePath = toSafeWorkspaceZipPath(file.path);
		if (!safePath) {
			continue;
		}
		archiveEntries[`workspace/${safePath}`] = strToU8(file.content ?? '');
	}

	const zipped = zipSync(archiveEntries, { level: 9 });
	const body = new ArrayBuffer(zipped.byteLength);
	new Uint8Array(body).set(zipped);
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'application/zip',
			'cache-control': 'no-store',
			'content-disposition': `attachment; filename="${archiveLabel}.zip"`
		}
	});
};
