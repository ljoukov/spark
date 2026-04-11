import { env } from '$env/dynamic/private';
import { SparkSheetDashboardStateSchema, type SparkSheetDashboardState } from '@spark/schemas';
import { z } from 'zod';

import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';

const userIdSchema = z.string().trim().min(1, 'userId is required');

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

export function resolveSheetDashboardDocPath(userId: string): string {
	return `spark/${userIdSchema.parse(userId)}/sheetDashboard/current`;
}

export async function getSheetDashboard(userId: string): Promise<SparkSheetDashboardState | null> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: resolveSheetDashboardDocPath(userId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const parsed = SparkSheetDashboardStateSchema.safeParse(snapshot.data);
	if (!parsed.success) {
		console.warn('Invalid sheet dashboard payload', {
			documentPath: resolveSheetDashboardDocPath(userId),
			issues: parsed.error.issues
		});
		return null;
	}
	return parsed.data;
}
