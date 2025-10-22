import {
	PlanItemStateSchema,
	SessionStateSchema,
	type PlanItemState,
	type SessionState
} from '@spark/schemas';
import { getFirebaseAdminFirestore } from '@spark/llm';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');
const planItemIdSchema = z.string().trim().min(1, 'planItemId is required');

function resolveSessionStateDocRef(userId: string, sessionId: string) {
	const firestore = getFirebaseAdminFirestore();
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	return firestore.collection('spark').doc(uid).collection('state').doc(sid);
}

export function createEmptySessionState(sessionId: string): SessionState {
	return {
		sessionId: sessionIdSchema.parse(sessionId),
		items: {},
		lastUpdatedAt: new Date(0)
	};
}

export async function getSessionState(userId: string, sessionId: string): Promise<SessionState> {
	const docRef = resolveSessionStateDocRef(userId, sessionId);
	const snapshot = await docRef.get();
	if (!snapshot.exists) {
		return createEmptySessionState(sessionId);
	}

	const raw = snapshot.data() ?? {};
	return SessionStateSchema.parse({
		sessionId: snapshot.id,
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
	const docRef = resolveSessionStateDocRef(userId, sessionId);
	const pid = planItemIdSchema.parse(planItemId);
	const sanitized = PlanItemStateSchema.parse(state);
	await docRef.set(
		{
			sessionId,
			lastUpdatedAt: new Date(),
			[`items.${pid}`]: sanitized
		},
		{ merge: true }
	);
}
