import type { PageServerLoad } from './$types';
import { dynamicProgrammingQuiz } from '$lib/server/quiz/mock-data';
import type { QuizDefinition } from '$lib/types/quiz';

const registry = new Map<string, QuizDefinition>([
	[dynamicProgrammingQuiz.id, dynamicProgrammingQuiz]
]);

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;
	const quiz = registry.get(id) ?? dynamicProgrammingQuiz;

	return {
		quiz
	};
};
