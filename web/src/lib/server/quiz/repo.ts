import { QuizDefinitionSchema, type QuizDefinition } from '@spark/schemas';
import { getFirebaseAdminFirestore } from '../utils/firebaseAdmin';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const quizIdSchema = z.string().trim().min(1, 'quizId is required');

function resolveQuizDoc(userId: string, quizId: string) {
	const firestore = getFirebaseAdminFirestore();
	const uid = userIdSchema.parse(userId);
	const qid = quizIdSchema.parse(quizId);
	return firestore.collection('spark').doc(uid).collection('quiz').doc(qid);
}

export async function getUserQuiz(userId: string, quizId: string): Promise<QuizDefinition | null> {
	const snapshot = await resolveQuizDoc(userId, quizId).get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data();
	if (!raw) {
		return null;
	}
	return QuizDefinitionSchema.parse({ id: snapshot.id, ...raw });
}

export async function saveUserQuiz(userId: string, quiz: QuizDefinition): Promise<void> {
	const parsed = QuizDefinitionSchema.parse(quiz);
	await resolveQuizDoc(userId, parsed.id).set(parsed);
}
