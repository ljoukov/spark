import { env } from '$env/dynamic/private';
import { SparkTutorSessionSchema, type SparkTutorSession } from '@spark/schemas';
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
import { buildFirestoreMergeData } from '@spark/llm/utils/gcp/firestoreData';
import { z } from 'zod';

const trimmedString = z.string().trim().min(1);

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

export function resolveTutorSessionDocPath(userId: string, sessionId: string): string {
	return `spark/${trimmedString.parse(userId)}/tutorSessions/${trimmedString.parse(sessionId)}`;
}

export function resolveTutorSessionsCollectionPath(userId: string): string {
	return `spark/${trimmedString.parse(userId)}/tutorSessions`;
}

export async function createTutorSession(
	userId: string,
	session: SparkTutorSession
): Promise<void> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, resolveTutorSessionDocPath(userId, session.id)),
		SparkTutorSessionSchema.parse(session) as unknown as Record<string, unknown>
	);
}

export async function patchTutorSession(
	userId: string,
	sessionId: string,
	updates: Record<string, unknown>
): Promise<void> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(
		doc(firestore, resolveTutorSessionDocPath(userId, sessionId)),
		buildFirestoreMergeData({ updates }),
		{ merge: true }
	);
}

export async function getTutorSession(
	userId: string,
	sessionId: string
): Promise<SparkTutorSession | null> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const snapshot = await getDoc(doc(firestore, resolveTutorSessionDocPath(userId, sessionId)));
	if (!snapshot.exists) {
		return null;
	}
	const parsed = SparkTutorSessionSchema.safeParse({
		id: trimmedString.parse(sessionId),
		...snapshot.data()
	});
	return parsed.success ? parsed.data : null;
}

export async function listTutorSessions(userId: string, limit = 100): Promise<SparkTutorSession[]> {
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const docs = await getDocs(
		query(
			collection(firestore, resolveTutorSessionsCollectionPath(userId)),
			orderBy('updatedAt', 'desc'),
			limitQuery(limit)
		)
	);
	const sessions: SparkTutorSession[] = [];
	for (const sessionDoc of docs.docs) {
		const parsed = SparkTutorSessionSchema.safeParse({
			id: docIdFromPath(sessionDoc.ref.path),
			...sessionDoc.data()
		});
		if (parsed.success) {
			sessions.push(parsed.data);
		}
	}
	return sessions;
}

export async function findTutorSessionForGraderProblem(options: {
	userId: string;
	runId: string;
	problemId: string;
}): Promise<SparkTutorSession | null> {
	const sessions = await listTutorSessions(options.userId, 200);
	return (
		sessions.find(
			(session) =>
				session.source.kind === 'grader-problem' &&
				session.source.runId === options.runId &&
				session.source.problemId === options.problemId
		) ?? null
	);
}
