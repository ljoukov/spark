import { QuizDefinitionSchema, type QuizDefinition } from '@spark/schemas';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore, setDoc } from '@ljoukov/firebase-admin-cloudflare/firestore';
import { z } from 'zod';
import { env } from '$env/dynamic/private';

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
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	const snapshot = await getDoc(doc(firestore, documentPath));
	if (!snapshot.exists) {
		return null;
	}
	return QuizDefinitionSchema.parse({ id: quizIdSchema.parse(quizId), ...snapshot.data() });
}

export async function saveUserQuiz(
	userId: string,
	sessionId: string,
	quiz: QuizDefinition
): Promise<void> {
	const parsed = QuizDefinitionSchema.parse(quiz);
	const documentPath = resolveQuizDocPath(userId, sessionId, parsed.id);
	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(doc(firestore, documentPath), parsed as unknown as Record<string, unknown>);
}
