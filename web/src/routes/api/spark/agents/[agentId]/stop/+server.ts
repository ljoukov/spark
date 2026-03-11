import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore, setDoc } from '@ljoukov/firebase-admin-cloudflare/firestore';

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

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;
	const serviceAccountJson = requireServiceAccountJson();

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_agent_id', issues: parsedParams.error.issues }, { status: 400 });
	}
	const agentId = parsedParams.data.agentId;

	const documentPath = `users/${userId}/agents/${agentId}`;
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const agentSnap = await getDoc(doc(firestore, documentPath));
	if (!agentSnap.exists) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	await setDoc(
		doc(firestore, documentPath),
		{ stop_requested: true, updatedAt: new Date() },
		{ merge: true }
	);
	return json({ status: 'stop_requested' }, { status: 200 });
};
