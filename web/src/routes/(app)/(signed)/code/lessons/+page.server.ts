import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import { listSessions } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import {
	listWelcomeSessionOptions,
	provisionWelcomeSession
} from '$lib/server/session/welcomeSessions';
import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const LESSON_LIST_LIMIT = 50;
const selectionSchema = z.object({
	topic: z.string().trim().min(1, 'Please choose a topic to begin.')
});

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/welcome');
	}

	const sessions = await listSessions(user.uid, LESSON_LIST_LIMIT);
	const states = await Promise.all(
		sessions.map((session) => getSessionState(user.uid, session.id))
	);

	const lessons = sessions.map((session, index) => {
		const state = states[index];
		const { completed, total } = countCompletedSteps(session, state);
		const status = deriveLessonStatus(session, state);
		return {
			id: session.id,
			title: session.title,
			tagline: session.tagline ?? session.summary ?? null,
			emoji: session.emoji ?? '📘',
			status,
			createdAt: session.createdAt.toISOString(),
			completed,
			total
		};
	});

	const lessonsById = new Map<string, { status: (typeof lessons)[number]['status'] }>();
	for (const lesson of lessons) {
		lessonsById.set(lesson.id, { status: lesson.status });
	}

	const welcomeTemplates = (await listWelcomeSessionOptions()).map((template) => {
		const existingLesson =
			lessonsById.get(template.sessionId) ?? lessonsById.get(template.key);
		return {
			...template,
			existingLessonStatus: existingLesson?.status ?? null
		};
	});

	return { lessons, welcomeTemplates };
};

export const actions: Actions = {
	start: async ({ locals, request }) => {
		const user = locals.appUser;
		if (!user) {
			throw redirect(302, '/welcome');
		}

		const formData = await request.formData();
		const parsed = selectionSchema.safeParse({ topic: formData.get('topic') });
		if (!parsed.success) {
			return fail(400, { error: 'Please choose a topic to begin.' });
		}

		try {
			const options = await listWelcomeSessionOptions();
			const allowedKeys = new Set(options.map((option) => option.key));
			const topic = parsed.data.topic;
			if (!allowedKeys.has(topic)) {
				return fail(400, { error: 'Please choose a topic to begin.' });
			}

			const session = await provisionWelcomeSession(user.uid, topic);
			throw redirect(303, `/code/${session.id}`);
		} catch (error) {
			if (isRedirect(error)) {
				throw error;
			}
			console.error('Unable to provision welcome session from lessons page', error);
			return fail(500, { error: 'We could not start that session. Please try again.' });
		}
	}
};
