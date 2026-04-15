import { env } from '$env/dynamic/private';
import { z } from 'zod';

import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');
const trimmedString = z.string().trim().min(1);

const sheetSubjectTagSchema = z.object({
	key: trimmedString,
	label: trimmedString
});

const sheetRunAnalysisSchema = z.object({
	runId: trimmedString,
	subjectTags: z.array(sheetSubjectTagSchema).default([]),
	primarySubjectKey: trimmedString.optional(),
	summary: trimmedString.optional(),
	strongSpots: z.array(trimmedString).default([]),
	weakSpots: z.array(trimmedString).default([]),
	specifics: z.array(trimmedString).default([]),
	nextSteps: z.array(trimmedString).default([]),
	generalFeedback: trimmedString.optional()
});

const sheetRunAnalysisDocumentSchema = z.object({
	runAnalyses: z.array(sheetRunAnalysisSchema).default([])
});

export type SheetRunAnalysis = z.infer<typeof sheetRunAnalysisSchema>;

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

export function resolveSheetRunAnalysisDocPath(userId: string): string {
	return `spark/${userIdSchema.parse(userId)}/sheetDashboard/current`;
}

export async function getSheetRunAnalyses(userId: string): Promise<SheetRunAnalysis[]> {
	const documentPath = resolveSheetRunAnalysisDocPath(userId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath
	});
	if (!snapshot.exists || !snapshot.data) {
		return [];
	}
	const parsed = sheetRunAnalysisDocumentSchema.safeParse(snapshot.data);
	if (!parsed.success) {
		console.warn('Invalid sheet run analysis payload', {
			documentPath,
			issues: parsed.error.issues
		});
		return [];
	}
	return parsed.data.runAnalyses;
}
