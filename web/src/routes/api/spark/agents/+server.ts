import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { createTask, getFirebaseAdminFirestore } from '@spark/llm';
import { SparkAgentStateSchema, type SparkAgentState } from '@spark/schemas';

const requestSchema = z.object({
	prompt: z.string().trim().min(1),
	workspaceId: z.string().trim().min(1).optional()
});

export const GET: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	const firestore = getFirebaseAdminFirestore();
	const snapshot = await firestore
		.collection('users')
		.doc(userId)
		.collection('agents')
		.orderBy('createdAt', 'desc')
		.limit(50)
		.get();

	const agents: SparkAgentState[] = [];
	for (const docSnap of snapshot.docs) {
		const parsed = SparkAgentStateSchema.safeParse({ id: docSnap.id, ...docSnap.data() });
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

	const firestore = getFirebaseAdminFirestore();
	const agentRef = firestore
		.collection('users')
		.doc(userId)
		.collection('agents')
		.doc(agentId);

	await agentRef.set({
		id: agentId,
		prompt: parsed.prompt,
		status: 'created',
		workspaceId,
		createdAt: now,
		updatedAt: now,
		statesTimeline: [{ state: 'created', timestamp: now }]
	});

	await firestore
		.collection('users')
		.doc(userId)
		.collection('workspace')
		.doc(workspaceId)
		.set(
			{
				id: workspaceId,
				agentId,
				createdAt: now,
				updatedAt: now
			},
			{ merge: true }
		);

	await createTask({
		type: 'runAgent',
		runAgent: { userId, agentId, workspaceId }
	});

	return json({ agentId, workspaceId }, { status: 201 });
};
