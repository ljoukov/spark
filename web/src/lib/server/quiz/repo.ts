import { QuizDefinitionSchema, type QuizDefinition } from '@spark/schemas';
import { getFirebaseAdminFirestore } from '@spark/llm';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const quizIdSchema = z.string().trim().min(1, 'quizId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');

function resolveQuizDoc(userId: string, sessionId: string, quizId: string) {
	const firestore = getFirebaseAdminFirestore();
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	const qid = quizIdSchema.parse(quizId);
	return firestore
		.collection('spark')
		.doc(uid)
		.collection('sessions')
		.doc(sid)
		.collection('quiz')
		.doc(qid);
}

export async function getUserQuiz(
	userId: string,
	sessionId: string,
	quizId: string
): Promise<QuizDefinition | null> {
	const snapshot = await resolveQuizDoc(userId, sessionId, quizId).get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data();
	if (!raw) {
		return null;
	}
	return QuizDefinitionSchema.parse({ id: snapshot.id, ...raw });
}

export async function saveUserQuiz(
	userId: string,
	sessionId: string,
	quiz: QuizDefinition
): Promise<void> {
	const parsed = QuizDefinitionSchema.parse(quiz);
	await resolveQuizDoc(userId, sessionId, parsed.id).set(parsed);
}
