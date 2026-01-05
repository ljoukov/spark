import { error } from '@sveltejs/kit';
import { renderMarkdownOptional } from '$lib/server/markdown';
import { getUserQuiz } from '$lib/server/quiz/repo';
import type { PageServerLoad } from './$types';
import type { QuizDefinition as SchemaQuizDefinition } from '@spark/schemas';
import type {
	QuizDefinition as UiQuizDefinition,
	QuizInfoCardQuestion,
	QuizMultipleChoiceQuestion,
	QuizQuestion,
	QuizTypeAnswerQuestion
} from '$lib/types/quiz';

function enrichQuizWithHtml(quiz: SchemaQuizDefinition): UiQuizDefinition {
	return {
		...quiz,
		questions: quiz.questions.map((question) => {
			const promptHtml = renderMarkdownOptional(question.prompt);
			const hintHtml = renderMarkdownOptional(question.hint);
			const explanationHtml = renderMarkdownOptional(question.explanation);

			if (question.kind === 'multiple-choice') {
				return {
					...question,
					promptHtml,
					hintHtml,
					explanationHtml,
					options: question.options.map((option) => ({
						...option,
						textHtml: renderMarkdownOptional(option.text)
					}))
				} satisfies QuizMultipleChoiceQuestion;
			}

			if (question.kind === 'info-card') {
				return {
					...question,
					promptHtml,
					hintHtml,
					explanationHtml,
					bodyHtml: renderMarkdownOptional(question.body)
				} satisfies QuizInfoCardQuestion;
			}

			return {
				...question,
				promptHtml,
				hintHtml,
				explanationHtml
			} satisfies QuizTypeAnswerQuestion;
		}) as QuizQuestion[]
	};
}

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
		quiz: enrichQuizWithHtml(quiz),
		sessionId: session.id,
		userId,
		sessionState,
		planItemState: sessionState.items[planItem.id] ?? null
	};
};
