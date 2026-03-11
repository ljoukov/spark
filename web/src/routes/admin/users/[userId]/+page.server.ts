import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import { listSessions } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import {
	collection,
	deleteField,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	getFirestore,
	limit as limitQuery,
	query,
	setDoc
} from '@ljoukov/firebase-admin-cloudflare/firestore';
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

function stateInstantOrNull(value: Date): Date | null {
	if (value.getTime() <= 0) {
		return null;
	}
	return value;
}

const LESSON_LIST_LIMIT = 50;

export const load: PageServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);

	const sessions = await listSessions(userId, LESSON_LIST_LIMIT);

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

	return {
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
			const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
			firestore.settings({ ignoreUndefinedProperties: true });
			await setDoc(
				doc(firestore, `spark/${userId}/state/${sessionId}`),
				{ sessionId, items: deleteField(), lastUpdatedAt: new Date() },
				{ merge: true }
			);

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
			const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
			firestore.settings({ ignoreUndefinedProperties: true });
			const subcollections = ['quiz', 'code', 'media'] as const;
			for (const sub of subcollections) {
				const docs = await getDocs(
					query(collection(firestore, `spark/${userId}/sessions/${sessionId}/${sub}`), limitQuery(500))
				);
				for (const lessonDoc of docs.docs) {
					await deleteDoc(lessonDoc.ref);
				}
			}

			await deleteDoc(doc(firestore, `spark/${userId}/state/${sessionId}`));
			await deleteDoc(doc(firestore, `spark/${userId}/sessions/${sessionId}`));

			const userDoc = await getDoc(doc(firestore, `spark/${userId}`));
			if (userDoc.exists && userDoc.data()?.currentSessionId === sessionId) {
				await setDoc(doc(firestore, `spark/${userId}`), { currentSessionId: null }, { merge: true });
			}

			return { success: { message: `Deleted lesson ${sessionId}.` } as const };
		} catch (error) {
			console.error('Failed to delete lesson', { userId, sessionId, error });
			return fail(500, { error: 'Failed to delete lesson. Please try again.' });
		}
	}
};
