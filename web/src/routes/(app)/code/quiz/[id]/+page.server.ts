import type { PageServerLoad } from './$types';
import { quizRegistry } from '$lib/server/quiz/mock-data';
import type { QuizDefinition } from '$lib/types/quiz';

const registry = new Map<string, QuizDefinition>(
        quizRegistry.map((quiz) => [quiz.id, quiz] as const)
);
const fallbackQuiz = quizRegistry[0]!;

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;
        const quiz = registry.get(id) ?? fallbackQuiz;

	return {
		quiz
	};
};
