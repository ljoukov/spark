import {
	LessonProposalSchema,
	SessionSchema,
	type LessonProposal,
	type Session,
	type SessionStatus,
	UserDocSchema
} from '@spark/schemas';
import { getFirebaseAdminFirestore, getFirebaseAdminFirestoreModule } from '@spark/llm';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');

const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');

const proposalsArraySchema = z.array(LessonProposalSchema).min(1);

const { FieldValue } = getFirebaseAdminFirestoreModule();

function resolveUserDocRef(userId: string) {
	const firestore = getFirebaseAdminFirestore();
	const id = userIdSchema.parse(userId);
	return firestore.collection('spark').doc(id);
}

function resolveSessionDocRef(userId: string, sessionId: string) {
	const docRef = resolveUserDocRef(userId);
	const id = sessionIdSchema.parse(sessionId);
	return docRef.collection('sessions').doc(id);
}

export async function saveSession(userId: string, session: Session): Promise<void> {
	const validated = SessionSchema.parse(session);
	const docRef = resolveSessionDocRef(userId, validated.id);
	await docRef.set(validated);
}

export async function getSession(userId: string, sessionId: string): Promise<Session | null> {
	const docRef = resolveSessionDocRef(userId, sessionId);
	const snapshot = await docRef.get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data();
	if (!raw) {
		return null;
	}
	return SessionSchema.parse({ id: snapshot.id, ...raw });
}

export async function listSessions(userId: string, limit = 10): Promise<Session[]> {
	const docRef = resolveUserDocRef(userId);
	const snapshot = await docRef
		.collection('sessions')
		.orderBy('createdAt', 'desc')
		.limit(limit)
		.get();

	const sessions: Session[] = [];
	for (const doc of snapshot.docs) {
		const data = doc.data();
		if (!data) {
			continue;
		}
		try {
			sessions.push(SessionSchema.parse({ id: doc.id, ...data }));
		} catch (error) {
			console.error('Unable to parse session document', doc.id, error);
		}
	}
	return sessions;
}

export async function setCurrentSessionId(userId: string, sessionId: string): Promise<void> {
	const docRef = resolveUserDocRef(userId);
	const id = sessionIdSchema.parse(sessionId);
	await docRef.set({ currentSessionId: id }, { merge: true });
}

export async function getCurrentSessionId(userId: string): Promise<string | null> {
	const docRef = resolveUserDocRef(userId);
	const snapshot = await docRef.get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data() ?? {};
	const parsed = UserDocSchema.parse(raw);
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
	const docRef = resolveSessionDocRef(userId, sessionId);
	await docRef.set(
		{
			nextLessonProposals: validatedProposals,
			nextLessonProposalsGeneratedAt: FieldValue.serverTimestamp()
		},
		{ merge: true }
	);
}

export async function updateSessionStatus(
	userId: string,
	sessionId: string,
	status: SessionStatus
): Promise<void> {
	const docRef = resolveSessionDocRef(userId, sessionId);
	await docRef.set({ status }, { merge: true });
}
