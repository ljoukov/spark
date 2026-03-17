import { json, type RequestHandler } from '@sveltejs/kit';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore } from '@ljoukov/firebase-admin-cloudflare/firestore';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { listSparkCloudLogs } from '$lib/server/gcp/logging';
import { SparkAgentStateSchema } from '@spark/schemas';

const paramsSchema = z.object({
	agentId: z.string().trim().min(1)
});

const querySchema = z
	.object({
		limit: z.string().trim().optional(),
		lookbackHours: z.string().trim().optional()
	})
	.transform(({ limit, lookbackHours }) => ({
		limit:
			limit && limit.length > 0
				? z.coerce.number().int().min(1).max(200).parse(limit)
				: 120,
		lookbackHours:
			lookbackHours && lookbackHours.length > 0
				? z.coerce.number().int().min(1).max(168).parse(lookbackHours)
				: 48
	}));

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

export const GET: RequestHandler = async ({ request, params, url }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_agent_id', issues: parsedParams.error.issues }, { status: 400 });
	}

	const parsedQuery = querySchema.safeParse({
		limit: url.searchParams.get('limit') ?? undefined,
		lookbackHours: url.searchParams.get('lookbackHours') ?? undefined
	});
	if (!parsedQuery.success) {
		return json({ error: 'invalid_query', issues: parsedQuery.error.issues }, { status: 400 });
	}

	const userId = authResult.user.uid;
	const agentId = parsedParams.data.agentId;
	const serviceAccountJson = requireServiceAccountJson();
	const documentPath = `users/${userId}/agents/${agentId}`;
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const agentSnapshot = await getDoc(doc(firestore, documentPath));
	if (!agentSnapshot.exists) {
		return json({ error: 'not_found' }, { status: 404 });
	}
	const agentData = agentSnapshot.data();
	if (!agentData) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const parsedAgent = SparkAgentStateSchema.safeParse({
		id: agentId,
		...agentData
	});
	if (!parsedAgent.success) {
		return json({ error: 'invalid_agent_payload' }, { status: 500 });
	}

	const logs = await listSparkCloudLogs({
		userId,
		agentId,
		workspaceId: parsedAgent.data.workspaceId,
		limit: parsedQuery.data.limit,
		lookbackHours: parsedQuery.data.lookbackHours
	});

	return json({
		agentId,
		workspaceId: parsedAgent.data.workspaceId,
		logs
	});
};
