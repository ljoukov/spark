import { z } from 'zod';

import {
	CodeProblemSchema,
	QuizDefinitionSchema,
	SessionSchema,
	type CodeProblem,
	type QuizDefinition,
	type Session
} from '@spark/schemas';

const AdventSessionBundleSchema = z.object({
	day: z.number().int().min(1).max(25),
	session: SessionSchema,
	quizzes: z.array(QuizDefinitionSchema).length(2),
	problems: z.array(CodeProblemSchema).length(2)
});

export type AdventSessionBundle = z.infer<typeof AdventSessionBundleSchema>;

const baseDate = (day: number): Date =>
	new Date(`2024-12-${String(day).padStart(2, '0')}T00:00:00Z`);

const makePointerWarmup = (): QuizDefinition => ({
	 id: 'advent-01-warmup',
	 title: 'Pointer pulse check',
	 description: '15 quick hitters on when and how to move paired indices.',
	 topic: 'two-pointers',
	 estimatedMinutes: 8,
	 progressKey: 'advent-01-warmup',
	 questions: [
		{ kind: 'info-card', id: 'q1-card', prompt: 'Why two pointers?', body: 'Use two pointers when order gives you an invariant (sorted array or monotone window). Move one pointer per step to keep the invariant easy to reason about.' },
		{ kind: 'multiple-choice', id: 'q2', prompt: 'Array sorted asc, sum=18, target=22. Move?', options: [ {id:'A',label:'A',text:'Left++'}, {id:'B',label:'B',text:'Right++'}, {id:'C',label:'C',text:'Left--'}, {id:'D',label:'D',text:'Right--'} ], correctOptionId: 'A', correctFeedback: { message: 'Raise the smaller addend.' }, explanation: 'Increase the smaller value to raise the sum.' },
		{ kind: 'multiple-choice', id: 'q3', prompt: 'Sum=31, target=20 in sorted array. Move?', options: [ {id:'A',label:'A',text:'Left++'}, {id:'B',label:'B',text:'Right--'}, {id:'C',label:'C',text:'Swap pointers'}, {id:'D',label:'D',text:'Reset'} ], correctOptionId: 'B', correctFeedback: { message: 'Drop the larger addend.' }, explanation: 'Decrease sum by moving right pointer left.' },
		{ kind: 'multiple-choice', id: 'q4', prompt: 'When are sliding windows safest?', options: [ {id:'A',label:'A',text:'Non-negative numbers'}, {id:'B',label:'B',text:'Arbitrary signs'}, {id:'C',label:'C',text:'Strings only'}, {id:'D',label:'D',text:'Sorted descending'} ], correctOptionId: 'A', correctFeedback: { message: 'Shrinking always lowers the sum when values are ≥0.' } },
		{ kind: 'type-answer', id: 'q5', prompt: 'Return value when no pair hits the target?', answer: '-1 -1', acceptableAnswers: ['-1 -1'], correctFeedback: { message: 'Use a sentinel pair.' } },
		{ kind: 'multiple-choice', id: 'q6', prompt: 'Invariant to keep for min-window sum?', options: [ {id:'A',label:'A',text:'left always moves right'}, {id:'B',label:'B',text:'window sum tracked'}, {id:'C',label:'C',text:'array sorted descending'}, {id:'D',label:'D',text:'window length fixed'} ], correctOptionId: 'B', correctFeedback: { message: 'Track current sum as you grow/shrink.' } },
		{ kind: 'multiple-choice', id: 'q7', prompt: 'Best data type for indices in Python?', options: [ {id:'A',label:'A',text:'int'}, {id:'B',label:'B',text:'float'}, {id:'C',label:'C',text:'str'}, {id:'D',label:'D',text:'bool'} ], correctOptionId: 'A', correctFeedback: { message: 'Plain ints are perfect.' } },
		{ kind: 'multiple-choice', id: 'q8', prompt: 'Why 1-based answers?', options: [ {id:'A',label:'A',text:'Matches problem spec'}, {id:'B',label:'B',text:'Python demands it'}, {id:'C',label:'C',text:'Zero is unsafe'}, {id:'D',label:'D',text:'Because recursion'} ], correctOptionId: 'A', correctFeedback: { message: 'Follow output contract exactly.' } },
		{ kind: 'multiple-choice', id: 'q9', prompt: 'Condition to shrink window?', options: [ {id:'A',label:'A',text:'sum >= target'}, {id:'B',label:'B',text:'sum < target'}, {id:'C',label:'C',text:'anytime'}, {id:'D',label:'D',text:'never'} ], correctOptionId: 'A', correctFeedback: { message: 'Only shrink while valid to hunt smaller length.' } },
		{ kind: 'multiple-choice', id: 'q10', prompt: 'Two pointers fail when...', options: [ {id:'A',label:'A',text:'array unsorted and no monotone rule'}, {id:'B',label:'B',text:'array length > 2'}, {id:'C',label:'C',text:'targets negative'}, {id:'D',label:'D',text:'indices start at 0'} ], correctOptionId: 'A', correctFeedback: { message: 'Need an ordering to steer moves.' } },
		{ kind: 'type-answer', id: 'q11', prompt: 'What loop condition prevents overlap?', answer: 'while i < j', acceptableAnswers: ['while i < j','i<j'], correctFeedback: { message: 'Stop when pointers cross.' } },
		{ kind: 'multiple-choice', id: 'q12', prompt: 'Best-case time for two-sum two-pointers?', options: [ {id:'A',label:'A',text:'O(n)'}, {id:'B',label:'B',text:'O(log n)'}, {id:'C',label:'C',text:'O(n log n)'}, {id:'D',label:'D',text:'O(n^2)'} ], correctOptionId: 'A', correctFeedback: { message: 'Single pass from both ends.' } },
		{ kind: 'multiple-choice', id: 'q13', prompt: 'Space complexity of sliding window sum?', options: [ {id:'A',label:'A',text:'O(1)'}, {id:'B',label:'B',text:'O(k)'}, {id:'C',label:'C',text:'O(n)'}, {id:'D',label:'D',text:'O(log n)'} ], correctOptionId: 'A', correctFeedback: { message: 'Track only indices and running sum.' } },
		{ kind: 'multiple-choice', id: 'q14', prompt: 'If numbers can be negative, what helps?', options: [ {id:'A',label:'A',text:'prefix sums'}, {id:'B',label:'B',text:'two pointers'}, {id:'C',label:'C',text:'bitmask'}, {id:'D',label:'D',text:'DFS'} ], correctOptionId: 'A', correctFeedback: { message: 'Prefix/monotone deque handles negatives, window alone fails.' } },
		{ kind: 'multiple-choice', id: 'q15', prompt: 'Edge case to guard first?', options: [ {id:'A',label:'A',text:'empty array'}, {id:'B',label:'B',text:'array already sorted'}, {id:'C',label:'C',text:'target zero'}, {id:'D',label:'D',text:'odd length'} ], correctOptionId: 'A', correctFeedback: { message: 'Return "-1 -1" if no data.' } }
	 ]
});

