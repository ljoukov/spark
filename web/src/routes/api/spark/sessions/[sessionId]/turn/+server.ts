import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getTutorSession, patchTutorSession } from '$lib/server/tutorSessions/repo';
import {
	createTutorTurnAgentRun,
	requireTutorServiceAccountJson
} from '$lib/server/tutorSessions/service';
import {
	TUTOR_HISTORY_TURNS_PATH,
	TUTOR_STATE_COMPOSER_PATH,
	TUTOR_STATE_SESSION_PATH,
	TUTOR_UI_INLINE_FEEDBACK_PATH,
	appendTutorHistoryEntry,
	buildTutorComposerState,
	buildTutorScreenState,
	readTutorWorkspaceTextFile,
	writeTutorWorkspaceTextFile
} from '$lib/server/tutorSessions/workspace';
import { SparkTutorConfidenceSchema, SparkTutorHintLevelSchema } from '@spark/schemas';

const paramsSchema = z.object({
	sessionId: z.string().trim().min(1)
});

const requestSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('reply'),
		text: z.string().trim().min(1),
		confidence: SparkTutorConfidenceSchema.optional()
	}),
	z.object({
		action: z.literal('hint'),
		hintLevel: SparkTutorHintLevelSchema
	})
]);

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsedParams: z.infer<typeof paramsSchema>;
	let parsedBody: z.infer<typeof requestSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
		parsedBody = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	const session = await getTutorSession(userId, parsedParams.sessionId);
	if (!session) {
		return json({ error: 'session_not_found' }, { status: 404 });
	}
	if (session.status === 'completed') {
		return json({ error: 'session_completed' }, { status: 409 });
	}

	const now = new Date();
	const agentId = randomUUID();
	const serviceAccountJson = requireTutorServiceAccountJson();
	const existingHistory = await readTutorWorkspaceTextFile({
		serviceAccountJson,
		userId,
		workspaceId: session.workspaceId,
		filePath: TUTOR_HISTORY_TURNS_PATH
	});

	const historyText =
		parsedBody.action === 'reply'
			? parsedBody.text
			: `Student requested a ${parsedBody.hintLevel} hint.`;
	const nextHistory = appendTutorHistoryEntry(existingHistory, {
		role: 'student',
		kind: parsedBody.action === 'reply' ? 'reply' : 'hint_request',
		text: historyText,
		...(parsedBody.action === 'reply' && parsedBody.confidence
			? { confidence: parsedBody.confidence }
			: {}),
		...(parsedBody.action === 'hint' ? { hintLevel: parsedBody.hintLevel } : {}),
		createdAt: now.toISOString()
	});

	const nextSession = {
		...session,
		status: 'responding' as const,
		activeTurnAgentId: agentId,
		updatedAt: now
	};

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_HISTORY_TURNS_PATH,
			content: nextHistory,
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_UI_INLINE_FEEDBACK_PATH,
			content: '',
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_SESSION_PATH,
			content: `${JSON.stringify(
				buildTutorScreenState({
					session: nextSession,
					draftRevision: session.latestDraftRevision,
					focusLabel: session.focusLabel ?? null
				}),
				null,
				2
			)}\n`,
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_COMPOSER_PATH,
			content: `${JSON.stringify(
				buildTutorComposerState({
					placeholder: 'Spark is thinking...',
					disabled: true
				}),
				null,
				2
			)}\n`,
			now
		}),
		patchTutorSession(userId, session.id, {
			status: 'responding',
			activeTurnAgentId: agentId,
			updatedAt: now
		})
	]);

	await createTutorTurnAgentRun({
		userId,
		agentId,
		workspaceId: session.workspaceId,
		sessionId: session.id,
		prompt:
			parsedBody.action === 'reply'
				? `Continue the tutor session after a student reply on ${session.title}.`
				: `Continue the tutor session with a ${parsedBody.hintLevel} hint on ${session.title}.`,
		title: session.title,
		action: parsedBody.action,
		now,
		...(parsedBody.action === 'reply'
			? {
					studentText: parsedBody.text,
					...(parsedBody.confidence ? { confidence: parsedBody.confidence } : {})
				}
			: {
					hintLevel: parsedBody.hintLevel
				})
	});

	return json({ status: 'scheduled', agentId }, { status: 202 });
};
