import type { PageServerLoad } from './$types';
import {
        dynamicProgrammingReviewQuiz,
        dynamicProgrammingTopicDeck,
        dynamicProgrammingWarmupQuiz
} from '$lib/server/quiz/mock-data';
import type { QuizDefinition } from '$lib/types/quiz';

const registry = new Map<string, QuizDefinition>([
        [dynamicProgrammingWarmupQuiz.id, dynamicProgrammingWarmupQuiz],
        [dynamicProgrammingTopicDeck.id, dynamicProgrammingTopicDeck],
        [dynamicProgrammingReviewQuiz.id, dynamicProgrammingReviewQuiz]
]);

export const load: PageServerLoad = async ({ params }) => {
        const { id } = params;
        const quiz = registry.get(id) ?? dynamicProgrammingWarmupQuiz;

        return {
                quiz
	};
};
