import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getFirebaseAdminFirestore } from '@spark/llm';

const paramsSchema = z.object({
	agentId: z.string().trim().min(1)
});

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_agent_id', issues: parsedParams.error.issues }, { status: 400 });
	}
	const agentId = parsedParams.data.agentId;

	const firestore = getFirebaseAdminFirestore();
	const agentRef = firestore.collection('users').doc(userId).collection('agents').doc(agentId);
	const agentSnap = await agentRef.get();
	if (!agentSnap.exists) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	await agentRef.set({ stop_requested: true, updatedAt: new Date() }, { merge: true });
	return json({ status: 'stop_requested' }, { status: 200 });
};

