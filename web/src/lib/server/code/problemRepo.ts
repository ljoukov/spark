import { CodeProblemSchema, type CodeProblem } from '@spark/schemas';
import { getFirebaseAdminFirestore } from '../utils/firebaseAdmin';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const problemIdSchema = z.string().trim().min(1, 'problemId is required');

function resolveProblemDoc(userId: string, problemId: string) {
	const firestore = getFirebaseAdminFirestore();
	const uid = userIdSchema.parse(userId);
	const pid = problemIdSchema.parse(problemId);
	return firestore.collection('spark').doc(uid).collection('code').doc(pid);
}

export async function getUserProblem(
	userId: string,
	problemId: string
): Promise<CodeProblem | null> {
	const snapshot = await resolveProblemDoc(userId, problemId).get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data();
	if (!raw) {
		return null;
	}
	return CodeProblemSchema.parse({ slug: snapshot.id, ...raw });
}

export async function saveUserProblem(userId: string, problem: CodeProblem): Promise<void> {
	const parsed = CodeProblemSchema.parse(problem);
	await resolveProblemDoc(userId, parsed.slug).set(parsed);
}
