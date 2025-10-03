import type { QuizDefinition } from '$lib/types/quiz';

export const dynamicProgrammingWarmupQuiz: QuizDefinition = {
	id: 'dp-warmup-quiz',
	title: 'DP Warm‑up: Basics',
	topic: 'Dynamic Programming',
	estimatedMinutes: 3,
	progressKey: 'warmup',
	description: 'Three very short questions to build intuition—no formulas needed.',
	questions: [
		{
			kind: 'multiple-choice',
			id: 'dp-warmup-overlap',
			prompt: 'What is the big idea behind dynamic programming (DP)?',
			hint: 'Think “break, solve small, remember, reuse”.',
			explanation:
				'DP means breaking a problem into smaller pieces, solving those small pieces once, saving the answers, and reusing them so you do not repeat work.',
			options: [
				{ id: 'A', label: 'A', text: 'Try everything randomly and hope for the best' },
				{ id: 'B', label: 'B', text: 'Break problems into smaller parts and reuse saved answers' },
				{ id: 'C', label: 'C', text: 'Sort the input to make it faster' },
				{ id: 'D', label: 'D', text: 'Draw a graph and do BFS every time' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-warmup-base-case',
			prompt: 'What is a “base case” in DP?',
			hint: 'Start from something you already know.',
			explanation:
				'A base case is a tiny version of the problem with an answer you already know. It anchors everything else you build.',
			options: [
				{ id: 'A', label: 'A', text: 'A fancy optimization that makes code faster' },
				{ id: 'B', label: 'B', text: 'A simple starting situation with a known answer' },
				{ id: 'C', label: 'C', text: 'The biggest input you plan to test' },
				{ id: 'D', label: 'D', text: 'A sign that the problem has no solution' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-warmup-order',
			prompt: 'Why do DP solutions keep a table/array/map of results?',
			hint: 'Think about not solving the same thing twice.',
			explanation:
				'The table stores answers you have already computed so later steps can reuse them instead of recomputing.',
			options: [
				{ id: 'A', label: 'A', text: 'To print the results in a nice grid' },
				{
					id: 'B',
					label: 'B',
					text: 'To store answers we have already computed so we can reuse them'
				},
				{ id: 'C', label: 'C', text: 'To make the code longer and more complex' },
				{ id: 'D', label: 'D', text: 'To use more memory because memory is cheap' }
			],
			correctOptionId: 'B'
		}
	]
};

export const dynamicProgrammingTopicDeck: QuizDefinition = {
	id: 'dp-topic-deck',
	title: 'DP Basics: Break · Store · Reuse',
	topic: 'Dynamic Programming',
	estimatedMinutes: 5,
	progressKey: 'topic',
	description: 'Two simple idea cards, then three easy checks to confirm understanding.',
	questions: [
		{
			kind: 'info-card',
			id: 'dp-topic-card-1',
			prompt: 'What DP tries to do',
			eyebrow: 'Idea card',
			body: 'Solve a problem by building from small, easy cases. Save answers as you go so you can reuse them later instead of redoing work.',
			continueLabel: 'Next idea'
		},
		{
			kind: 'info-card',
			id: 'dp-topic-card-2',
			prompt: 'Two friendly styles',
			eyebrow: 'Idea card',
			body: 'Memoization (top‑down): write a recursive function and remember results. Tabulation (bottom‑up): fill a small table from simple to harder cases. Both do the same thing: reuse answers.',
			continueLabel: "Let's practice"
		},
		{
			kind: 'multiple-choice',
			id: 'dp-topic-question-1',
			prompt: 'Which sentence best describes memoization?',
			hint: 'Think “remember answers to function calls”.',
			explanation:
				'Memoization means caching the result for a given input so future calls with that input can return immediately.',
			options: [
				{ id: 'A', label: 'A', text: 'Run your code twice to be extra sure' },
				{ id: 'B', label: 'B', text: 'Remember results of function calls so you can reuse them' },
				{ id: 'C', label: 'C', text: 'Sort the input before any computation' },
				{ id: 'D', label: 'D', text: 'Avoid loops and only use recursion' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-topic-question-2',
			prompt: 'What is a good first step when starting a DP problem?',
			hint: 'Describe the state and start tiny.',
			explanation:
				'Define the “state” in plain words (what a subproblem means) and set a tiny base case. That gives you a solid, simple starting point.',
			options: [
				{ id: 'A', label: 'A', text: 'Write the final formula before doing examples' },
				{ id: 'B', label: 'B', text: 'Define the state in words and set a small base case' },
				{ id: 'C', label: 'C', text: 'Code 100 lines and refactor later' },
				{ id: 'D', label: 'D', text: 'Guess an answer and move on' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-topic-question-3',
			prompt: 'If you notice the same small question being asked many times, what should you do?',
			hint: 'Reuse beats redo.',
			explanation:
				'Save that small answer (cache/table) and reuse it whenever you need it again. That is the whole point of DP.',
			options: [
				{ id: 'A', label: 'A', text: 'Ignore duplicates and recompute to be safe' },
				{ id: 'B', label: 'B', text: 'Store the answer once and reuse it later' },
				{ id: 'C', label: 'C', text: 'Increase recursion depth to explore more' },
				{ id: 'D', label: 'D', text: 'Switch to a completely different algorithm immediately' }
			],
			correctOptionId: 'B'
		}
	]
};

export const dynamicProgrammingReviewQuiz: QuizDefinition = {
	id: 'dp-review-quiz',
	title: 'DP Review: Ready to Start',
	topic: 'Dynamic Programming',
	estimatedMinutes: 4,
	progressKey: 'review',
	description: 'Three friendly checkups using everyday DP thinking.',
	questions: [
		{
			kind: 'multiple-choice',
			id: 'dp-review-stairs',
			prompt:
				'You can climb stairs by taking 1 or 2 steps at a time. How can you think about the ways to reach a step n?',
			hint: 'Consider how you could arrive at step n.',
			explanation:
				'To stand on step n you either came from n−1 with a 1‑step or from n−2 with a 2‑step, so you add those counts together.',
			options: [
				{ id: 'A', label: 'A', text: 'Double the number of ways to reach step n−1' },
				{ id: 'B', label: 'B', text: 'Add the ways to reach steps n−1 and n−2' },
				{ id: 'C', label: 'C', text: 'Subtract the ways to reach step n−2 from n−1' },
				{ id: 'D', label: 'D', text: 'Multiply the ways to reach steps n−1 and n−2' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-review-grid',
			prompt:
				'In a grid where you can move only right or down, what is true about the top row and the left column?',
			hint: 'Think about how many choices you have along an edge.',
			explanation:
				'Along the top row and left column there is only one way forward, so each of those cells has exactly one path to it.',
			options: [
				{ id: 'A', label: 'A', text: 'There are zero ways to move along them.' },
				{ id: 'B', label: 'B', text: 'Each cell on those edges has exactly one way to reach it.' },
				{ id: 'C', label: 'C', text: 'You must always start from the bottom‑right corner.' },
				{ id: 'D', label: 'D', text: 'They require a special formula for every cell.' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-review-memo',
			prompt: 'When should you save an answer in a memoized (remembering) solution?',
			hint: 'Save it once; reuse many times.',
			explanation:
				'Right after you compute a subproblem’s answer, store it so the next time you see the same input you can return it immediately.',
			options: [
				{ id: 'A', label: 'A', text: 'Before recursing, even if you have no answer yet' },
				{
					id: 'B',
					label: 'B',
					text: 'After computing a subproblem so repeated calls can reuse it'
				},
				{ id: 'C', label: 'C', text: 'Only if the answer happens to be zero' },
				{ id: 'D', label: 'D', text: 'Never—just recompute every time for clarity' }
			],
			correctOptionId: 'B'
		}
	]
};

export const dynamicProgrammingQuizzes = [
	dynamicProgrammingWarmupQuiz,
	dynamicProgrammingTopicDeck,
	dynamicProgrammingReviewQuiz
] satisfies readonly QuizDefinition[];
