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
	const renderAnswer = (answer?: string) => {
		if (!answer) {
			return undefined;
		}
		const hasLatex = /\\[a-zA-Z]+/.test(answer);
		const hasDollar = answer.includes('$');
		const candidate = !hasDollar && hasLatex ? `$${answer}$` : answer;
		return renderMarkdownOptional(candidate);
	};

	const renderFeedback = (message: string) => renderMarkdownOptional(message);

	return {
		...quiz,
		questions: quiz.questions.map((question) => {
			const promptHtml = renderMarkdownOptional(question.prompt);
			const hintHtml = renderMarkdownOptional(question.hint);

			if (question.kind === 'multiple-choice') {
				const explanationHtml = renderMarkdownOptional(question.explanation);
				return {
					...question,
					promptHtml,
					hintHtml,
					explanationHtml,
					correctFeedback: {
						...question.correctFeedback,
						messageHtml: renderFeedback(question.correctFeedback.message)
					},
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
					bodyHtml: renderMarkdownOptional(question.body)
				} satisfies QuizInfoCardQuestion;
			}

			return {
				...question,
				promptHtml,
				hintHtml,
				answerHtml: renderAnswer(question.answer),
				correctFeedback: {
					...question.correctFeedback,
					messageHtml: renderFeedback(question.correctFeedback.message)
				}
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

	const planItemState = sessionState.items[planItem.id] ?? null;
	const gradeFeedbackHtml: Record<string, string> = {};
	if (planItemState?.quiz?.questions) {
		for (const [questionId, questionState] of Object.entries(planItemState.quiz.questions)) {
			const feedback = questionState.grade?.feedback;
			if (!feedback) {
				continue;
			}
			const rendered = renderMarkdownOptional(feedback);
			if (rendered) {
				gradeFeedbackHtml[questionId] = rendered;
			}
		}
	}

	return {
		planItem,
		quiz: enrichQuizWithHtml(quiz),
		sessionId: session.id,
		userId,
		sessionState,
		planItemState,
		gradeFeedbackHtml
	};
};
