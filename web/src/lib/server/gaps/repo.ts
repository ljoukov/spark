import { env } from '$env/dynamic/private';
import { getFirestoreDocument, listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import { SparkLearningGapSchema, type SparkLearningGap } from '@spark/schemas';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const gapIdSchema = z.string().trim().min(1, 'gapId is required');

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

function resolveSparkUserDocPath(userId: string): string {
	return `spark/${userIdSchema.parse(userId)}`;
}

function resolveGapDocPath(userId: string, gapId: string): string {
	return `${resolveSparkUserDocPath(userId)}/gaps/${gapIdSchema.parse(gapId)}`;
}

export async function listLearningGaps(userId: string, limit = 120): Promise<SparkLearningGap[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `${resolveSparkUserDocPath(userId)}/gaps`,
		limit,
		orderBy: 'createdAt desc'
	});
	const gaps: SparkLearningGap[] = [];
	for (const doc of docs) {
		const parsed = SparkLearningGapSchema.safeParse({
			id: docIdFromPath(doc.documentPath),
			...doc.data
		});
		if (!parsed.success) {
			console.warn('Skipping invalid gap document', {
				documentPath: doc.documentPath,
				issues: parsed.error.issues
			});
			continue;
		}
		if (parsed.data.status !== 'active') {
			continue;
		}
		gaps.push(parsed.data);
	}
	return gaps;
}

export async function getLearningGap(
	userId: string,
	gapId: string
): Promise<SparkLearningGap | null> {
	const parsedGapId = gapIdSchema.parse(gapId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveGapDocPath(userId, parsedGapId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const parsed = SparkLearningGapSchema.safeParse({
		id: parsedGapId,
		...snapshot.data
	});
	if (!parsed.success) {
		console.warn('Invalid gap document', {
			gapId: parsedGapId,
			issues: parsed.error.issues
		});
		return null;
	}
	if (parsed.data.status !== 'active') {
		return null;
	}
	return parsed.data;
}
