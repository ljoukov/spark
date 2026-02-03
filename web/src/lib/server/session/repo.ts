import {
	LessonProposalSchema,
	SessionSchema,
	type LessonProposal,
	type Session,
	type SessionStatus,
	UserDocSchema
} from '@spark/schemas';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');

const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');

const proposalsArraySchema = z.array(LessonProposalSchema).min(1);

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

function resolveUserDocPath(userId: string): string {
	const id = userIdSchema.parse(userId);
	return `spark/${id}`;
}

export async function saveSession(userId: string, session: Session): Promise<void> {
	const validated = SessionSchema.parse(session);
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `${resolveUserDocPath(userId)}/sessions/${validated.id}`,
		data: validated as unknown as Record<string, unknown>
	});
}

export async function getSession(userId: string, sessionId: string): Promise<Session | null> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `${resolveUserDocPath(userId)}/sessions/${sessionIdSchema.parse(sessionId)}`
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	return SessionSchema.parse({ id: sessionIdSchema.parse(sessionId), ...snapshot.data });
}

export async function listSessions(userId: string, limit = 10): Promise<Session[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `${resolveUserDocPath(userId)}/sessions`,
		limit,
		orderBy: 'createdAt desc'
	});

	const sessions: Session[] = [];
	for (const doc of docs) {
		try {
			sessions.push(SessionSchema.parse({ id: docIdFromPath(doc.documentPath), ...doc.data }));
		} catch (error) {
			console.error('Unable to parse session document', doc.documentPath, error);
		}
	}
	return sessions;
}

export async function setCurrentSessionId(userId: string, sessionId: string): Promise<void> {
	await patchFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveUserDocPath(userId),
		updates: { currentSessionId: sessionIdSchema.parse(sessionId) }
	});
}

export async function getCurrentSessionId(userId: string): Promise<string | null> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveUserDocPath(userId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const parsed = UserDocSchema.parse(snapshot.data ?? {});
	return parsed.currentSessionId;
}

export async function getOrSelectCurrentSession(userId: string): Promise<Session> {
	const currentId = await getCurrentSessionId(userId);
	if (currentId) {
		const session = await getSession(userId, currentId);
		if (session) {
			return session;
		}
	}

	const [latest] = await listSessions(userId, 1);
	if (!latest) {
		throw new Error('No sessions found for user');
	}

	await setCurrentSessionId(userId, latest.id).catch((error) => {
		console.warn('Unable to update currentSessionId', error);
	});

	return latest;
}

export async function saveNextLessonProposals(
	userId: string,
	sessionId: string,
	proposals: LessonProposal[]
): Promise<void> {
	const validatedProposals = proposalsArraySchema.parse(proposals);
	await patchFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `${resolveUserDocPath(userId)}/sessions/${sessionIdSchema.parse(sessionId)}`,
		updates: {
			nextLessonProposals: validatedProposals,
			nextLessonProposalsGeneratedAt: new Date()
		}
	});
}

export async function updateSessionStatus(
	userId: string,
	sessionId: string,
	status: SessionStatus
): Promise<void> {
	await patchFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `${resolveUserDocPath(userId)}/sessions/${sessionIdSchema.parse(sessionId)}`,
		updates: { status }
	});
}