const makePointerWrap = (): QuizDefinition => ({
	id: 'advent-01-wrap',
	title: 'Pointer wrap-up',
	description: '7 scenario questions on windows and pairs.',
	topic: 'sliding-window',
	estimatedMinutes: 4,
	progressKey: 'advent-01-wrap',
	questions: [
		{ kind: 'multiple-choice', id: 'w1', prompt: 'Sum=30 target=18; first move?', options: [ {id:'A',label:'A',text:'Expand right'}, {id:'B',label:'B',text:'Shrink left'}, {id:'C',label:'C',text:'Reset'}, {id:'D',label:'D',text:'Binary search'} ], correctOptionId: 'B', correctFeedback: { message: 'Trim to drop sum.' }, explanation: 'Shrinking reduces sum with positives.' },
		{ kind: 'multiple-choice', id: 'w2', prompt: 'Why track min length?', options: [ {id:'A',label:'A',text:'Sum equals length'}, {id:'B',label:'B',text:'Need best after each shrink'}, {id:'C',label:'C',text:'For sorting'}, {id:'D',label:'D',text:'For recursion'} ], correctOptionId: 'B', correctFeedback: { message: 'Update answer when valid window exists.' } },
		{ kind: 'type-answer', id: 'w3', prompt: 'Return if no window meets target?', answer: '0', acceptableAnswers: ['0'], correctFeedback: { message: 'Zero length signals impossible.' } },
		{ kind: 'multiple-choice', id: 'w4', prompt: 'Two-sum in unsorted array fastest is…', options: [ {id:'A',label:'A',text:'Sort then two-pointer'}, {id:'B',label:'B',text:'Hash map in O(n)'}, {id:'C',label:'C',text:'Brute force'}, {id:'D',label:'D',text:'DFS'} ], correctOptionId: 'B', correctFeedback: { message: 'Hash map keeps O(n).' }, explanation: 'Sorting changes indices.' },
		{ kind: 'multiple-choice', id: 'w5', prompt: 'When keep left == right allowed?', options: [ {id:'A',label:'A',text:'Looking for pair of same index'}, {id:'B',label:'B',text:'Never'}, {id:'C',label:'C',text:'When array length 1'}, {id:'D',label:'D',text:'Only after loop ends'} ], correctOptionId: 'C', correctFeedback: { message: 'Single element case.' } },
		{ kind: 'multiple-choice', id: 'w6', prompt: 'Duplicate numbers require?', options: [ {id:'A',label:'A',text:'Stable tie-break rules'}, {id:'B',label:'B',text:'Skip them'}, {id:'C',label:'C',text:'Reverse array'}, {id:'D',label:'D',text:'Use floats'} ], correctOptionId: 'A', correctFeedback: { message: 'Pick smallest left index per spec.' } },
		{ kind: 'info-card', id: 'w7', prompt: 'Pointer hygiene', body: 'Move one pointer at a time, guard against overflow in other languages, and always verify boundaries before indexing.' }
	]
});

