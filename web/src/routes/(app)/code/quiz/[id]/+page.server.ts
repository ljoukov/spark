import type { PageServerLoad } from './$types';
import {
	dynamicProgrammingQuizzes,
	dynamicProgrammingWarmupQuiz
} from '$lib/server/quiz/mock-data';
import type { QuizDefinition } from '$lib/types/quiz';

const registry = new Map<string, QuizDefinition>(
	dynamicProgrammingQuizzes.map((entry) => [entry.id, entry] as const)
);

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;
	const quiz = registry.get(id) ?? dynamicProgrammingWarmupQuiz;

	return {
		quiz
	};
};
