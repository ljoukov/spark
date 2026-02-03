import { QuizDefinitionSchema, type QuizDefinition } from '@spark/schemas';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument, setFirestoreDocument } from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const quizIdSchema = z.string().trim().min(1, 'quizId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function resolveQuizDocPath(userId: string, sessionId: string, quizId: string): string {
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	const qid = quizIdSchema.parse(quizId);
	return `spark/${uid}/sessions/${sid}/quiz/${qid}`;
}

export async function getUserQuiz(
	userId: string,
	sessionId: string,
	quizId: string
): Promise<QuizDefinition | null> {
	const documentPath = resolveQuizDocPath(userId, sessionId, quizId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	return QuizDefinitionSchema.parse({ id: quizIdSchema.parse(quizId), ...snapshot.data });
}

export async function saveUserQuiz(
	userId: string,
	sessionId: string,
	quiz: QuizDefinition
): Promise<void> {
	const parsed = QuizDefinitionSchema.parse(quiz);
	const documentPath = resolveQuizDocPath(userId, sessionId, parsed.id);
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath,
		data: parsed as unknown as Record<string, unknown>
	});
}
