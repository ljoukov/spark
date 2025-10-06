import { CodeProblemSchema, type CodeProblem } from '@spark/schemas';
import { getFirebaseAdminFirestore } from '../utils/firebaseAdmin';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const problemIdSchema = z.string().trim().min(1, 'problemId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');

function resolveProblemDoc(userId: string, sessionId: string, problemId: string) {
	const firestore = getFirebaseAdminFirestore();
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	const pid = problemIdSchema.parse(problemId);
	return firestore
		.collection('spark')
		.doc(uid)
		.collection('sessions')
		.doc(sid)
		.collection('code')
		.doc(pid);
}

export async function getUserProblem(
	userId: string,
	sessionId: string,
	problemId: string
): Promise<CodeProblem | null> {
	const snapshot = await resolveProblemDoc(userId, sessionId, problemId).get();
	if (!snapshot.exists) {
		return null;
	}
	const raw = snapshot.data();
	if (!raw) {
		return null;
	}
	return CodeProblemSchema.parse({ slug: snapshot.id, ...raw });
}

export async function saveUserProblem(
	userId: string,
	sessionId: string,
	problem: CodeProblem
): Promise<void> {
	const parsed = CodeProblemSchema.parse(problem);
	await resolveProblemDoc(userId, sessionId, parsed.slug).set(parsed);
}
