import type { QuizDefinition } from '$lib/types/quiz';

export const dynamicProgrammingQuiz: QuizDefinition = {
	id: 'dynamic-programming-foundations',
	title: 'Dynamic Programming Starter Quiz',
	topic: 'Dynamic Programming',
	estimatedMinutes: 8,
	description:
		'Warm up with overlapping subproblems, transitions, and naming conventions used in interview-style DP questions.',
	questions: [
		{
			kind: 'multiple-choice',
			id: 'dp-overlap-properties',
			prompt: 'Which pair of properties must hold before dynamic programming is a good fit?',
			hint: 'Think about repeated work and whether substructures can be combined.',
			explanation:
				'Dynamic programming is valuable when subproblems repeat across branches and a global solution can be composed from optimal subproblem answers.',
			options: [
				{ id: 'A', label: 'A', text: 'Greedy-choice property and logarithmic complexity' },
				{ id: 'B', label: 'B', text: 'Deterministic transitions and acyclic graphs' },
				{ id: 'C', label: 'C', text: 'Overlapping subproblems and optimal substructure' },
				{ id: 'D', label: 'D', text: 'Divide-and-conquer decomposition and prefix sums' }
			],
			correctOptionId: 'C'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-space-optimisation',
			prompt: 'When converting a two-dimensional DP table to a rolling array, what requirement must hold?',
			hint: 'Look at how state transitions read previous rows or columns.',
			explanation:
				'Rolling arrays only work when each state depends on a limited window of prior states, such as the previous row or column, so overwritten entries are never read again.',
			options: [
				{ id: 'A', label: 'A', text: 'Each cell depends only on its diagonal neighbour' },
				{ id: 'B', label: 'B', text: 'Transitions read no more than one previous layer' },
				{ id: 'C', label: 'C', text: 'State transitions form a tree without cycles' },
				{ id: 'D', label: 'D', text: 'The table indices are strictly increasing in both axes' }
			],
			correctOptionId: 'B'
		},
		{
			kind: 'multiple-choice',
			id: 'dp-transition-order',
			prompt: 'Tabulation requires evaluating states in which order?',
			hint: 'Follow the dependency graph of your transitions.',
			explanation:
				'Tabulation fills the table iteratively so every dependency is ready before a state is computed, typically moving from base cases up to the target state.',
			options: [
				{ id: 'A', label: 'A', text: 'Any order, because memoization handles recursion' },
				{ id: 'B', label: 'B', text: 'Descending order from target state to base cases' },
				{ id: 'C', label: 'C', text: 'A topological order that respects each transition' },
				{ id: 'D', label: 'D', text: 'Breadth-first order by Manhattan distance' }
			],
			correctOptionId: 'C'
		},
		{
			kind: 'type-answer',
			id: 'dp-top-down-term',
			prompt: 'What is the top-down technique that caches recursive results to avoid repeated work?',
			hint: 'It pairs recursion with a hash map or array to remember answers.',
			explanation:
				'Recursive memoization stores the outcome of subproblems so subsequent calls can return instantly instead of recomputing.',
			answer: 'memoization',
			acceptableAnswers: ['memoisation']
		},
		{
			kind: 'type-answer',
			id: 'dp-table-name',
			prompt: 'In a coin change tabulation with states dp[amount], what value does dp[0] store?',
			hint: 'How many ways exist to form zero value?',
			explanation:
				'Setting dp[0] = 1 encodes the base case that there is exactly one way to form zero amount: choose no coins.',
			answer: '1',
			acceptableAnswers: ['one']
		}
	]
};
