import {
	LessonProposalSchema,
	SessionSchema,
	type LessonProposal,
	type Session,
	type SessionStatus,
	UserDocSchema
} from '@spark/schemas';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import {
	collection,
	doc,
	getDoc,
	getDocs,
	getFirestore,
	limit as limitQuery,
	orderBy,
	query,
	setDoc
} from '@ljoukov/firebase-admin-cloudflare/firestore';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { buildFirestoreMergeData } from '@spark/llm/utils/gcp/firestoreData';

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
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, `${resolveUserDocPath(userId)}/sessions/${validated.id}`),
		validated as unknown as Record<string, unknown>
	);
}

export async function getSession(userId: string, sessionId: string): Promise<Session | null> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const snapshot = await getDoc(
		doc(firestore, `${resolveUserDocPath(userId)}/sessions/${sessionIdSchema.parse(sessionId)}`)
	);
	if (!snapshot.exists) {
		return null;
	}
	return SessionSchema.parse({ id: sessionIdSchema.parse(sessionId), ...snapshot.data() });
}

export async function listSessions(userId: string, limit = 10): Promise<Session[]> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const docs = await getDocs(
		query(
			collection(firestore, `${resolveUserDocPath(userId)}/sessions`),
			orderBy('createdAt', 'desc'),
			limitQuery(limit)
		)
	);

	const sessions: Session[] = [];
	for (const sessionDoc of docs.docs) {
		try {
			sessions.push(
				SessionSchema.parse({
					id: docIdFromPath(sessionDoc.ref.path),
					...sessionDoc.data()
				})
			);
		} catch (error) {
			console.error('Unable to parse session document', sessionDoc.ref.path, error);
		}
	}
	return sessions;
}

export async function setCurrentSessionId(userId: string, sessionId: string): Promise<void> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, resolveUserDocPath(userId)),
		buildFirestoreMergeData({
			updates: { currentSessionId: sessionIdSchema.parse(sessionId) }
		}),
		{ merge: true }
	);
}

export async function getCurrentSessionId(userId: string): Promise<string | null> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const snapshot = await getDoc(doc(firestore, resolveUserDocPath(userId)));
	if (!snapshot.exists) {
		return null;
	}
	const parsed = UserDocSchema.parse(snapshot.data() ?? {});
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
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, `${resolveUserDocPath(userId)}/sessions/${sessionIdSchema.parse(sessionId)}`),
		buildFirestoreMergeData({
			updates: {
				nextLessonProposals: validatedProposals,
				nextLessonProposalsGeneratedAt: new Date()
			}
		}),
		{ merge: true }
	);
}

export async function updateSessionStatus(
	userId: string,
	sessionId: string,
	status: SessionStatus
): Promise<void> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, `${resolveUserDocPath(userId)}/sessions/${sessionIdSchema.parse(sessionId)}`),
		buildFirestoreMergeData({ updates: { status } }),
		{ merge: true }
	);
}
