import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import { getAdminUserProfile } from '$lib/server/admin/usersRepo';
import { listSessions } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import {
	deleteFirestoreDocument,
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { Actions, PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required')
});

const lessonIdSchema = z.object({
	sessionId: z.string().trim().min(1, 'sessionId is required')
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function toIso(value: Date | null): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

function stateInstantOrNull(value: Date): Date | null {
	if (value.getTime() <= 0) {
		return null;
	}
	return value;
}

const LESSON_LIST_LIMIT = 50;

export const load: PageServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);

	const [profile, sessions] = await Promise.all([
		getAdminUserProfile(userId).catch((error) => {
			console.error('Failed to load user profile', { userId, error });
			return null;
		}),
		listSessions(userId, LESSON_LIST_LIMIT)
	]);

	const states = await Promise.all(sessions.map((session) => getSessionState(userId, session.id)));

	const lessons = sessions.map((session, index) => {
		const state = states[index];
		const { completed, total } = countCompletedSteps(session, state);
		const status = deriveLessonStatus(session, state);
		const lastProgressAt = stateInstantOrNull(state.lastUpdatedAt);
		return {
			id: session.id,
			title: session.title,
			emoji: session.emoji ?? '📘',
			status,
			createdAt: session.createdAt.toISOString(),
			lastProgressAt: lastProgressAt ? lastProgressAt.toISOString() : null,
			completed,
			total
		};
	});

	const user = profile ?? {
		uid: userId,
		email: null,
		name: null,
		photoUrl: null,
		isAnonymous: false,
		signInProvider: null,
		currentSessionId: null,
		createdAt: null,
		updatedAt: null,
		lastLoginAt: null,
		lastActivityAt: null
	};

	return {
		userDocFound: Boolean(profile),
		user: {
			uid: user.uid,
			email: user.email,
			name: user.name,
			photoUrl: user.photoUrl,
			isAnonymous: user.isAnonymous,
			signInProvider: user.signInProvider,
			currentSessionId: user.currentSessionId,
			createdAt: toIso(user.createdAt),
			updatedAt: toIso(user.updatedAt),
			lastLoginAt: toIso(user.lastLoginAt),
			lastActivityAt: toIso(user.lastActivityAt)
		},
		lessons
	};
};

export const actions: Actions = {
	resetLesson: async ({ params, request }) => {
		const { userId } = paramsSchema.parse(params);
		const formData = await request.formData();
		const parsed = lessonIdSchema.safeParse({
			sessionId: typeof formData.get('sessionId') === 'string' ? formData.get('sessionId') : ''
		});
		if (!parsed.success) {
			const [issue] = parsed.error.issues;
			return fail(400, { error: issue?.message ?? 'Session ID is required.' });
		}

		const sessionId = parsed.data.sessionId;
		const serviceAccountJson = requireServiceAccountJson();

		try {
			await patchFirestoreDocument({
				serviceAccountJson,
				documentPath: `spark/${userId}/state/${sessionId}`,
				updates: { sessionId, items: {}, lastUpdatedAt: new Date() }
			});

			return { success: { message: `Reset progress for ${sessionId}.` } as const };
		} catch (error) {
			console.error('Failed to reset lesson progress', { userId, sessionId, error });
			return fail(500, { error: 'Failed to reset progress. Please try again.' });
		}
	},
	deleteLesson: async ({ params, request }) => {
		const { userId } = paramsSchema.parse(params);
		const formData = await request.formData();
		const parsed = lessonIdSchema.safeParse({
			sessionId: typeof formData.get('sessionId') === 'string' ? formData.get('sessionId') : ''
		});
		if (!parsed.success) {
			const [issue] = parsed.error.issues;
			return fail(400, { error: issue?.message ?? 'Session ID is required.' });
		}

		const sessionId = parsed.data.sessionId;
		const serviceAccountJson = requireServiceAccountJson();

		try {
			const subcollections = ['quiz', 'code', 'media'] as const;
			for (const sub of subcollections) {
				const docs = await listFirestoreDocuments({
					serviceAccountJson,
					collectionPath: `spark/${userId}/sessions/${sessionId}/${sub}`,
					limit: 500
				});
				for (const doc of docs) {
					await deleteFirestoreDocument({ serviceAccountJson, documentPath: doc.documentPath });
				}
			}

			await deleteFirestoreDocument({
				serviceAccountJson,
				documentPath: `spark/${userId}/state/${sessionId}`
			});
			await deleteFirestoreDocument({
				serviceAccountJson,
				documentPath: `spark/${userId}/sessions/${sessionId}`
			});

			const userDoc = await getFirestoreDocument({
				serviceAccountJson,
				documentPath: `spark/${userId}`
			});
			if (userDoc.exists && userDoc.data?.currentSessionId === sessionId) {
				await patchFirestoreDocument({
					serviceAccountJson,
					documentPath: `spark/${userId}`,
					updates: { currentSessionId: null }
				});
			}

			return { success: { message: `Deleted lesson ${sessionId}.` } as const };
		} catch (error) {
			console.error('Failed to delete lesson', { userId, sessionId, error });
			return fail(500, { error: 'Failed to delete lesson. Please try again.' });
		}
	}
};
