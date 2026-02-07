import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { buildSparkAgentDownloadZip } from '$lib/server/sparkAgents/downloadZip';
import { isUserAdmin } from '$lib/server/utils/admin';

const paramsSchema = z.object({
	userId: z.string().trim().min(1),
	agentId: z.string().trim().min(1)
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

export const GET: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let canAccess = false;
	try {
		canAccess = isUserAdmin({ userId: authResult.user.uid });
	} catch {
		canAccess = false;
	}

	if (!canAccess) {
		return json({ error: 'forbidden', message: 'Admin access required' }, { status: 403 });
	}

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_params', issues: parsedParams.error.issues }, { status: 400 });
	}

	const serviceAccountJson = requireServiceAccountJson();
	const { userId, agentId } = parsedParams.data;

	const zipResult = await buildSparkAgentDownloadZip({ serviceAccountJson, userId, agentId });
	if (!zipResult.ok) {
		return json({ error: zipResult.error }, { status: zipResult.status });
	}

	return new Response(zipResult.body, {
		status: 200,
		headers: {
			'content-type': 'application/zip',
			'cache-control': 'no-store',
			'content-disposition': `attachment; filename="${zipResult.filename}"`
		}
	});
};