const day1Problems: CodeProblem[] = [
	{
		slug: 'advent-01-p1',
		title: 'Twin Sum Search',
		topics: ['two-pointers', 'sorted array'],
		difficulty: 'easy',
		description:
			'Given a sorted list of gift weights and a target T, find two distinct indices whose values sum to T. Use 1-based indices. If multiple answers exist, return the pair with the smallest left index; if ties remain, choose the smallest right index. If no pair exists, output "-1 -1".',
		inputFormat:
			'First line: integer n (2 ≤ n ≤ 2e5) and target T. Second line: n integers in non-decreasing order.',
		constraints: ['2 ≤ n ≤ 200000', '-1e9 ≤ value ≤ 1e9', '-1e9 ≤ T ≤ 1e9'],
		examples: [
			{
				title: 'Simple hit',
				input: '5 7\n1 3 4 6 8',
				output: '2 3',
				explanation: '3 + 4 = 7; smallest left index.'
			},
			{
				title: 'No solution',
				input: '4 4\n2 5 9 11',
				output: '-1 -1',
				explanation: 'No pair sums to 4.'
			},
			{
				title: 'Duplicates allowed',
				input: '6 9\n1 1 2 3 5 8',
				output: '1 6',
				explanation: '1 + 8 = 9; leftmost index used.'
			}
		],
		tests: [
			{ input: '5 7\n1 3 4 6 8', output: '2 3', explanation: 'Example 1' },
			{ input: '4 4\n2 5 9 11', output: '-1 -1', explanation: 'Example 2' },
			{ input: '6 9\n1 1 2 3 5 8', output: '1 6', explanation: 'Example 3' },
			{ input: '6 10\n1 2 4 6 6 8', output: '2 6', explanation: '2 + 8 = 10' },
			{ input: '3 6\n1 3 5', output: '1 3', explanation: '1 + 5 = 6' },
			{ input: '7 12\n-5 -1 0 4 6 8 10', output: '4 6', explanation: '4 + 8 = 12' },
			{ input: '5 0\n-3 -2 1 4 9', output: '-1 -1', explanation: 'No zero pair' },
			{ input: '5 14\n1 6 7 7 8', output: '2 5', explanation: '6 + 8 = 14' },
			{ input: '5 -4\n-7 -3 -1 4 10', output: '2 3', explanation: '-3 + -1 = -4' },
			{ input: '8 1\n-2 -1 0 1 2 3 4 5', output: '2 5', explanation: '-1 + 2 = 1 (smaller left than -2+3)' }
		],
		hints: [
			'Start pointers at both ends of the sorted list.',
			'If the sum is too small, move the left pointer right; if too large, move the right pointer left.',
			'Return "-1 -1" when pointers cross with no match.'
		],
		solution: {
			language: 'python',
			code: 'def find_pair(nums, target):\n    i, j = 0, len(nums) - 1\n    best = (-1, -1)\n    while i < j:\n        s = nums[i] + nums[j]\n        if s == target:\n            best = (i + 1, j + 1)\n            j -= 1  # try to shrink right to keep smallest right index with same left\n        elif s < target:\n            i += 1\n        else:\n            j -= 1\n    return best\n\nif __name__ == \"__main__\":\n    import sys\n    data = sys.stdin.read().strip().split()\n    if not data:\n        sys.exit(0)\n    n = int(data[0]); target = int(data[1])\n    nums = list(map(int, data[2:2+n]))\n    a, b = find_pair(nums, target)\n    print(a, b)\n'
		},
		metadataVersion: 1
	},
	{
		slug: 'advent-01-p2',
		title: 'Tight Gift Window',
		topics: ['sliding window', 'prefix sums'],
		difficulty: 'medium',
		description:
			'Given a list of positive integers and a target S, find the minimal length of a contiguous subarray with sum ≥ S. Return 0 if no such window exists.',
		inputFormat: 'First line: n and S (1 ≤ n ≤ 2e5). Second line: n positive integers.',
		constraints: ['1 ≤ n ≤ 200000', '1 ≤ value ≤ 1e9', '1 ≤ S ≤ 1e14'],
		examples: [
			{ title: 'Classic window', input: '6 7\n2 3 1 2 4 3', output: '2', explanation: 'Window [4,3] sum 7.' },
			{ title: 'No window', input: '3 11\n1 2 3', output: '0', explanation: 'Total 6 < 11.' },
			{ title: 'Whole array', input: '5 5\n1 1 1 1 1', output: '5', explanation: 'Need every element.' }
		],
		tests: [
			{ input: '6 7\n2 3 1 2 4 3', output: '2', explanation: 'Example 1' },
			{ input: '3 11\n1 2 3', output: '0', explanation: 'Example 2' },
			{ input: '5 5\n1 1 1 1 1', output: '5', explanation: 'Example 3' },
			{ input: '8 15\n5 1 3 5 10 7 4 9', output: '2', explanation: '10 + 7 works length 2' },
			{ input: '1 4\n5', output: '1', explanation: 'Single element meets target' },
			{ input: '4 8\n2 2 2 2', output: '4', explanation: 'Need all elements' },
			{ input: '7 9\n2 3 5 2 1 1 1', output: '3', explanation: '3+5+2=10 is smallest valid window' },
			{ input: '5 3\n1 2 1 1 1', output: '2', explanation: 'Window [1,2]' },
			{ input: '6 12\n4 4 4 4 4 4', output: '3', explanation: 'Any three consecutive give 12' },
			{ input: '6 50\n8 7 6 5 4 3', output: '0', explanation: 'Total sum 33 < 50' }
		],
		hints: [
			'Maintain a left pointer and running sum.',
			'Expand right, then shrink left while sum stays ≥ S.',
			'Track the minimum length found after each shrink.'
		],
		solution: {
			language: 'python',
			code: 'import sys\n\ndef min_window(nums, target):\n    left = 0\n    current = 0\n    best = float(\"inf\")\n    for right, val in enumerate(nums):\n        current += val\n        while current >= target:\n            best = min(best, right - left + 1)\n            current -= nums[left]\n            left += 1\n    return 0 if best == float(\"inf\") else best\n\nif __name__ == \"__main__\":\n    data = list(map(int, sys.stdin.read().strip().split()))\n    if not data:\n        sys.exit(0)\n    n, target = data[0], data[1]\n    nums = data[2:2+n]\n    print(min_window(nums, target))\n'
		},
		metadataVersion: 1
	}
];

