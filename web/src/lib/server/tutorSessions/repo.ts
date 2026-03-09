import { env } from '$env/dynamic/private';
import { SparkTutorSessionSchema, type SparkTutorSession } from '@spark/schemas';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
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
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveTutorSessionDocPath(userId, session.id),
		data: SparkTutorSessionSchema.parse(session) as unknown as Record<string, unknown>
	});
}

export async function patchTutorSession(
	userId: string,
	sessionId: string,
	updates: Record<string, unknown>
): Promise<void> {
	await patchFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveTutorSessionDocPath(userId, sessionId),
		updates
	});
}

export async function getTutorSession(
	userId: string,
	sessionId: string
): Promise<SparkTutorSession | null> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveTutorSessionDocPath(userId, sessionId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const parsed = SparkTutorSessionSchema.safeParse({
		id: trimmedString.parse(sessionId),
		...snapshot.data
	});
	return parsed.success ? parsed.data : null;
}

export async function listTutorSessions(userId: string, limit = 100): Promise<SparkTutorSession[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: resolveTutorSessionsCollectionPath(userId),
		limit,
		orderBy: 'updatedAt desc'
	});
	const sessions: SparkTutorSession[] = [];
	for (const doc of docs) {
		const parsed = SparkTutorSessionSchema.safeParse({
			id: docIdFromPath(doc.documentPath),
			...doc.data
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
