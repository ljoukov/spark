import { env } from '$env/dynamic/private';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import {
	buildWorkspaceFileDocPath,
	SPARK_GRADER_SHEET_PATH,
	SPARK_GRADER_SUMMARY_PATH
} from '@spark/llm';
import { z } from 'zod';

export const DEFAULT_GRADER_RUN_KEY = 'uploaded_work' as const;
export const DEFAULT_GRADER_RUN_LABEL = 'Uploaded work' as const;
export const GRADER_SUMMARY_PATH = SPARK_GRADER_SUMMARY_PATH;
export const GRADER_SHEET_PATH = SPARK_GRADER_SHEET_PATH;

const userIdSchema = z.string().trim().min(1, 'userId is required');
const runIdSchema = z.string().trim().min(1, 'runId is required');
const trimmedString = z.string().trim().min(1);

const firestoreTimestampSchema = z.preprocess((value) => {
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date;
		}
		return value;
	}
	if (
		value &&
		typeof value === 'object' &&
		'seconds' in value &&
		'nanoseconds' in value &&
		typeof (value as { seconds: unknown }).seconds === 'number' &&
		typeof (value as { nanoseconds: unknown }).nanoseconds === 'number'
	) {
		const seconds = (value as { seconds: number }).seconds;
		const nanoseconds = (value as { nanoseconds: number }).nanoseconds;
		return new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
	}
	return value;
}, z.date());

const sparkGraderTotalsSchema = z.object({
	awardedMarks: z.number().min(0),
	maxMarks: z.number().min(0),
	problemCount: z.number().int().min(0),
	gradedCount: z.number().int().min(0),
	percentage: z.number().min(0).max(100).optional()
});

const sparkGraderProblemSummarySchema = z.object({
	id: trimmedString,
	index: z.number().int().min(1),
	title: trimmedString.optional(),
	awardedMarks: z.number().min(0).optional(),
	maxMarks: z.number().min(0).optional(),
	verdict: z.enum(['correct', 'partial', 'incorrect', 'ungraded']).optional(),
	filePath: trimmedString
});

const sparkGraderSheetSummarySchema = z.object({
	title: trimmedString.optional(),
	filePath: trimmedString
});

const sparkGraderPaperSchema = z
	.object({
		contextLabel: trimmedString.optional(),
		olympiad: trimmedString.optional(),
		year: trimmedString.optional(),
		paperName: trimmedString.optional(),
		paperUrl: trimmedString.optional(),
		markSchemeUrl: trimmedString.optional()
	})
	.transform(({ contextLabel, olympiad, ...rest }) => ({
		...rest,
		...((contextLabel ?? olympiad) ? { contextLabel: contextLabel ?? olympiad } : {})
	}));

const sparkGraderPresentationSchema = z.object({
	title: trimmedString.optional(),
	summaryMarkdown: trimmedString.optional()
});

const sparkGraderRunSchema = z.object({
	id: trimmedString,
	agentId: trimmedString,
	workspaceId: trimmedString,
	conversationId: trimmedString.optional(),
	userPrompt: trimmedString.optional(),
	olympiadKey: trimmedString,
	olympiadLabel: trimmedString,
	summaryPath: trimmedString,
	problemsDir: trimmedString.optional(),
	sheetPath: trimmedString,
	sourceAttachmentIds: z.array(trimmedString).optional(),
	sourceAttachmentCount: z.number().int().min(0).optional(),
	status: z.enum(['created', 'executing', 'stopped', 'failed', 'done']),
	paper: sparkGraderPaperSchema.optional(),
	presentation: sparkGraderPresentationSchema.optional(),
	totals: sparkGraderTotalsSchema.optional(),
	problems: z.array(sparkGraderProblemSummarySchema).optional(),
	sheet: sparkGraderSheetSummarySchema.optional(),
	resultSummary: z.string().trim().optional(),
	error: z.string().trim().optional(),
	createdAt: firestoreTimestampSchema,
	updatedAt: firestoreTimestampSchema,
	completedAt: firestoreTimestampSchema.optional()
});

type SparkGraderRun = z.infer<typeof sparkGraderRunSchema>;

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
	const parsedUserId = userIdSchema.parse(userId);
	return `spark/${parsedUserId}`;
}

export function resolveGraderRunDocPath(userId: string, runId: string): string {
	return `${resolveSparkUserDocPath(userId)}/graderRuns/${runIdSchema.parse(runId)}`;
}

export async function createGraderRun(userId: string, run: SparkGraderRun): Promise<void> {
	const validated = sparkGraderRunSchema.parse(run);
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveGraderRunDocPath(userId, validated.id),
		data: validated as unknown as Record<string, unknown>
	});
}

export async function patchGraderRun(
	userId: string,
	runId: string,
	updates: Record<string, unknown>
): Promise<void> {
	await patchFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveGraderRunDocPath(userId, runId),
		updates
	});
}

export async function listGraderRuns(userId: string, limit = 50): Promise<SparkGraderRun[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `${resolveSparkUserDocPath(userId)}/graderRuns`,
		limit,
		orderBy: 'createdAt desc'
	});
	const runs: SparkGraderRun[] = [];
	for (const doc of docs) {
		const parsed = sparkGraderRunSchema.safeParse({
			id: docIdFromPath(doc.documentPath),
			...doc.data
		});
		if (!parsed.success) {
			console.warn('Skipping invalid grader run document', {
				documentPath: doc.documentPath,
				issues: parsed.error.issues
			});
			continue;
		}
		runs.push(parsed.data);
	}
	return runs;
}

export async function getGraderRun(userId: string, runId: string): Promise<SparkGraderRun | null> {
	const docPath = resolveGraderRunDocPath(userId, runId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: docPath
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const parsed = sparkGraderRunSchema.safeParse({
		id: runIdSchema.parse(runId),
		...snapshot.data
	});
	if (!parsed.success) {
		console.warn('Invalid grader run payload', {
			docPath,
			issues: parsed.error.issues
		});
		return null;
	}
	return parsed.data;
}

export async function getWorkspaceTextFile(
	userId: string,
	workspaceId: string,
	filePath: string
): Promise<string | null> {
	const serviceAccountJson = requireServiceAccountJson();
	const path = filePath.trim();
	if (path.length === 0) {
		return null;
	}
	const snapshot = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: buildWorkspaceFileDocPath({
			userId,
			workspaceId,
			filePath: path
		})
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const content = snapshot.data.content;
	if (typeof content !== 'string') {
		return null;
	}
	return content;
}
