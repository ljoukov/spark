import {
	PlanItemStateSchema,
	SessionStateSchema,
	type PlanItemState,
	type SessionState
} from '@spark/schemas';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument, patchFirestoreDocument } from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');
const planItemIdSchema = z.string().trim().min(1, 'planItemId is required');

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function resolveSessionStateDocPath(userId: string, sessionId: string): string {
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	return `spark/${uid}/state/${sid}`;
}

export function createEmptySessionState(sessionId: string): SessionState {
	return {
		sessionId: sessionIdSchema.parse(sessionId),
		items: {},
		lastUpdatedAt: new Date(0)
	};
}

export async function getSessionState(userId: string, sessionId: string): Promise<SessionState> {
	const documentPath = resolveSessionStateDocPath(userId, sessionId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath
	});
	if (!snapshot.exists || !snapshot.data) {
		return createEmptySessionState(sessionId);
	}

	const raw = snapshot.data ?? {};
	return SessionStateSchema.parse({
		sessionId: sessionIdSchema.parse(sessionId),
		items: raw.items ?? {},
		lastUpdatedAt: raw.lastUpdatedAt ?? new Date(0)
	});
}

export async function savePlanItemState(
	userId: string,
	sessionId: string,
	planItemId: string,
	state: PlanItemState
): Promise<void> {
	const documentPath = resolveSessionStateDocPath(userId, sessionId);
	const pid = planItemIdSchema.parse(planItemId);
	const sanitized = PlanItemStateSchema.parse(state);

	const serviceAccountJson = requireServiceAccountJson();

	// Ensure the document exists, then patch nested field paths without clobbering the whole items map.
	await patchFirestoreDocument({
		serviceAccountJson,
		documentPath,
		updates: { sessionId: sessionIdSchema.parse(sessionId) }
	});

	await patchFirestoreDocument({
		serviceAccountJson,
		documentPath,
		updates: {
			lastUpdatedAt: new Date(),
			[`items.${pid}`]: sanitized
		}
	});
}
