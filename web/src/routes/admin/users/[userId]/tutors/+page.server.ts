import {
	deleteFirestoreDocument,
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import { getGraderRun } from '$lib/server/grader/repo';
import {
	listTutorSessions,
	resolveTutorSessionDocPath
} from '$lib/server/tutorSessions/repo';
import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required')
});

const sessionIdSchema = z.object({
	sessionId: z.string().trim().min(1, 'Session ID is required')
});

const TUTOR_SESSION_LIST_LIMIT = 100;

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function toIso(value: Date): string {
	return value.toISOString();
}

async function deleteWorkspaceTree(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
}): Promise<void> {
	const fileDocs = await listFirestoreDocuments({
		serviceAccountJson: options.serviceAccountJson,
		collectionPath: `users/${options.userId}/workspace/${options.workspaceId}/files`,
		limit: 500
	});

	for (const doc of fileDocs) {
		await deleteFirestoreDocument({
			serviceAccountJson: options.serviceAccountJson,
			documentPath: doc.documentPath
		});
	}

	await deleteFirestoreDocument({
		serviceAccountJson: options.serviceAccountJson,
		documentPath: `users/${options.userId}/workspace/${options.workspaceId}`
	});
}

async function clearCurrentSessionIfDeleted(options: {
	serviceAccountJson: string;
	userId: string;
	sessionId: string;
}): Promise<void> {
	const userDocPath = `spark/${options.userId}`;
	const userDoc = await getFirestoreDocument({
		serviceAccountJson: options.serviceAccountJson,
		documentPath: userDocPath
	});
	if (!userDoc.exists || userDoc.data?.currentSessionId !== options.sessionId) {
		return;
	}

	await patchFirestoreDocument({
		serviceAccountJson: options.serviceAccountJson,
		documentPath: userDocPath,
		updates: { currentSessionId: null }
	});
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);
	const sessions = await listTutorSessions(userId, TUTOR_SESSION_LIST_LIMIT);
	const graderRunIds = [...new Set(sessions.map((session) => session.source.runId))];
	const graderRunsById = new Map(
		(
			await Promise.all(
				graderRunIds.map(async (runId) => {
					const run = await getGraderRun(userId, runId);
					return [runId, run] as const;
				})
			)
		).map(([runId, run]) => [runId, run?.agentId ?? null] as const)
	);

	const serializedSessions = sessions.map((session) => {
		const source = {
			kind: session.source.kind,
			runId: session.source.runId,
			sheetTitle: session.source.sheetTitle,
			awardedMarks:
				typeof session.source.awardedMarks === 'number' ? session.source.awardedMarks : null,
			maxMarks: typeof session.source.maxMarks === 'number' ? session.source.maxMarks : null
		};
		const raw = {
			id: session.id,
			workspaceId: session.workspaceId,
			status: session.status,
			title: session.title,
			preview: session.preview ?? null,
			focusLabel: session.focusLabel ?? null,
			activeTurnAgentId: session.activeTurnAgentId ?? null,
			graderAgentId: graderRunsById.get(session.source.runId) ?? null,
			source,
			createdAt: toIso(session.createdAt),
			updatedAt: toIso(session.updatedAt),
			completedAt: session.completedAt ? toIso(session.completedAt) : null,
			error: session.error ?? null
		};

		return {
			...raw,
			rawJson: JSON.stringify(raw, null, 2)
		};
	});

	return {
		sessions: serializedSessions
	};
};

export const actions: Actions = {
	deleteSession: async ({ params, request }) => {
		const { userId } = paramsSchema.parse(params);
		const formData = await request.formData();
		const parsed = sessionIdSchema.safeParse({
			sessionId: typeof formData.get('sessionId') === 'string' ? formData.get('sessionId') : ''
		});
		if (!parsed.success) {
			const [issue] = parsed.error.issues;
			return fail(400, { error: issue?.message ?? 'Session ID is required.' });
		}

		const sessionId = parsed.data.sessionId;
		const serviceAccountJson = requireServiceAccountJson();
		const sessions = await listTutorSessions(userId, TUTOR_SESSION_LIST_LIMIT);
		const session = sessions.find((entry) => entry.id === sessionId) ?? null;
		if (!session) {
			return fail(404, { error: `Sheet interaction ${sessionId} was not found.` });
		}

		try {
			if (session.activeTurnAgentId) {
				await deleteFirestoreDocument({
					serviceAccountJson,
					documentPath: `users/${userId}/agents/${session.activeTurnAgentId}`
				});
			}
			await deleteWorkspaceTree({
				serviceAccountJson,
				userId,
				workspaceId: session.workspaceId
			});
			await deleteFirestoreDocument({
				serviceAccountJson,
				documentPath: resolveTutorSessionDocPath(userId, sessionId)
			});
			await clearCurrentSessionIfDeleted({
				serviceAccountJson,
				userId,
				sessionId
			});

			return { success: { message: `Deleted sheet interaction ${sessionId}.` } as const };
		} catch (error) {
			console.error('Failed to delete sheet interaction', { userId, sessionId, error });
			return fail(500, { error: 'Failed to delete sheet interaction. Please try again.' });
		}
	}
};
