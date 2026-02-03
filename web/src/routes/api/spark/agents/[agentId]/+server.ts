import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getFirebaseAdminFirestore } from '@spark/llm';
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

export const GET: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsedParams: z.infer<typeof paramsSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_params', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_params' }, { status: 400 });
	}

	const firestore = getFirebaseAdminFirestore();
	const agentRef = firestore
		.collection('users')
		.doc(userId)
		.collection('agents')
		.doc(parsedParams.agentId);

	const agentSnap = await agentRef.get();
	if (!agentSnap.exists) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const agentParsed = SparkAgentStateSchema.safeParse({
		id: agentSnap.id,
		...agentSnap.data()
	});
	if (!agentParsed.success) {
		return json({ error: 'invalid_agent' }, { status: 500 });
	}

	const agent: SparkAgentState = agentParsed.data;
	const filesSnap = await firestore
		.collection('users')
		.doc(userId)
		.collection('workspace')
		.doc(agent.workspaceId)
		.collection('files')
		.orderBy('path', 'asc')
		.limit(200)
		.get();

	const files: SparkAgentWorkspaceFile[] = [];
	for (const fileDoc of filesSnap.docs) {
		const data = fileDoc.data();
		const payload = {
			...data,
			path:
				typeof data.path === 'string' && data.path.trim().length > 0
					? data.path.trim()
					: decodeFileId(fileDoc.id)
		};
		const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
		if (!parsed.success) {
			continue;
		}
		files.push(parsed.data);
	}

	let log: SparkAgentRunLog | null = null;
	const logSnap = await agentRef.collection('logs').doc('log').get();
	if (logSnap.exists) {
		const data = logSnap.data() ?? {};
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
		const parsed = SparkAgentRunLogSchema.safeParse(payload);
		if (parsed.success) {
			log = parsed.data;
		}
	}

	return json({ agent, files, log }, { status: 200 });
};
