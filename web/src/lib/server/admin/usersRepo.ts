import { FirestoreTimestampSchema } from '@spark/schemas';
import { env } from '$env/dynamic/private';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	queryFirestoreDocuments
} from '$lib/server/gcp/firestoreRest';
import { z } from 'zod';

const userIdSchema = z.string().trim().min(1, 'userId is required');

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

const optionalTimestampSchema = z.preprocess((value) => {
	if (value === null || value === undefined) {
		return undefined;
	}
	return value;
}, FirestoreTimestampSchema.optional());

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const urlSchema = z.string().trim().pipe(z.url());

const userDocSchema = z
	.object({
		uid: z.string().trim().min(1).optional(),
		email: emailSchema.nullable().optional(),
		name: z.string().trim().min(1).nullable().optional(),
		photoUrl: urlSchema.nullable().optional(),
		isAnonymous: z.boolean().optional(),
		signInProvider: z.string().trim().min(1).nullable().optional(),
		currentSessionId: z.string().trim().min(1).nullable().optional(),
		createdAt: optionalTimestampSchema,
		updatedAt: optionalTimestampSchema,
		lastLoginAt: optionalTimestampSchema
	})
	.partial()
	.loose()
	.transform((value) => {
		const createdAt = value.createdAt ?? null;
		const updatedAt = value.updatedAt ?? null;
		const lastLoginAt = value.lastLoginAt ?? null;
		const lastActivityAt = updatedAt ?? lastLoginAt ?? createdAt ?? null;

		return {
			uid: value.uid ?? null,
			email: value.email ?? null,
			name: value.name ?? null,
			photoUrl: value.photoUrl ?? null,
			isAnonymous: value.isAnonymous ?? false,
			signInProvider: value.signInProvider ?? null,
			currentSessionId: value.currentSessionId ?? null,
			createdAt,
			updatedAt,
			lastLoginAt,
			lastActivityAt
		};
	});

export type AdminUserProfile = z.infer<typeof userDocSchema> & {
	uid: string;
};

function mergeUserId(userId: string, profile: z.infer<typeof userDocSchema>): AdminUserProfile {
	return {
		...profile,
		uid: userIdSchema.parse(userId)
	};
}

export async function getAdminUserProfile(userId: string): Promise<AdminUserProfile | null> {
	const uid = userIdSchema.parse(userId);
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `spark/${uid}`
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}

	const parsed = userDocSchema.safeParse(snapshot.data);
	if (!parsed.success) {
		console.warn('Unable to parse admin user profile', uid, parsed.error);
		return mergeUserId(uid, userDocSchema.parse({}));
	}
	return mergeUserId(uid, parsed.data);
}

export async function listAdminUserProfiles(options?: {
	limit?: number;
	orderBy?: string;
}): Promise<AdminUserProfile[]> {
	const limit = options?.limit ?? 50;
	const orderBy = options?.orderBy ?? 'lastLoginAt desc';

	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: 'spark',
		limit,
		orderBy
	});

	const users: AdminUserProfile[] = [];
	for (const doc of docs) {
		const uid = docIdFromPath(doc.documentPath);
		const parsed = userDocSchema.safeParse(doc.data);
		if (!parsed.success) {
			console.warn('Unable to parse admin user profile', uid, parsed.error);
			users.push(mergeUserId(uid, userDocSchema.parse({})));
			continue;
		}
		users.push(mergeUserId(uid, parsed.data));
	}

	return users;
}

export async function findAdminUsersByEmail(email: string): Promise<AdminUserProfile[]> {
	const parsedEmail = emailSchema.parse(email);
	const docs = await queryFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: 'spark',
		where: { fieldPath: 'email', op: 'EQUAL', value: parsedEmail },
		limit: 20
	});

	const users: AdminUserProfile[] = [];
	for (const doc of docs) {
		const uid = docIdFromPath(doc.documentPath);
		const parsed = userDocSchema.safeParse(doc.data);
		if (!parsed.success) {
			console.warn('Unable to parse admin user profile', uid, parsed.error);
			users.push(mergeUserId(uid, userDocSchema.parse({})));
			continue;
		}
		users.push(mergeUserId(uid, parsed.data));
	}
	return users;
}