const day1Bundle: AdventSessionBundle = {
	day: 1,
	session: {
		id: 'advent-01',
		title: 'Two-Pointer Trail',
		summary: 'Use paired and sliding windows to move faster than brute force.',
		tagline: 'Glide along sorted lists without turning back.',
		emoji: '🧣',
		createdAt: baseDate(1),
		status: 'ready',
		topics: ['two-pointers', 'sliding window'],
		plan: [
			{
				id: 'advent-01-warmup',
				kind: 'quiz',
				title: 'Warmup pointers',
				progressKey: 'advent-01-warmup',
				summary: 'Refresher on paired indices and windows.'
			},
			{
				id: 'advent-01-p1',
				kind: 'problem',
				title: 'Twin Sum Search',
				difficulty: 'easy',
				topic: 'two-pointers',
				summary: 'Find two numbers adding to a target in a sorted list.'
			},
			{
				id: 'advent-01-p2',
				kind: 'problem',
				title: 'Tight Gift Window',
				difficulty: 'medium',
				topic: 'sliding-window',
				summary: 'Smallest window with sum at least a target.'
			},
			{
				id: 'advent-01-wrap',
				kind: 'quiz',
				title: 'Wrap-up pointers',
				progressKey: 'advent-01-wrap',
				summary: 'Apply windows to edge cases.'
			}
		]
	} satisfies Session,
	quizzes: [makePointerWarmup(), makePointerWrap()] satisfies QuizDefinition[],
	problems: day1Problems
};

// TODO: Populate days 2-5 similarly.
export const adventBundles: AdventSessionBundle[] = [day1Bundle];

export function getBundleByDay(day: number): AdventSessionBundle | undefined {
	return adventBundles.find((bundle) => bundle.day === day);
}
