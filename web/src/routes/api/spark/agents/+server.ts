import { json, type RequestHandler } from '@sveltejs/kit';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import {
	collection,
	doc,
	getDocs,
	getFirestore,
	limit as limitQuery,
	orderBy,
	query,
	setDoc
} from '@ljoukov/firebase-admin-cloudflare/firestore';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { createTask } from '@spark/llm';
import { SparkAgentStateSchema, type SparkAgentState } from '@spark/schemas';
import { env } from '$env/dynamic/private';

const requestSchema = z.object({
	prompt: z.string().trim().min(1),
	workspaceId: z.string().trim().min(1).optional()
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

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

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

export const GET: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const docs = await getDocs(
		query(collection(firestore, `users/${userId}/agents`), orderBy('createdAt', 'desc'), limitQuery(50))
	);

	const agents: SparkAgentState[] = [];
	for (const agentDoc of docs.docs) {
		const parsed = SparkAgentStateSchema.safeParse({
			id: docIdFromPath(agentDoc.ref.path),
			...agentDoc.data()
		});
		if (!parsed.success) {
			continue;
		}
		agents.push(parsed.data);
	}

	return json({ agents }, { status: 200 });
};

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const tasksEnv = requireTasksEnv();

	let parsed: z.infer<typeof requestSchema>;
	try {
		parsed = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const agentId = randomUUID();
	const workspaceId = parsed.workspaceId ?? randomUUID();
	const now = new Date();

	await setDoc(doc(firestore, `users/${userId}/agents/${agentId}`), {
		id: agentId,
		prompt: parsed.prompt,
		status: 'created',
		workspaceId,
		createdAt: now,
		updatedAt: now,
		statesTimeline: [{ state: 'created', timestamp: now }]
	});

	await setDoc(doc(firestore, `users/${userId}/workspace/${workspaceId}`), {
		id: workspaceId,
		agentId,
		createdAt: now,
		updatedAt: now
	});

	await createTask({
		type: 'runAgent',
		runAgent: { userId, agentId, workspaceId }
	}, {
		serviceUrl: tasksEnv.serviceUrl,
		apiKey: tasksEnv.apiKey,
		serviceAccountJson
	});

	return json({ agentId, workspaceId }, { status: 201 });
};
