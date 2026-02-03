import { CodeProblemSchema, type CodeProblem } from '@spark/schemas';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument, setFirestoreDocument } from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const problemIdSchema = z.string().trim().min(1, 'problemId is required');
const sessionIdSchema = z.string().trim().min(1, 'sessionId is required');

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function resolveProblemDocPath(userId: string, sessionId: string, problemId: string): string {
	const uid = userIdSchema.parse(userId);
	const sid = sessionIdSchema.parse(sessionId);
	const pid = problemIdSchema.parse(problemId);
	return `spark/${uid}/sessions/${sid}/code/${pid}`;
}

export async function getUserProblem(
	userId: string,
	sessionId: string,
	problemId: string
): Promise<CodeProblem | null> {
	const documentPath = resolveProblemDocPath(userId, sessionId, problemId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const raw = snapshot.data;
	const slug = problemIdSchema.parse(problemId);
	return CodeProblemSchema.parse({ slug, ...raw });
}

export async function saveUserProblem(
	userId: string,
	sessionId: string,
	problem: CodeProblem
): Promise<void> {
	const parsed = CodeProblemSchema.parse(problem);
	const documentPath = resolveProblemDocPath(userId, sessionId, parsed.slug);
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath,
		data: parsed as unknown as Record<string, unknown>
	});
}
