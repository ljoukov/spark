import {
	PlanItemStateSchema,
	SessionStateSchema,
	type PlanItemState,
	type SessionState
} from '@spark/schemas';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore, setDoc } from '@ljoukov/firebase-admin-cloudflare/firestore';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { buildFirestoreMergeData } from '@spark/llm/utils/gcp/firestoreData';

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
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const snapshot = await getDoc(doc(firestore, documentPath));
	if (!snapshot.exists) {
		return createEmptySessionState(sessionId);
	}

	const raw = snapshot.data() ?? {};
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
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, documentPath),
		buildFirestoreMergeData({
			updates: {
				sessionId: sessionIdSchema.parse(sessionId),
				lastUpdatedAt: new Date(),
				[`items.${pid}`]: sanitized
			}
		}),
		{ merge: true }
	);
}
