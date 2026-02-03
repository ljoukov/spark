import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getFirebaseAdminFirestore } from '@spark/llm';
import {
	SparkAgentStateSchema,
	SparkAgentWorkspaceFileSchema,
	type SparkAgentState,
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
			path: typeof data.path === 'string' && data.path.trim().length > 0 ? data.path.trim() : decodeFileId(fileDoc.id)
		};
		const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
		if (!parsed.success) {
			continue;
		}
		files.push(parsed.data);
	}

	return json({ agent, files }, { status: 200 });
};
