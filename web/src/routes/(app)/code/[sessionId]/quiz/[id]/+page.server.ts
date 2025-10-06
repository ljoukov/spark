import { error } from '@sveltejs/kit';
import { getUserQuiz } from '$lib/server/quiz/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { session, userId, sessionState } = await parent();
	const planItem = session.plan.find((item) => item.id === params.id);
	if (!planItem || planItem.kind !== 'quiz') {
		throw error(404, { message: 'Quiz not found in session plan' });
	}

	const quiz = await getUserQuiz(userId, session.id, planItem.id);
	if (!quiz) {
		throw error(404, { message: 'Quiz definition not found' });
	}

	return {
		planItem,
		quiz,
		sessionId: session.id,
		userId,
		sessionState,
		planItemState: sessionState.items[planItem.id] ?? null
	};
};
