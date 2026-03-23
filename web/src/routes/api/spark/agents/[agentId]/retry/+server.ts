import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { env } from '$env/dynamic/private';
import { createTask } from '@spark/llm';
import {
	SparkAgentStateSchema,
	SparkAgentWorkspaceFileSchema
} from '@spark/schemas';
import {
	buildWorkspaceFilesCollectionPath,
	resolveWorkspaceFilePathFromFirestoreDocument,
	upsertWorkspaceStorageLinkFileDoc,
	upsertWorkspaceTextFileDoc
} from '@spark/llm';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';

const paramsSchema = z.object({
	agentId: z.string().trim().min(1)
});

const NON_RETRYABLE_AGENT_FIELDS = new Set([
	'id',
	'prompt',
	'status',
	'workspaceId',
	'availableTools',
	'createdAt',
	'updatedAt',
	'statesTimeline',
	'stop_requested',
	'resultSummary',
	'error',
	'graderRunId'
]);

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

function buildRetryAgentMetadata(sourceData: Record<string, unknown>): Record<string, unknown> {
	const metadata: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(sourceData)) {
		if (NON_RETRYABLE_AGENT_FIELDS.has(key)) {
			continue;
		}
		metadata[key] = value;
	}
	return metadata;
}

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;
	const serviceAccountJson = requireServiceAccountJson();
	const tasksEnv = requireTasksEnv();

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_agent_id', issues: parsedParams.error.issues }, { status: 400 });
	}
	const sourceAgentId = parsedParams.data.agentId;

	const sourceDocPath = `users/${userId}/agents/${sourceAgentId}`;
	const sourceSnapshot = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: sourceDocPath
	});
	if (!sourceSnapshot.exists || !sourceSnapshot.data) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const sourceParsed = SparkAgentStateSchema.safeParse({
		id: sourceAgentId,
		...sourceSnapshot.data
	});
	if (!sourceParsed.success) {
		return json({ error: 'invalid_source_agent' }, { status: 500 });
	}
	const sourceAgent = sourceParsed.data;
	if (sourceAgent.status !== 'failed') {
		return json(
			{
				error: 'invalid_status',
				message: 'Only failed agent runs can be retried.'
			},
			{ status: 409 }
		);
	}

	const newAgentId = randomUUID();
	const newWorkspaceId = randomUUID();
	const now = new Date();
	const retryMetadata = buildRetryAgentMetadata(sourceSnapshot.data);

	await setFirestoreDocument({
		serviceAccountJson,
		documentPath: `users/${userId}/agents/${newAgentId}`,
		data: {
			id: newAgentId,
			prompt: sourceAgent.prompt,
			status: 'created',
			workspaceId: newWorkspaceId,
			createdAt: now,
			updatedAt: now,
			statesTimeline: [{ state: 'created', timestamp: now }],
			...retryMetadata
		}
	});

	await setFirestoreDocument({
		serviceAccountJson,
		documentPath: `users/${userId}/workspace/${newWorkspaceId}`,
		data: {
			id: newWorkspaceId,
			agentId: newAgentId,
			createdAt: now,
			updatedAt: now
		}
	});

	const sourceFiles = await listFirestoreDocuments({
		serviceAccountJson,
		collectionPath: buildWorkspaceFilesCollectionPath({
			userId,
			workspaceId: sourceAgent.workspaceId
		}),
		limit: 1000,
		orderBy: 'path asc'
	});
	let copiedFileCount = 0;
	for (const sourceFile of sourceFiles) {
		const data = sourceFile.data ?? {};
		const path = resolveWorkspaceFilePathFromFirestoreDocument({
			documentPath: sourceFile.documentPath,
			storedPath: data.path
		});
		if (path.length === 0) {
			continue;
		}
		const parsedSourceFile = SparkAgentWorkspaceFileSchema.safeParse({
			...data,
			path
		});
		if (!parsedSourceFile.success) {
			continue;
		}
		const sourceWorkspaceFile = parsedSourceFile.data;
		if (sourceWorkspaceFile.type === 'storage_link') {
			await upsertWorkspaceStorageLinkFileDoc({
				serviceAccountJson,
				userId,
				workspaceId: newWorkspaceId,
				filePath: sourceWorkspaceFile.path,
				storagePath: sourceWorkspaceFile.storagePath,
				contentType: sourceWorkspaceFile.contentType,
				sizeBytes: sourceWorkspaceFile.sizeBytes ?? 0,
				createdAt: sourceWorkspaceFile.createdAt,
				updatedAt: sourceWorkspaceFile.updatedAt
			});
		} else {
			await upsertWorkspaceTextFileDoc({
				serviceAccountJson,
				userId,
				workspaceId: newWorkspaceId,
				filePath: sourceWorkspaceFile.path,
				content: sourceWorkspaceFile.content,
				contentType: sourceWorkspaceFile.contentType,
				createdAt: sourceWorkspaceFile.createdAt,
				updatedAt: sourceWorkspaceFile.updatedAt
			});
		}
		copiedFileCount += 1;
	}

	await createTask(
		{
			type: 'runAgent',
			runAgent: { userId, agentId: newAgentId, workspaceId: newWorkspaceId }
		},
		{
			serviceUrl: tasksEnv.serviceUrl,
			apiKey: tasksEnv.apiKey,
			serviceAccountJson
		}
	);

	return json(
		{
			status: 'started',
			agentId: newAgentId,
			workspaceId: newWorkspaceId,
			retryOfAgentId: sourceAgentId,
			copiedFileCount
		},
		{ status: 201 }
	);
};
