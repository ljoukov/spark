import { error } from '@sveltejs/kit';
import { marked } from 'marked';
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

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(value?: string | null): string | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = marked.parse(value);
	if (typeof parsed !== 'string') {
		return undefined;
	}
	const trimmed = parsed.trim();
	return trimmed.length > 0 ? parsed : undefined;
}

function enrichQuizWithHtml(quiz: SchemaQuizDefinition): UiQuizDefinition {
	return {
		...quiz,
		questions: quiz.questions.map((question) => {
			const promptHtml = renderMarkdown(question.prompt);
			const hintHtml = renderMarkdown(question.hint);
			const explanationHtml = renderMarkdown(question.explanation);

			if (question.kind === 'multiple-choice') {
				return {
					...question,
					promptHtml,
					hintHtml,
					explanationHtml,
					options: question.options.map((option) => ({
						...option,
						textHtml: renderMarkdown(option.text)
					}))
				} satisfies QuizMultipleChoiceQuestion;
			}

			if (question.kind === 'info-card') {
				return {
					...question,
					promptHtml,
					hintHtml,
					explanationHtml,
					bodyHtml: renderMarkdown(question.body)
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
