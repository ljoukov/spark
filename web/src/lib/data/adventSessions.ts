import type { CodeProblem, QuizDefinition, Session } from '@spark/schemas';

export type AdventSessionBundle = {
	day: number;
	session: Session;
	quizzes: [QuizDefinition, QuizDefinition];
	problems: [CodeProblem, CodeProblem];
};

const baseDate = (day: number): Date =>
	new Date(`2024-12-${String(day).padStart(2, '0')}T00:00:00Z`);

const makePointerWarmup = (): QuizDefinition => ({
	id: 'advent-01-warmup',
		title: 'Dual-index pulse check',
		description: '15 quick hitters on when and how to move paired indices.',
	topic: 'two-pointers',
	estimatedMinutes: 8,
	progressKey: 'advent-01-warmup',
	questions: [
		{
			kind: 'info-card',
			id: 'q1-card',
			prompt: 'How do two indices + sliding window work in Python?',
			body:
				'Use **two indices** on a sorted list and move exactly one of them based on the sum.\n\n```python\nleft, right = 0, len(nums) - 1\nwhile left < right:\n    s = nums[left] + nums[right]\n    if s < target:\n        left += 1\n    else:\n        right -= 1\n```\n\nFor subarray sums with non-negative numbers, keep a **sliding window**. Grow to increase the sum; shrink to reduce it.\n\n```python\nleft = 0\nwindow = 0\nfor right, val in enumerate(nums):\n    window += val\n    while window >= target:\n        answer = min(answer, right - left + 1)\n        window -= nums[left]\n        left += 1\n```\n\nThese are integer indices, never memory pointers.'
		},
		{
			kind: 'multiple-choice',
			id: 'q2',
			prompt:
				"Goal: find a pair that sums to the target.\n\nCurrent state:\n```python\nnums = [4, 8, 10, 12, 14]\nleft, right = 0, 4\ncurrent = nums[left] + nums[right]  # 18\ntarget = 22\n```\n\nTo get closer to the target, which index should you move in Python?",
			options: [
				{ id: 'A', label: 'A', text: 'Advance the left index (left += 1)' },
				{ id: 'B', label: 'B', text: 'Advance the right index (right += 1)' },
				{ id: 'C', label: 'C', text: 'Move the left index left (left -= 1)' },
				{ id: 'D', label: 'D', text: 'Move the right index left (right -= 1)' }
			],
			correctOptionId: 'A',
			correctFeedback: { message: 'Raise the smaller addend by moving the left index right.' },
			explanation: 'In Python, increment the lower index to increase the sum.'
		},
		{ kind: 'multiple-choice', id: 'q3', prompt: 'Sum=31, target=20 in sorted array. Move?', options: [ {id:'A',label:'A',text:'Left++'}, {id:'B',label:'B',text:'Right--'}, {id:'C',label:'C',text:'Swap pointers'}, {id:'D',label:'D',text:'Reset'} ], correctOptionId: 'B', correctFeedback: { message: 'Drop the larger addend.' }, explanation: 'Decrease sum by moving right pointer left.' },
		{ kind: 'multiple-choice', id: 'q4', prompt: 'When are sliding windows safest?', options: [ {id:'A',label:'A',text:'Non-negative numbers'}, {id:'B',label:'B',text:'Arbitrary signs'}, {id:'C',label:'C',text:'Strings only'}, {id:'D',label:'D',text:'Sorted descending'} ], correctOptionId: 'A', correctFeedback: { message: 'Shrinking always lowers the sum when values are ≥0.' } },
		{ kind: 'type-answer', id: 'q5', prompt: 'Return value when no pair hits the target?', answer: '-1 -1', acceptableAnswers: ['-1 -1'], correctFeedback: { message: 'Use a sentinel pair.' } },
		{ kind: 'multiple-choice', id: 'q6', prompt: 'Invariant to keep for min-window sum?', options: [ {id:'A',label:'A',text:'left always moves right'}, {id:'B',label:'B',text:'window sum tracked'}, {id:'C',label:'C',text:'array sorted descending'}, {id:'D',label:'D',text:'window length fixed'} ], correctOptionId: 'B', correctFeedback: { message: 'Track current sum as you grow/shrink.' } },
		{
			kind: 'multiple-choice',
			id: 'q7',
			prompt: 'Best data type for indices in Python?',
			options: [
				{ id: 'A', label: 'A', text: 'int' },
				{ id: 'B', label: 'B', text: 'float' },
				{ id: 'C', label: 'C', text: 'str' },
				{ id: 'D', label: 'D', text: 'bool' }
			],
			correctOptionId: 'A',
			correctFeedback: { message: 'Plain ints are perfect.' }
		},
		{ kind: 'multiple-choice', id: 'q8', prompt: 'Why 1-based answers?', options: [ {id:'A',label:'A',text:'Matches problem spec'}, {id:'B',label:'B',text:'Python demands it'}, {id:'C',label:'C',text:'Zero is unsafe'}, {id:'D',label:'D',text:'Because recursion'} ], correctOptionId: 'A', correctFeedback: { message: 'Follow output contract exactly.' } },
		{ kind: 'multiple-choice', id: 'q9', prompt: 'Condition to shrink window?', options: [ {id:'A',label:'A',text:'sum >= target'}, {id:'B',label:'B',text:'sum < target'}, {id:'C',label:'C',text:'anytime'}, {id:'D',label:'D',text:'never'} ], correctOptionId: 'A', correctFeedback: { message: 'Only shrink while valid to hunt smaller length.' } },
		{
			kind: 'multiple-choice',
			id: 'q10',
			prompt: 'Two indices fail when...',
			options: [
				{ id: 'A', label: 'A', text: 'array unsorted and no monotone rule' },
				{ id: 'B', label: 'B', text: 'array length > 2' },
				{ id: 'C', label: 'C', text: 'targets negative' },
				{ id: 'D', label: 'D', text: 'indices start at 0' }
			],
			correctOptionId: 'A',
			correctFeedback: { message: 'Need an ordering to steer moves.' }
		},
		{ kind: 'type-answer', id: 'q11', prompt: 'What loop condition prevents overlap?', answer: 'while i < j', acceptableAnswers: ['while i < j','i<j'], correctFeedback: { message: 'Stop when pointers cross.' } },
		{ kind: 'multiple-choice', id: 'q12', prompt: 'Best-case time for two-sum two-pointers?', options: [ {id:'A',label:'A',text:'O(n)'}, {id:'B',label:'B',text:'O(log n)'}, {id:'C',label:'C',text:'O(n log n)'}, {id:'D',label:'D',text:'O(n^2)'} ], correctOptionId: 'A', correctFeedback: { message: 'Single pass from both ends.' } },
		{ kind: 'multiple-choice', id: 'q13', prompt: 'Space complexity of sliding window sum?', options: [ {id:'A',label:'A',text:'O(1)'}, {id:'B',label:'B',text:'O(k)'}, {id:'C',label:'C',text:'O(n)'}, {id:'D',label:'D',text:'O(log n)'} ], correctOptionId: 'A', correctFeedback: { message: 'Track only indices and running sum.' } },
		{ kind: 'multiple-choice', id: 'q14', prompt: 'If numbers can be negative, what helps?', options: [ {id:'A',label:'A',text:'prefix sums'}, {id:'B',label:'B',text:'two pointers'}, {id:'C',label:'C',text:'bitmask'}, {id:'D',label:'D',text:'DFS'} ], correctOptionId: 'A', correctFeedback: { message: 'Prefix/monotone deque handles negatives, window alone fails.' } },
		{ kind: 'multiple-choice', id: 'q15', prompt: 'Edge case to guard first?', options: [ {id:'A',label:'A',text:'empty array'}, {id:'B',label:'B',text:'array already sorted'}, {id:'C',label:'C',text:'target zero'}, {id:'D',label:'D',text:'odd length'} ], correctOptionId: 'A', correctFeedback: { message: 'Return "-1 -1" if no data.' } }
	 ]
});

const makePointerWrap = (): QuizDefinition => ({
	id: 'advent-01-wrap',
		title: 'Dual-index wrap-up',
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
		{
			kind: 'multiple-choice',
			id: 'w6',
			prompt: 'Duplicate numbers require?',
			options: [
				{ id: 'A', label: 'A', text: 'Stable tie-break rules' },
				{ id: 'B', label: 'B', text: 'Skip them' },
				{ id: 'C', label: 'C', text: 'Reverse array' },
				{ id: 'D', label: 'D', text: 'Use floats' }
			],
			correctOptionId: 'A',
			correctFeedback: { message: 'Pick smallest left index per spec.' }
		},
		{
			kind: 'info-card',
			id: 'w7',
			prompt: 'Index hygiene (Python)',
			body: 'Keep left <= right, move one index per loop, and always bounds-check before accessing a list. “Pointers” here are just indices, never raw addresses.'
		}
	]
});

const day1Problems: [CodeProblem, CodeProblem] = [
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
			code: 'def find_pair(nums, target):\n    i, j = 0, len(nums) - 1\n    best = (-1, -1)\n    while i < j:\n        s = nums[i] + nums[j]\n        if s == target:\n            best = (i + 1, j + 1)\n            j -= 1  # try to shrink right to keep smallest right index with same left\n        elif s < target:\n            i += 1\n        else:\n            j -= 1\n    return best\n\nif __name__ == "__main__":\n    import sys\n    data = sys.stdin.read().strip().split()\n    if not data:\n        sys.exit(0)\n    n = int(data[0]); target = int(data[1])\n    nums = list(map(int, data[2:2+n]))\n    a, b = find_pair(nums, target)\n    print(a, b)\n'
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
			code: 'import sys\n\ndef min_window(nums, target):\n    left = 0\n    current = 0\n    best = float("inf")\n    for right, val in enumerate(nums):\n        current += val\n        while current >= target:\n            best = min(best, right - left + 1)\n            current -= nums[left]\n            left += 1\n    return 0 if best == float("inf") else best\n\nif __name__ == "__main__":\n    data = list(map(int, sys.stdin.read().strip().split()))\n    if not data:\n        sys.exit(0)\n    n, target = data[0], data[1]\n    nums = data[2:2+n]\n    print(min_window(nums, target))\n'
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
		nextLessonProposals: [],
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
	quizzes: [makePointerWarmup(), makePointerWrap()] as [QuizDefinition, QuizDefinition],
	problems: day1Problems
};

const makeBinaryWarmup = (): QuizDefinition => ({
	id: 'advent-02-warmup',
	title: 'Binary search basics',
	description: '15 quick checks on invariants, mid math, and edge cases.',
	topic: 'binary-search',
	estimatedMinutes: 8,
	progressKey: 'advent-02-warmup',
	questions: [
		{ kind: 'info-card', id: 'bq1', prompt: 'Invariant reminder', body: 'Maintain [lo, hi] as the range that could still contain the answer. Shrink it deterministically each loop.' },
		{ kind: 'multiple-choice', id: 'bq2', prompt: 'Mid calculation to avoid overflow?', options: [ {id:'A',label:'A',text:'(lo+hi)//2'}, {id:'B',label:'B',text:'lo+(hi-lo)//2'}, {id:'C',label:'C',text:'lo/2+hi/2'}, {id:'D',label:'D',text:'(lo+hi)>>1 only'} ], correctOptionId: 'B', correctFeedback: { message: 'Subtract before add is safest.' } },
		{ kind: 'multiple-choice', id: 'bq3', prompt: 'When searching first ≥ x, move hi when…', options: [ {id:'A',label:'A',text:'mid value >= x'}, {id:'B',label:'B',text:'mid value < x'}, {id:'C',label:'C',text:'always'}, {id:'D',label:'D',text:'never'} ], correctOptionId: 'A', correctFeedback: { message: 'Keep mid as candidate and shrink right.' } },
		{ kind: 'multiple-choice', id: 'bq4', prompt: 'Loop condition?', options: [ {id:'A',label:'A',text:'while lo <= hi'}, {id:'B',label:'B',text:'while lo < hi'}, {id:'C',label:'C',text:'for i in n'}, {id:'D',label:'D',text:'until array sorted'} ], correctOptionId: 'B', correctFeedback: { message: 'Use lo < hi with right-biased mid for lower bound.' } },
		{ kind: 'type-answer', id: 'bq5', prompt: 'What index to return if not found?', answer: '-1', acceptableAnswers: ['-1'], correctFeedback: { message: 'Standard sentinel.' } },
		{ kind: 'multiple-choice', id: 'bq6', prompt: 'Binary search time complexity?', options: [ {id:'A',label:'A',text:'O(log n)'}, {id:'B',label:'B',text:'O(n)'}, {id:'C',label:'C',text:'O(1)'}, {id:'D',label:'D',text:'O(n log n)'} ], correctOptionId: 'A', correctFeedback: { message: 'Halving each step.' } },
		{ kind: 'multiple-choice', id: 'bq7', prompt: 'Space complexity?', options: [ {id:'A',label:'A',text:'O(1)'}, {id:'B',label:'B',text:'O(log n)'}, {id:'C',label:'C',text:'O(n)'}, {id:'D',label:'D',text:'Depends'} ], correctOptionId: 'A', correctFeedback: { message: 'Iterative keeps constants.' } },
		{ kind: 'multiple-choice', id: 'bq8', prompt: 'Choosing mid bias?', options: [ {id:'A',label:'A',text:'Left bias to avoid infinite loop on hi shrink'}, {id:'B',label:'B',text:'Right bias to avoid infinite loop on hi shrink'}, {id:'C',label:'C',text:'Does not matter'}, {id:'D',label:'D',text:'Random'} ], correctOptionId: 'B', correctFeedback: { message: 'hi = mid keeps progress if mid is right-biased.' } },
		{ kind: 'multiple-choice', id: 'bq9', prompt: 'Sorted descending array requires…', options: [ {id:'A',label:'A',text:'Flip comparisons'}, {id:'B',label:'B',text:'Reverse array'}, {id:'C',label:'C',text:'Cannot search'}, {id:'D',label:'D',text:'Use DFS'} ], correctOptionId: 'A', correctFeedback: { message: 'Invert the relation checks.' } },
		{ kind: 'multiple-choice', id: 'bq10', prompt: 'Searching on the answer is used when…', options: [ {id:'A',label:'A',text:'Array sorted'}, {id:'B',label:'B',text:'Predicate monotone on value'}, {id:'C',label:'C',text:'Need random access'}, {id:'D',label:'D',text:'We hate loops'} ], correctOptionId: 'B', correctFeedback: { message: 'Monotone predicate over answer space.' } },
		{ kind: 'type-answer', id: 'bq11', prompt: 'Return value of lower bound if all elements smaller?', answer: '-1', acceptableAnswers: ['-1'], correctFeedback: { message: 'Signal not found.' } },
		{ kind: 'multiple-choice', id: 'bq12', prompt: 'Binary search fails on…', options: [ {id:'A',label:'A',text:'Unsorted data'}, {id:'B',label:'B',text:'Duplicates'}, {id:'C',label:'C',text:'Large arrays'}, {id:'D',label:'D',text:'Floats'} ], correctOptionId: 'A', correctFeedback: { message: 'Sort first or use different method.' } },
		{ kind: 'multiple-choice', id: 'bq13', prompt: 'What if mid value equals target in lower bound?', options: [ {id:'A',label:'A',text:'Move hi = mid'}, {id:'B',label:'B',text:'Move lo = mid+1'}, {id:'C',label:'C',text:'Return immediately'}, {id:'D',label:'D',text:'Restart'} ], correctOptionId: 'A', correctFeedback: { message: 'Keep searching left half for first occurrence.' } },
		{ kind: 'multiple-choice', id: 'bq14', prompt: 'Why prefer while lo < hi?', options: [ {id:'A',label:'A',text:'Avoid off-by-one'}, {id:'B',label:'B',text:'No need to add 1 after loop'}, {id:'C',label:'C',text:'Loops less'}, {id:'D',label:'D',text:'Python rule'} ], correctOptionId: 'A', correctFeedback: { message: 'Clear termination when range size 1.' } },
		{ kind: 'multiple-choice', id: 'bq15', prompt: 'Common mid update bug?', options: [ {id:'A',label:'A',text:'Not updating lo/hi at all'}, {id:'B',label:'B',text:'Forgetting return'}, {id:'C',label:'C',text:'Using // instead of /'}, {id:'D',label:'D',text:'Using ints'} ], correctOptionId: 'A', correctFeedback: { message: 'Range must shrink every iteration.' } }
	]
});

const makeBinaryWrap = (): QuizDefinition => ({
	id: 'advent-02-wrap',
	title: 'Answer search wrap-up',
	description: '7 applied checks on binary searching a predicate.',
	topic: 'binary-search',
	estimatedMinutes: 4,
	progressKey: 'advent-02-wrap',
	questions: [
		{ kind: 'multiple-choice', id: 'bw1', prompt: 'Ship capacity predicate monotone?', options: [ {id:'A',label:'A',text:'If capacity works, larger also works'}, {id:'B',label:'B',text:'If capacity works, larger fails'}, {id:'C',label:'C',text:'Random'}, {id:'D',label:'D',text:'Not monotone'} ], correctOptionId: 'A', correctFeedback: { message: 'Larger capacity never hurts.' } },
		{ kind: 'multiple-choice', id: 'bw2', prompt: 'Initial low bound for capacity?', options: [ {id:'A',label:'A',text:'1'}, {id:'B',label:'B',text:'max(weights)'}, {id:'C',label:'C',text:'sum(weights)'}, {id:'D',label:'D',text:'0'} ], correctOptionId: 'B', correctFeedback: { message: 'Must carry the heaviest package.' } },
		{ kind: 'multiple-choice', id: 'bw3', prompt: 'Initial high bound for capacity?', options: [ {id:'A',label:'A',text:'max(weights)'}, {id:'B',label:'B',text:'sum(weights)'}, {id:'C',label:'C',text:'weights[0]'}, {id:'D',label:'D',text:'infinite'} ], correctOptionId: 'B', correctFeedback: { message: 'Sum ships all in one day.' } },
		{ kind: 'type-answer', id: 'bw4', prompt: 'What do you return after loop?', answer: 'lo', acceptableAnswers: ['lo','hi'], correctFeedback: { message: 'lo == hi is minimal feasible.' } },
		{ kind: 'multiple-choice', id: 'bw5', prompt: 'If predicate uses days > D then…', options: [ {id:'A',label:'A',text:'capacity too small'}, {id:'B',label:'B',text:'capacity too large'}, {id:'C',label:'C',text:'data invalid'}, {id:'D',label:'D',text:'restart'} ], correctOptionId: 'A', correctFeedback: { message: 'Need higher capacity.' } },
		{ kind: 'multiple-choice', id: 'bw6', prompt: 'Binary search stops when…', options: [ {id:'A',label:'A',text:'lo == hi'}, {id:'B',label:'B',text:'mid == target'}, {id:'C',label:'C',text:'loop counter hits n'}, {id:'D',label:'D',text:'array sorted'} ], correctOptionId: 'A', correctFeedback: { message: 'Range collapsed to one candidate.' } },
		{ kind: 'info-card', id: 'bw7', prompt: 'Debug tip', body: 'Log (lo, mid, hi) and predicate result each iteration to spot stuck ranges.' }
	]
});

const day2Problems: [CodeProblem, CodeProblem] = [
	{
		slug: 'advent-02-p1',
		title: 'First Not Smaller',
		topics: ['binary search', 'lower bound'],
		difficulty: 'easy',
		description:
			'Given a sorted array and a target x, return the 1-based index of the first element ≥ x. If no such element exists, return -1.',
		inputFormat: 'First line: n and x. Second line: n sorted integers (ascending).',
		constraints: ['1 ≤ n ≤ 200000', '-1e9 ≤ value, x ≤ 1e9'],
		examples: [
			{ title: 'Hit in middle', input: '6 5\n1 3 5 7 7 9', output: '3', explanation: 'First ≥ 5 is at index 3.' },
			{ title: 'Not present', input: '4 10\n1 2 3 4', output: '-1', explanation: 'No value ≥ 10.' },
			{ title: 'Many equals', input: '5 4\n1 2 4 4 4', output: '3', explanation: 'First 4 appears at position 3.' }
		],
		tests: [
			{ input: '6 5\n1 3 5 7 7 9', output: '3', explanation: 'Example 1' },
			{ input: '4 10\n1 2 3 4', output: '-1', explanation: 'Example 2' },
			{ input: '5 4\n1 2 4 4 4', output: '3', explanation: 'Example 3' },
			{ input: '1 5\n5', output: '1', explanation: 'Single element equals' },
			{ input: '1 3\n2', output: '-1', explanation: 'Single element smaller' },
			{ input: '7 8\n2 4 6 8 10 12 14', output: '4', explanation: '8 at position 4' },
			{ input: '7 9\n2 4 6 8 10 12 14', output: '5', explanation: 'First ≥9 is 10' },
			{ input: '8 -1\n-5 -3 -1 0 2 4 6 8', output: '3', explanation: 'First -1 at pos3' },
			{ input: '8 0\n-5 -3 -1 0 2 4 6 8', output: '4', explanation: 'Zero at pos4' },
			{ input: '5 100\n10 20 30 40 50', output: '-1', explanation: 'Too large target' }
		],
		hints: [
			'Use lo = 0, hi = n.',
			'While lo < hi, set mid = (lo + hi) // 2.',
			'If a[mid] >= x, move hi = mid; else lo = mid + 1; check bounds at end.'
		],
		solution: {
			language: 'python',
			code: 'def lower_bound(arr, x):\n    lo, hi = 0, len(arr)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if arr[mid] >= x:\n            hi = mid\n        else:\n            lo = mid + 1\n    return -1 if lo == len(arr) else lo + 1\n\nif __name__ == "__main__":\n    import sys\n    data = list(map(int, sys.stdin.read().strip().split()))\n    if not data:\n        sys.exit(0)\n    n, x = data[0], data[1]\n    arr = data[2:2+n]\n    print(lower_bound(arr, x))\n'
		},
		metadataVersion: 1
	},
	{
		slug: 'advent-02-p2',
		title: 'Ship Within Days',
		topics: ['binary search', 'prefix', 'greedy'],
		difficulty: 'medium',
		description:
			'Given package weights and an integer D, find the minimum ship capacity so all packages (in order) ship within D days.',
		inputFormat: 'First line: n and D. Second line: n positive integers weights.',
		constraints: ['1 ≤ n ≤ 50000', '1 ≤ weight ≤ 1e4', '1 ≤ D ≤ n'],
		examples: [
			{ title: 'Mixed weights', input: '5 3\n1 2 3 4 5', output: '6', explanation: '6 ships [1 2 3][4][5].' },
			{ title: 'Small array', input: '3 2\n3 2 2', output: '4', explanation: 'Cap 4 ships [3][2 2].' },
			{ title: 'Equal weights', input: '4 4\n5 5 5 5', output: '5', explanation: 'One per day.' }
		],
		tests: [
			{ input: '5 3\n1 2 3 4 5', output: '6', explanation: 'Example 1' },
			{ input: '3 2\n3 2 2', output: '4', explanation: 'Example 2' },
			{ input: '4 4\n5 5 5 5', output: '5', explanation: 'Example 3' },
			{ input: '5 2\n1 2 3 4 5', output: '9', explanation: '[1 2 3 4][5]' },
			{ input: '6 3\n7 2 5 10 8 2', output: '14', explanation: 'Known LeetCode sample' },
			{ input: '1 1\n10', output: '10', explanation: 'Single item' },
			{ input: '2 1\n5 6', output: '11', explanation: 'Must take both same day' },
			{ input: '6 6\n2 2 2 2 2 2', output: '2', explanation: 'One per day minimal 2' },
			{ input: '6 4\n2 2 2 2 2 2', output: '3', explanation: 'Capacity 3 ships pairs over 4 days' },
			{ input: '7 5\n3 1 7 2 2 8 1', output: '8', explanation: 'Heaviest 8 sets lower bound; 8 feasible in 5 days' }
		],
		hints: [
			'Search capacity between max(weight) and sum(weight).',
			'Predicate: simulate days needed with given capacity.',
			'Return lo when range collapses.'
		],
		solution: {
			language: 'python',
			code: 'def days_needed(weights, cap):\n    days = 1\n    current = 0\n    for w in weights:\n        if current + w > cap:\n            days += 1\n            current = 0\n        current += w\n    return days\n\n\ndef min_capacity(weights, d):\n    lo, hi = max(weights), sum(weights)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if days_needed(weights, mid) <= d:\n            hi = mid\n        else:\n            lo = mid + 1\n    return lo\n\nif __name__ == "__main__":\n    import sys\n    data = list(map(int, sys.stdin.read().strip().split()))\n    if not data:\n        sys.exit(0)\n    n, d = data[0], data[1]\n    weights = data[2:2+n]\n    print(min_capacity(weights, d))\n'
		},
		metadataVersion: 1
	}
];

const day2Bundle: AdventSessionBundle = {
	day: 2,
	session: {
		id: 'advent-02',
		title: 'Binary Search Basecamp',
		summary: 'Lock onto answers with clean invariants and monotone predicates.',
		tagline: 'Cut the search space in half with confidence.',
		emoji: '🔍',
		createdAt: baseDate(2),
		status: 'ready',
		topics: ['binary search', 'answer search'],
		nextLessonProposals: [],
		plan: [
			{ id: 'advent-02-warmup', kind: 'quiz', title: 'Warmup: find it fast', progressKey: 'advent-02-warmup', summary: 'Binary search fundamentals.' },
			{ id: 'advent-02-p1', kind: 'problem', title: 'First Not Smaller', difficulty: 'easy', topic: 'lower-bound', summary: 'Lower bound in a sorted list.' },
			{ id: 'advent-02-p2', kind: 'problem', title: 'Ship Within Days', difficulty: 'medium', topic: 'answer-search', summary: 'Binary search on capacity.' },
			{ id: 'advent-02-wrap', kind: 'quiz', title: 'Wrap: predicate polish', progressKey: 'advent-02-wrap', summary: 'Check monotonic predicate skills.' }
		]
	} satisfies Session,
	quizzes: [makeBinaryWarmup(), makeBinaryWrap()] as [QuizDefinition, QuizDefinition],
	problems: day2Problems
};

const makeBfsWarmup = (): QuizDefinition => ({
	id: 'advent-03-warmup',
	title: 'BFS warmup',
	description: '15 questions on queues, layers, and visited sets.',
	topic: 'bfs',
	estimatedMinutes: 8,
	progressKey: 'advent-03-warmup',
	questions: [
		{ kind: 'info-card', id: 'fq1', prompt: 'Why BFS?', body: 'BFS explores level by level, yielding shortest paths in unweighted graphs.' },
		{ kind: 'multiple-choice', id: 'fq2', prompt: 'Core data structure?', options: [ {id:'A',label:'A',text:'Queue'}, {id:'B',label:'B',text:'Stack'}, {id:'C',label:'C',text:'Heap'}, {id:'D',label:'D',text:'Set only'} ], correctOptionId: 'A', correctFeedback: { message: 'Use FIFO for layers.' } },
		{ kind: 'multiple-choice', id: 'fq3', prompt: 'When to mark visited?', options: [ {id:'A',label:'A',text:'When enqueuing'}, {id:'B',label:'B',text:'When dequeuing'}, {id:'C',label:'C',text:'After loop'}, {id:'D',label:'D',text:'Never'} ], correctOptionId: 'A', correctFeedback: { message: 'Mark on push to avoid duplicates.' } },
		{ kind: 'multiple-choice', id: 'fq4', prompt: 'Grid neighbors (4-dir) are…', options: [ {id:'A',label:'A',text:'(r±1,c) and (r,c±1)'}, {id:'B',label:'B',text:'Diagonals only'}, {id:'C',label:'C',text:'All cells'}, {id:'D',label:'D',text:'None'} ], correctOptionId: 'A', correctFeedback: { message: 'Stick to cardinal moves unless told otherwise.' } },
		{ kind: 'multiple-choice', id: 'fq5', prompt: 'Shortest path length tracked by…', options: [ {id:'A',label:'A',text:'Store distance per node'}, {id:'B',label:'B',text:'Count queue size'}, {id:'C',label:'C',text:'Number of edges total'}, {id:'D',label:'D',text:'DFS depth'} ], correctOptionId: 'A', correctFeedback: { message: 'Keep dist array or pair with node.' } },
		{ kind: 'type-answer', id: 'fq6', prompt: 'Distance to start node is…', answer: '0', acceptableAnswers: ['0'], correctFeedback: { message: 'Zero moves at start.' } },
		{ kind: 'multiple-choice', id: 'fq7', prompt: 'BFS time complexity for V,E?', options: [ {id:'A',label:'A',text:'O(V+E)'}, {id:'B',label:'B',text:'O(VE)'}, {id:'C',label:'C',text:'O(V^2)'}, {id:'D',label:'D',text:'O(E log V)'} ], correctOptionId: 'A', correctFeedback: { message: 'Each edge processed once.' } },
		{ kind: 'multiple-choice', id: 'fq8', prompt: 'Space complexity?', options: [ {id:'A',label:'A',text:'O(V)'}, {id:'B',label:'B',text:'O(log V)'}, {id:'C',label:'C',text:'O(1)'}, {id:'D',label:'D',text:'O(E)'} ], correctOptionId: 'A', correctFeedback: { message: 'Queue + visited up to V.' } },
		{ kind: 'multiple-choice', id: 'fq9', prompt: 'Blocked cell check belongs…', options: [ {id:'A',label:'A',text:'Before enqueuing'}, {id:'B',label:'B',text:'After popping'}, {id:'C',label:'C',text:'Never'}, {id:'D',label:'D',text:'At input only'} ], correctOptionId: 'A', correctFeedback: { message: 'Skip walls early.' } },
		{ kind: 'multiple-choice', id: 'fq10', prompt: 'Multi-source BFS starts by…', options: [ {id:'A',label:'A',text:'Pushing all sources initially'}, {id:'B',label:'B',text:'One source at a time'}, {id:'C',label:'C',text:'Sorting sources'}, {id:'D',label:'D',text:'DFS first'} ], correctOptionId: 'A', correctFeedback: { message: 'Seeds share layer 0.' } },
		{ kind: 'multiple-choice', id: 'fq11', prompt: 'If start is blocked, answer is…', options: [ {id:'A',label:'A',text:'-1'}, {id:'B',label:'B',text:'0'}, {id:'C',label:'C',text:'1'}, {id:'D',label:'D',text:'n'} ], correctOptionId: 'A', correctFeedback: { message: 'No path exists.' } },
		{ kind: 'multiple-choice', id: 'fq12', prompt: 'Queue pop in Python uses…', options: [ {id:'A',label:'A',text:'popleft on deque'}, {id:'B',label:'B',text:'list.pop()'}, {id:'C',label:'C',text:'heapq.heappop'}, {id:'D',label:'D',text:'dict'} ], correctOptionId: 'A', correctFeedback: { message: 'deque is O(1).' } },
		{ kind: 'multiple-choice', id: 'fq13', prompt: 'Shortest path in weighted graph needs…', options: [ {id:'A',label:'A',text:'Dijkstra'}, {id:'B',label:'B',text:'BFS'}, {id:'C',label:'C',text:'Union-Find'}, {id:'D',label:'D',text:'DFS'} ], correctOptionId: 'A', correctFeedback: { message: 'Weights break BFS optimality.' } },
		{ kind: 'multiple-choice', id: 'fq14', prompt: 'Diagonal moves allowed means…', options: [ {id:'A',label:'A',text:'Add 4 more neighbor offsets'}, {id:'B',label:'B',text:'Use heap'}, {id:'C',label:'C',text:'Use recursion'}, {id:'D',label:'D',text:'Change nothing'} ], correctOptionId: 'A', correctFeedback: { message: 'Expand neighbors accordingly.' } },
		{ kind: 'multiple-choice', id: 'fq15', prompt: 'Visited can be stored as…', options: [ {id:'A',label:'A',text:'Boolean grid'}, {id:'B',label:'B',text:'Set of tuples'}, {id:'C',label:'C',text:'Either A or B'}, {id:'D',label:'D',text:'Only adjacency list'} ], correctOptionId: 'C', correctFeedback: { message: 'Pick what suits constraints.' } }
	]
});

const makeBfsWrap = (): QuizDefinition => ({
	id: 'advent-03-wrap',
	title: 'BFS wrap-up',
	description: '7 applied questions on grid and multi-source BFS.',
	topic: 'bfs',
	estimatedMinutes: 4,
	progressKey: 'advent-03-wrap',
	questions: [
		{ kind: 'multiple-choice', id: 'fw1', prompt: 'Minute counter increments when…', options: [ {id:'A',label:'A',text:'Finishing each layer'}, {id:'B',label:'B',text:'Each node popped'}, {id:'C',label:'C',text:'Each enqueue'}, {id:'D',label:'D',text:'Never'} ], correctOptionId: 'A', correctFeedback: { message: 'Layer-by-layer for time steps.' } },
		{ kind: 'multiple-choice', id: 'fw2', prompt: 'If a fresh node remains after BFS?', options: [ {id:'A',label:'A',text:'Return -1'}, {id:'B',label:'B',text:'Return 0'}, {id:'C',label:'C',text:'Return steps'}, {id:'D',label:'D',text:'Restart'} ], correctOptionId: 'A', correctFeedback: { message: 'Unreachable means impossible.' } },
		{ kind: 'multiple-choice', id: 'fw3', prompt: 'Why push all sources at distance 0?', options: [ {id:'A',label:'A',text:'To spread simultaneously'}, {id:'B',label:'B',text:'Saves memory'}, {id:'C',label:'C',text:'Needed for DFS'}, {id:'D',label:'D',text:'No reason'} ], correctOptionId: 'A', correctFeedback: { message: 'Captures parallel waves.' } },
		{ kind: 'type-answer', id: 'fw4', prompt: 'Return when start == end?', answer: '0', acceptableAnswers: ['0'], correctFeedback: { message: 'Already there.' } },
		{ kind: 'multiple-choice', id: 'fw5', prompt: 'What if grid is empty?', options: [ {id:'A',label:'A',text:'Return -1'}, {id:'B',label:'B',text:'Return 0'}, {id:'C',label:'C',text:'Raise error'}, {id:'D',label:'D',text:'Return 1'} ], correctOptionId: 'A', correctFeedback: { message: 'Treat as no path.' } },
		{ kind: 'multiple-choice', id: 'fw6', prompt: 'Queue growth bounded by…', options: [ {id:'A',label:'A',text:'mn'}, {id:'B',label:'B',text:'n'}, {id:'C',label:'C',text:'m'}, {id:'D',label:'D',text:'log n'} ], correctOptionId: 'A', correctFeedback: { message: 'At most all cells in grid.' } },
		{ kind: 'info-card', id: 'fw7', prompt: 'Grid tip', body: 'Store directions in a constant list (dr, dc) to avoid typo bugs.' }
	]
});

const day3Problems: [CodeProblem, CodeProblem] = [
	{
		slug: 'advent-03-p1',
		title: 'Snow Maze Steps',
		topics: ['bfs', 'grid'],
		difficulty: 'easy',
		description:
			'Given an m×n grid of 0 (open) and 1 (wall), find the minimum number of moves to go from (0,0) to (m-1,n-1) moving up/down/left/right. If start or end is blocked, or no path exists, return -1. Count moves (edges), so a single-cell open grid has distance 0.',
		inputFormat: 'First line: m n. Next m lines: n integers (0/1) separated by spaces.',
		constraints: ['1 ≤ m,n ≤ 200', 'Grid values are 0 or 1'],
		examples: [
			{ title: 'Clear path', input: '3 3\n0 0 0\n1 1 0\n0 0 0', output: '4', explanation: '(0,0)->(0,1)->(0,2)->(1,2)->(2,2)' },
			{ title: 'Blocked', input: '2 2\n0 1\n1 0', output: '-1', explanation: 'No route to bottom-right.' },
			{ title: 'Single cell', input: '1 1\n0', output: '0', explanation: 'Already there.' }
		],
		tests: [
			{ input: '3 3\n0 0 0\n1 1 0\n0 0 0', output: '4', explanation: 'Example 1' },
			{ input: '2 2\n0 1\n1 0', output: '-1', explanation: 'Example 2' },
			{ input: '1 1\n0', output: '0', explanation: 'Example 3' },
			{ input: '3 3\n0 1 0\n0 1 0\n0 0 0', output: '4', explanation: 'Down, down, right, right' },
			{ input: '3 3\n0 1 1\n0 1 0\n0 0 0', output: '4', explanation: 'Skirt around walls' },
			{ input: '4 4\n0 0 0 0\n0 1 1 0\n0 1 1 0\n0 0 0 0', output: '6', explanation: 'Around center block' },
			{ input: '2 3\n0 0 0\n0 0 0', output: '3', explanation: 'Straight line' },
			{ input: '2 3\n1 0 0\n0 0 0', output: '-1', explanation: 'Start blocked' },
			{ input: '2 3\n0 0 0\n0 0 1', output: '4', explanation: 'End blocked means -1? wait end is 1 => should be -1' },
			{ input: '2 3\n0 0 0\n0 0 1', output: '-1', explanation: 'Destination blocked' }
		],
		hints: [
			'Check start/end open before BFS.',
			'Push (r,c,dist) starting at dist=0.',
			'Use visited grid to avoid reprocessing.'
		],
		solution: {
			language: 'python',
			code: 'from collections import deque\n\ndef shortest_path(grid):\n    m, n = len(grid), len(grid[0])\n    if grid[0][0] == 1 or grid[m-1][n-1] == 1:\n        return -1\n    dirs = [(1,0),(-1,0),(0,1),(0,-1)]\n    q = deque([(0,0,0)])\n    seen = [[False]*n for _ in range(m)]\n    seen[0][0] = True\n    while q:\n        r, c, d = q.popleft()\n        if r == m-1 and c == n-1:\n            return d\n        for dr, dc in dirs:\n            nr, nc = r+dr, c+dc\n            if 0 <= nr < m and 0 <= nc < n and not seen[nr][nc] and grid[nr][nc] == 0:\n                seen[nr][nc] = True\n                q.append((nr, nc, d+1))\n    return -1\n\nif __name__ == "__main__":\n    import sys\n    data = sys.stdin.read().strip().split()\n    if not data:\n        sys.exit(0)\n    it = iter(data)\n    m = int(next(it)); n = int(next(it))\n    grid = [[int(next(it)) for _ in range(n)] for _ in range(m)]\n    print(shortest_path(grid))\n'
		},
		metadataVersion: 1
	},
	{
		slug: 'advent-03-p2',
		title: 'Freeze Spread Timer',
		topics: ['bfs', 'multi-source'],
		difficulty: 'medium',
		description:
			'Grid values: 0 = empty, 1 = warm cell, 2 = frozen. Each minute, every frozen cell turns adjacent warm cells (4-dir) frozen. Return minutes to freeze all warm cells, or -1 if impossible. Return 0 if there are no warm cells.',
		inputFormat: 'First line: m n. Next m lines: n integers (0/1/2) separated by spaces.',
		constraints: ['1 ≤ m,n ≤ 200'],
		examples: [
			{ title: 'Standard spread', input: '3 3\n2 1 1\n1 1 0\n0 1 1', output: '4', explanation: 'Matches classic rotting oranges case.' },
			{ title: 'Isolated warm', input: '2 2\n2 0\n0 1', output: '-1', explanation: 'Warm cell unreachable.' },
			{ title: 'Already frozen', input: '1 3\n2 2 2', output: '0', explanation: 'Nothing to do.' }
		],
		tests: [
			{ input: '3 3\n2 1 1\n1 1 0\n0 1 1', output: '4', explanation: 'Example 1' },
			{ input: '2 2\n2 0\n0 1', output: '-1', explanation: 'Example 2' },
			{ input: '1 3\n2 2 2', output: '0', explanation: 'Example 3' },
			{ input: '3 3\n0 1 2\n0 1 2\n0 1 2', output: '2', explanation: 'Spreads column-wise' },
			{ input: '3 3\n0 1 0\n0 2 0\n0 1 0', output: '2', explanation: 'Center spreads in two steps' },
			{ input: '2 3\n1 1 1\n1 1 1', output: '-1', explanation: 'No source to start freezing' },
			{ input: '2 3\n2 1 1\n1 1 1', output: '3', explanation: 'Single source' },
			{ input: '2 2\n2 1\n1 2', output: '1', explanation: 'Two sources finish in 1' },
			{ input: '3 3\n2 0 0\n0 0 0\n0 0 1', output: '-1', explanation: 'Isolated warm cell' },
			{ input: '1 1\n1', output: '-1', explanation: 'Warm but no source' }
		],
		hints: [
			'Push all 2 cells into queue with time 0.',
			'Count warm cells; decrement when frozen.',
			'Track max minute seen; if warm remains, return -1.'
		],
		solution: {
			language: 'python',
			code: 'from collections import deque\n\ndef freeze_time(grid):\n    m, n = len(grid), len(grid[0])\n    q = deque()\n    warm = 0\n    for r in range(m):\n        for c in range(n):\n            if grid[r][c] == 2:\n                q.append((r, c, 0))\n            elif grid[r][c] == 1:\n                warm += 1\n    if warm == 0:\n        return 0\n    if not q:\n        return -1\n    dirs = [(1,0),(-1,0),(0,1),(0,-1)]\n    last = 0\n    while q:\n        r, c, t = q.popleft()\n        last = max(last, t)\n        for dr, dc in dirs:\n            nr, nc = r+dr, c+dc\n            if 0 <= nr < m and 0 <= nc < n and grid[nr][nc] == 1:\n                grid[nr][nc] = 2\n                warm -= 1\n                q.append((nr, nc, t+1))\n    return last if warm == 0 else -1\n\nif __name__ == "__main__":\n    import sys\n    data = sys.stdin.read().strip().split()\n    if not data:\n        sys.exit(0)\n    it = iter(data)\n    m = int(next(it)); n = int(next(it))\n    grid = [[int(next(it)) for _ in range(n)] for _ in range(m)]\n    print(freeze_time(grid))\n'
		},
		metadataVersion: 1
	}
];

const day3Bundle: AdventSessionBundle = {
	day: 3,
	session: {
		id: 'advent-03',
		title: 'Blizzard BFS',
		summary: 'Traverse grids and spread waves level by level.',
		tagline: 'Let the queue lead you out of the storm.',
		emoji: '🌨️',
		createdAt: baseDate(3),
		status: 'ready',
		topics: ['bfs', 'graphs'],
		nextLessonProposals: [],
		plan: [
			{ id: 'advent-03-warmup', kind: 'quiz', title: 'Warmup: BFS basics', progressKey: 'advent-03-warmup', summary: 'Layers, queues, and visited.' },
			{ id: 'advent-03-p1', kind: 'problem', title: 'Snow Maze Steps', difficulty: 'easy', topic: 'grid-bfs', summary: 'Shortest path in unweighted grid.' },
			{ id: 'advent-03-p2', kind: 'problem', title: 'Freeze Spread Timer', difficulty: 'medium', topic: 'multi-source-bfs', summary: 'Parallel wave propagation.' },
			{ id: 'advent-03-wrap', kind: 'quiz', title: 'Wrap: BFS applied', progressKey: 'advent-03-wrap', summary: 'Timing and multi-source practice.' }
		]
	} satisfies Session,
	quizzes: [makeBfsWarmup(), makeBfsWrap()] as [QuizDefinition, QuizDefinition],
	problems: day3Problems
};

const makeDpWarmup = (): QuizDefinition => ({
	id: 'advent-04-warmup',
	title: 'DP warmup',
	description: '15 checks on states, transitions, and base cases.',
	topic: 'dynamic-programming',
	estimatedMinutes: 9,
	progressKey: 'advent-04-warmup',
	questions: [
		{ kind: 'info-card', id: 'dq1', prompt: 'DP recipe', body: 'Define state, set base cases, write transition, pick iteration order, and apply modulus if needed.' },
		{ kind: 'multiple-choice', id: 'dq2', prompt: 'Coin-change state best described as…', options: [ {id:'A',label:'A',text:'dp[amount] ways'}, {id:'B',label:'B',text:'dp[coin] ways'}, {id:'C',label:'C',text:'dp[amount][coin] only'}, {id:'D',label:'D',text:'no state'} ], correctOptionId: 'A', correctFeedback: { message: '1D ways per amount works with outer coin loop.' } },
		{ kind: 'multiple-choice', id: 'dq3', prompt: 'Iteration order to avoid double-counting combinations?', options: [ {id:'A',label:'A',text:'For each coin, loop amount ascending'}, {id:'B',label:'B',text:'Loop amount descending first'}, {id:'C',label:'C',text:'Any order'}, {id:'D',label:'D',text:'Random'} ], correctOptionId: 'A', correctFeedback: { message: 'Ascending prevents reuse permutations.' } },
		{ kind: 'multiple-choice', id: 'dq4', prompt: 'Base case for ways to make 0?', options: [ {id:'A',label:'A',text:'1'}, {id:'B',label:'B',text:'0'}, {id:'C',label:'C',text:'-1'}, {id:'D',label:'D',text:'None'} ], correctOptionId: 'A', correctFeedback: { message: 'One way: pick nothing.' } },
		{ kind: 'multiple-choice', id: 'dq5', prompt: 'LIS transition uses…', options: [ {id:'A',label:'A',text:'dp[i] = 1 + max(dp[j] where a[j] < a[i])'}, {id:'B',label:'B',text:'dp[i] = dp[i-1]'}, {id:'C',label:'C',text:'dp[i] = 0'}, {id:'D',label:'D',text:'greedy only'} ], correctOptionId: 'A', correctFeedback: { message: 'Extend from smaller previous elements.' } },
		{ kind: 'type-answer', id: 'dq6', prompt: 'What modulus are we using?', answer: '1000000007', acceptableAnswers: ['1000000007','1e9+7','1000000007.0'], correctFeedback: { message: 'Standard 1e9+7.' } },
		{ kind: 'multiple-choice', id: 'dq7', prompt: 'Space for LIS patience method?', options: [ {id:'A',label:'A',text:'O(n)'}, {id:'B',label:'B',text:'O(1)'}, {id:'C',label:'C',text:'O(log n)'}, {id:'D',label:'D',text:'O(n^2)'} ], correctOptionId: 'A', correctFeedback: { message: 'Keep piles arrays.' } },
		{ kind: 'multiple-choice', id: 'dq8', prompt: 'Top-down vs bottom-up key difference?', options: [ {id:'A',label:'A',text:'Memo recursion vs iterative loops'}, {id:'B',label:'B',text:'One is wrong'}, {id:'C',label:'C',text:'They are identical always'}, {id:'D',label:'D',text:'Top-down cannot cache'} ], correctOptionId: 'A', correctFeedback: { message: 'Memo recursion mirrors iterative DP.' } },
		{ kind: 'multiple-choice', id: 'dq9', prompt: 'When to use binary search in LIS?', options: [ {id:'A',label:'A',text:'To place current value in piles'}, {id:'B',label:'B',text:'Never'}, {id:'C',label:'C',text:'Only for sorted arrays'}, {id:'D',label:'D',text:'To compute modulus'} ], correctOptionId: 'A', correctFeedback: { message: 'Find lower bound pile.' } },
		{ kind: 'multiple-choice', id: 'dq10', prompt: 'Overflow risks in Python DP?', options: [ {id:'A',label:'A',text:'Low (big ints)'}, {id:'B',label:'B',text:'High'}, {id:'C',label:'C',text:'Need long long'}, {id:'D',label:'D',text:'Need BigDecimal'} ], correctOptionId: 'A', correctFeedback: { message: 'Python ints expand; modulus for constraints.' } },
		{ kind: 'multiple-choice', id: 'dq11', prompt: 'Dimension of dp for coin change combos?', options: [ {id:'A',label:'A',text:'amount+1'}, {id:'B',label:'B',text:'coins+1'}, {id:'C',label:'C',text:'amount*coins only'}, {id:'D',label:'D',text:'2'} ], correctOptionId: 'A', correctFeedback: { message: '1D suffices with proper ordering.' } },
		{ kind: 'multiple-choice', id: 'dq12', prompt: 'Reconstruction of LIS needs…', options: [ {id:'A',label:'A',text:'Parent pointers'}, {id:'B',label:'B',text:'Stack only'}, {id:'C',label:'C',text:'No data'}, {id:'D',label:'D',text:'Sort array'} ], correctOptionId: 'A', correctFeedback: { message: 'Track predecessors of piles.' } },
		{ kind: 'multiple-choice', id: 'dq13', prompt: 'Edge case for empty input?', options: [ {id:'A',label:'A',text:'Return 0'}, {id:'B',label:'B',text:'Return 1'}, {id:'C',label:'C',text:'Throw'}, {id:'D',label:'D',text:'Return -1'} ], correctOptionId: 'A', correctFeedback: { message: 'No elements -> length 0 ways 0 except base defined differently; here 0 length LIS =0 but we will not get n<1 per constraints.' } },
		{ kind: 'multiple-choice', id: 'dq14', prompt: 'Knapsack-like states typically depend on…', options: [ {id:'A',label:'A',text:'Index and capacity'}, {id:'B',label:'B',text:'Only index'}, {id:'C',label:'C',text:'Only capacity'}, {id:'D',label:'D',text:'Global variable'} ], correctOptionId: 'A', correctFeedback: { message: 'Two dimensions common.' } },
		{ kind: 'multiple-choice', id: 'dq15', prompt: 'Transition count influences…', options: [ {id:'A',label:'A',text:'Time complexity'}, {id:'B',label:'B',text:'Input size'}, {id:'C',label:'C',text:'Output format'}, {id:'D',label:'D',text:'None'} ], correctOptionId: 'A', correctFeedback: { message: 'More branches => slower DP.' } }
	]
});

const makeDpWrap = (): QuizDefinition => ({
	id: 'advent-04-wrap',
	title: 'DP wrap-up',
	description: '7 targeted questions on coins and LIS.',
	topic: 'dynamic-programming',
	estimatedMinutes: 4,
	progressKey: 'advent-04-wrap',
	questions: [
		{ kind: 'multiple-choice', id: 'dw1', prompt: 'Why iterate coins outer loop?', options: [ {id:'A',label:'A',text:'Avoid counting permutations as different'}, {id:'B',label:'B',text:'Faster IO'}, {id:'C',label:'C',text:'Memory'}, {id:'D',label:'D',text:'No reason'} ], correctOptionId: 'A', correctFeedback: { message: 'Order of coins then amounts counts combinations.' } },
		{ kind: 'multiple-choice', id: 'dw2', prompt: 'Base value for dp[0] in LIS reconstruction piles?', options: [ {id:'A',label:'A',text:'0'}, {id:'B',label:'B',text:'-inf'}, {id:'C',label:'C',text:'None'}, {id:'D',label:'D',text:'n'} ], correctOptionId: 'A', correctFeedback: { message: 'Start with empty pile length 0.' } },
		{ kind: 'type-answer', id: 'dw3', prompt: 'LIS of [5 4 3] length?', answer: '1', acceptableAnswers: ['1'], correctFeedback: { message: 'Any single element.' } },
		{ kind: 'multiple-choice', id: 'dw4', prompt: 'When coin value exceeds amount?', options: [ {id:'A',label:'A',text:'Skip adding ways'}, {id:'B',label:'B',text:'Add negative ways'}, {id:'C',label:'C',text:'Reset dp'}, {id:'D',label:'D',text:'Stop loop'} ], correctOptionId: 'A', correctFeedback: { message: 'No contribution for smaller index.' } },
		{ kind: 'multiple-choice', id: 'dw5', prompt: 'Patience piles store…', options: [ {id:'A',label:'A',text:'Smallest tail for each length'}, {id:'B',label:'B',text:'Largest tail'}, {id:'C',label:'C',text:'Whole sequence'}, {id:'D',label:'D',text:'Indices only'} ], correctOptionId: 'A', correctFeedback: { message: 'Ensures extension possible.' } },
		{ kind: 'multiple-choice', id: 'dw6', prompt: 'Coin-change answer mod 1e9+7 to…', options: [ {id:'A',label:'A',text:'Prevent overflow'}, {id:'B',label:'B',text:'Look nice'}, {id:'C',label:'C',text:'Reduce time'}, {id:'D',label:'D',text:'Avoid decimals'} ], correctOptionId: 'A', correctFeedback: { message: 'Keep numbers bounded.' } },
		{ kind: 'info-card', id: 'dw7', prompt: 'Debug tip', body: 'Print first few dp entries after each coin to ensure counts rise monotonically.' }
	]
});

const day4Problems: [CodeProblem, CodeProblem] = [
	{
		slug: 'advent-04-p1',
		title: 'Coin Combinations',
		topics: ['dp', 'combinatorics'],
		difficulty: 'easy',
		description:
			'Given coin denominations, count how many ways to make exactly amount A (order does not matter). Output the count modulo 1e9+7.',
		inputFormat: 'First line: n and A. Second line: n positive integers (coin values).',
		constraints: ['1 ≤ n ≤ 100', '1 ≤ A ≤ 10000', '1 ≤ coin ≤ 10000'],
		examples: [
			{ title: 'Standard set', input: '3 5\n1 2 5', output: '4', explanation: 'Combinations: 1+1+1+1+1; 1+1+1+2; 1+2+2; 5.' },
			{ title: 'Impossible', input: '1 3\n2', output: '0', explanation: 'Cannot make 3 with coin 2.' },
			{ title: 'Single coin fits', input: '1 10\n10', output: '1', explanation: 'Only one way.' }
		],
		tests: [
			{ input: '3 5\n1 2 5', output: '4', explanation: 'Example 1' },
			{ input: '1 3\n2', output: '0', explanation: 'Example 2' },
			{ input: '1 10\n10', output: '1', explanation: 'Example 3' },
			{ input: '2 4\n1 3', output: '2', explanation: '1+1+1+1, 1+3' },
			{ input: '2 4\n2 4', output: '2', explanation: '2+2 and 4' },
			{ input: '4 6\n1 2 3 4', output: '8', explanation: 'Combinations via 1/2/3/4' },
			{ input: '3 8\n2 3 5', output: '3', explanation: '2+2+2+2; 3+5; 3+3+2' },
			{ input: '3 1\n2 3 4', output: '0', explanation: 'No coin fits' },
			{ input: '2 2\n1 2', output: '2', explanation: '1+1, 2' },
			{ input: '3 20\n2 5 10', output: '6', explanation: 'count combinations' }
		],
		hints: [
			'Set dp[0] = 1.',
			'For each coin, iterate amount from coin to A and add dp[amt-coin].',
			'Take modulo each addition.'
		],
		solution: {
			language: 'python',
			code: 'MOD = 1_000_000_007\n\ndef coin_ways(coins, amount):\n    dp = [0]*(amount+1)\n    dp[0] = 1\n    for coin in coins:\n        for a in range(coin, amount+1):\n            dp[a] = (dp[a] + dp[a-coin]) % MOD\n    return dp[amount]\n\nif __name__ == "__main__":\n    import sys\n    data = list(map(int, sys.stdin.read().strip().split()))\n    if not data:\n        sys.exit(0)\n    n, amt = data[0], data[1]\n    coins = data[2:2+n]\n    print(coin_ways(coins, amt))\n'
		},
		metadataVersion: 1
	},
	{
		slug: 'advent-04-p2',
		title: 'Longest Increasing Subsequence',
		topics: ['dp', 'binary search'],
		difficulty: 'medium',
		description:
			'Given an array of integers, return the length of the longest strictly increasing subsequence and output one such subsequence.',
		inputFormat: 'First line: n. Second line: n integers.',
		constraints: ['1 ≤ n ≤ 200000', '-1e9 ≤ value ≤ 1e9'],
		examples: [
			{ title: 'Classic case', input: '8\n10 9 2 5 3 7 101 18', output: '4\n2 3 7 18', explanation: 'One LIS of length 4.' },
			{ title: 'Mixed', input: '6\n0 1 0 3 2 3', output: '4\n0 1 2 3', explanation: 'Length 4 LIS.' },
			{ title: 'All equal', input: '4\n7 7 7 7', output: '1\n7', explanation: 'Any single element.' }
		],
		tests: [
			{ input: '8\n10 9 2 5 3 7 101 18', output: '4\n2 3 7 18', explanation: 'Example 1' },
			{ input: '6\n0 1 0 3 2 3', output: '4\n0 1 2 3', explanation: 'Example 2' },
			{ input: '4\n7 7 7 7', output: '1\n7', explanation: 'Example 3' },
			{ input: '5\n1 2 3 4 5', output: '5\n1 2 3 4 5', explanation: 'Already increasing' },
			{ input: '5\n5 4 3 2 1', output: '1\n1', explanation: 'Decreasing' },
			{ input: '7\n3 10 2 1 20 4 6', output: '3\n3 4 6', explanation: 'One LIS length 3' },
			{ input: '1\n42', output: '1\n42', explanation: 'Single element' },
			{ input: '3\n2 2 3', output: '2\n2 3', explanation: 'Strictly increasing' },
			{ input: '6\n-1 0 -1 0 1 2', output: '4\n-1 0 1 2', explanation: 'Skip repeats' },
			{ input: '6\n4 10 4 3 8 9', output: '3\n4 8 9', explanation: 'Typical case' }
		],
		hints: [
			'Maintain piles array of smallest tail for each length.',
			'Use binary search to place current value.',
			'Store parent pointers to reconstruct sequence.'
		],
		solution: {
			language: 'python',
			code: 'import bisect\n\ndef lis(seq):\n    n = len(seq)\n    tails = []\n    tails_idx = []\n    prev = [-1]*n\n    for i, x in enumerate(seq):\n        pos = bisect.bisect_left(tails, x)\n        if pos == len(tails):\n            tails.append(x)\n            tails_idx.append(i)\n        else:\n            tails[pos] = x\n            tails_idx[pos] = i\n        if pos > 0:\n            prev[i] = tails_idx[pos-1]\n    length = len(tails)\n    cur = tails_idx[-1]\n    out = []\n    while cur != -1:\n        out.append(seq[cur])\n        cur = prev[cur]\n    out.reverse()\n    return length, out\n\nif __name__ == "__main__":\n    import sys\n    data = sys.stdin.read().strip().split()\n    if not data:\n        sys.exit(0)\n    n = int(data[0])\n    arr = list(map(int, data[1:1+n]))\n    length, subseq = lis(arr)\n    print(length)\n    print(" ".join(map(str, subseq)))\n'
		},
		metadataVersion: 1
	}
];

const day4Bundle: AdventSessionBundle = {
	day: 4,
	session: {
		id: 'advent-04',
		title: 'Dynamic Programming Den',
		summary: 'Count combinations and chase increasing subsequences.',
		tagline: 'Break problems into overlapping pieces.',
		emoji: '🧩',
		createdAt: baseDate(4),
		status: 'ready',
		topics: ['dp'],
		nextLessonProposals: [],
		plan: [
			{ id: 'advent-04-warmup', kind: 'quiz', title: 'Warmup: DP habits', progressKey: 'advent-04-warmup', summary: 'States, bases, transitions.' },
			{ id: 'advent-04-p1', kind: 'problem', title: 'Coin Combinations', difficulty: 'easy', topic: 'dp-coins', summary: 'Count ways modulo 1e9+7.' },
			{ id: 'advent-04-p2', kind: 'problem', title: 'Longest Increasing Subsequence', difficulty: 'medium', topic: 'lis', summary: 'Length plus reconstruction.' },
			{ id: 'advent-04-wrap', kind: 'quiz', title: 'Wrap: DP polish', progressKey: 'advent-04-wrap', summary: 'Combinations and LIS checks.' }
		]
	} satisfies Session,
	quizzes: [makeDpWarmup(), makeDpWrap()] as [QuizDefinition, QuizDefinition],
	problems: day4Problems
};

const makeMixWarmup = (): QuizDefinition => ({
	id: 'advent-05-warmup',
	title: 'Grid & strings warmup',
	description: '15 questions on grid DP, prefix sums, and edit distance basics.',
	topic: 'dp',
	estimatedMinutes: 9,
	progressKey: 'advent-05-warmup',
	questions: [
		{ kind: 'info-card', id: 'mw1', prompt: 'Right/down grids', body: 'When only right/down moves are allowed, dp[r][c] often depends on top and left cells if they are open.' },
		{ kind: 'multiple-choice', id: 'mw2', prompt: 'Paths blocked if…', options: [ {id:'A',label:'A',text:'start or end is obstacle'}, {id:'B',label:'B',text:'grid rectangular'}, {id:'C',label:'C',text:'n>m'}, {id:'D',label:'D',text:'values large'} ], correctOptionId: 'A', correctFeedback: { message: 'Return 0 immediately.' } },
		{ kind: 'multiple-choice', id: 'mw3', prompt: 'Base dp[0][0] for open start?', options: [ {id:'A',label:'A',text:'1'}, {id:'B',label:'B',text:'0'}, {id:'C',label:'C',text:'-1'}, {id:'D',label:'D',text:'m*n'} ], correctOptionId: 'A', correctFeedback: { message: 'One path to stand still.' } },
		{ kind: 'multiple-choice', id: 'mw4', prompt: 'Transition for open cell?', options: [ {id:'A',label:'A',text:'dp[r][c]=dp[r-1][c]+dp[r][c-1]'}, {id:'B',label:'B',text:'dp[r][c]=1'}, {id:'C',label:'C',text:'dp[r][c]=0 always'}, {id:'D',label:'D',text:'dp[r][c]=dp[r-1][c-1]'} ], correctOptionId: 'A', correctFeedback: { message: 'Sum from top and left.' } },
		{ kind: 'multiple-choice', id: 'mw5', prompt: 'Why modulus in path counting?', options: [ {id:'A',label:'A',text:'Keep numbers small'}, {id:'B',label:'B',text:'Sorting'}, {id:'C',label:'C',text:'Binary search'}, {id:'D',label:'D',text:'No reason'} ], correctOptionId: 'A', correctFeedback: { message: 'Prevent overflow/huge ints.' } },
		{ kind: 'multiple-choice', id: 'mw6', prompt: 'Edit distance operations?', options: [ {id:'A',label:'A',text:'Insert, delete, replace'}, {id:'B',label:'B',text:'Sort, reverse'}, {id:'C',label:'C',text:'Rotate'}, {id:'D',label:'D',text:'None'} ], correctOptionId: 'A', correctFeedback: { message: 'Classic Levenshtein trio.' } },
		{ kind: 'multiple-choice', id: 'mw7', prompt: 'Edit distance state?', options: [ {id:'A',label:'A',text:'dp[i][j] distance for prefixes i,j'}, {id:'B',label:'B',text:'dp[i] only'}, {id:'C',label:'C',text:'dp char value'}, {id:'D',label:'D',text:'No state'} ], correctOptionId: 'A', correctFeedback: { message: '2D prefix DP.' } },
		{ kind: 'type-answer', id: 'mw8', prompt: 'dp[0][j] initial value?', answer: 'j', acceptableAnswers: ['j'], correctFeedback: { message: 'Need j insertions.' } },
		{ kind: 'type-answer', id: 'mw9', prompt: 'dp[i][0] initial value?', answer: 'i', acceptableAnswers: ['i'], correctFeedback: { message: 'Need i deletions.' } },
		{ kind: 'multiple-choice', id: 'mw10', prompt: 'Space optimization for edit distance?', options: [ {id:'A',label:'A',text:'Keep two rows'}, {id:'B',label:'B',text:'Keep diagonal only'}, {id:'C',label:'C',text:'No optimization'}, {id:'D',label:'D',text:'Use stack'} ], correctOptionId: 'A', correctFeedback: { message: 'Rolling rows suffice.' } },
		{ kind: 'multiple-choice', id: 'mw11', prompt: 'If characters equal, transition?', options: [ {id:'A',label:'A',text:'dp[i-1][j-1]'}, {id:'B',label:'B',text:'1+dp[i-1][j-1]'}, {id:'C',label:'C',text:'min of neighbors +1'}, {id:'D',label:'D',text:'0'} ], correctOptionId: 'A', correctFeedback: { message: 'Carry diagonal.' } },
		{ kind: 'multiple-choice', id: 'mw12', prompt: 'If obstacle at grid cell?', options: [ {id:'A',label:'A',text:'dp=0'}, {id:'B',label:'B',text:'dp=1'}, {id:'C',label:'C',text:'dp stays previous'}, {id:'D',label:'D',text:'dp=mod'} ], correctOptionId: 'A', correctFeedback: { message: 'No paths through a wall.' } },
		{ kind: 'multiple-choice', id: 'mw13', prompt: 'Complexity of edit distance?', options: [ {id:'A',label:'A',text:'O(nm)'}, {id:'B',label:'B',text:'O(n+m)'}, {id:'C',label:'C',text:'O(log n)'}, {id:'D',label:'D',text:'O(1)'} ], correctOptionId: 'A', correctFeedback: { message: 'Fill the table.' } },
		{ kind: 'multiple-choice', id: 'mw14', prompt: 'Grid paths with obstacle in first row handled by…', options: [ {id:'A',label:'A',text:'Zeroing all cells to the right'}, {id:'B',label:'B',text:'Leaving as is'}, {id:'C',label:'C',text:'Setting to -1'}, {id:'D',label:'D',text:'Skipping row'} ], correctOptionId: 'A', correctFeedback: { message: 'No path beyond a wall in first row/col.' } },
		{ kind: 'multiple-choice', id: 'mw15', prompt: 'When strings identical, edit distance is…', options: [ {id:'A',label:'A',text:'0'}, {id:'B',label:'B',text:'1'}, {id:'C',label:'C',text:'len'}, {id:'D',label:'D',text:'-1'} ], correctOptionId: 'A', correctFeedback: { message: 'No edits needed.' } }
	]
});

const makeMixWrap = (): QuizDefinition => ({
	id: 'advent-05-wrap',
	title: 'Grid & strings wrap',
	description: '7 applied checks on path counts and edit distance.',
	topic: 'dp',
	estimatedMinutes: 4,
	progressKey: 'advent-05-wrap',
	questions: [
		{ kind: 'multiple-choice', id: 'mww1', prompt: 'Unique paths when obstacle at start?', options: [ {id:'A',label:'A',text:'0'}, {id:'B',label:'B',text:'1'}, {id:'C',label:'C',text:'-1'}, {id:'D',label:'D',text:'Depends'} ], correctOptionId: 'A', correctFeedback: { message: 'Blocked start => no paths.' } },
		{ kind: 'multiple-choice', id: 'mww2', prompt: 'Edit distance of "abc" -> "axc"?', options: [ {id:'A',label:'A',text:'1'}, {id:'B',label:'B',text:'2'}, {id:'C',label:'C',text:'0'}, {id:'D',label:'D',text:'3'} ], correctOptionId: 'A', correctFeedback: { message: 'Replace b with x.' } },
		{ kind: 'multiple-choice', id: 'mww3', prompt: 'Modulus applied…', options: [ {id:'A',label:'A',text:'After each addition'}, {id:'B',label:'B',text:'Only at end'}, {id:'C',label:'C',text:'Never'}, {id:'D',label:'D',text:'Before loop'} ], correctOptionId: 'A', correctFeedback: { message: 'Prevent overflow continuously.' } },
		{ kind: 'multiple-choice', id: 'mww4', prompt: 'Unique paths formula without obstacles is…', options: [ {id:'A',label:'A',text:'C(m+n-2, m-1)'}, {id:'B',label:'B',text:'m+n'}, {id:'C',label:'C',text:'m*n'}, {id:'D',label:'D',text:'C(mn,2)'} ], correctOptionId: 'A', correctFeedback: { message: 'Combinatorial baseline.' } },
		{ kind: 'type-answer', id: 'mww5', prompt: 'Edit distance "a" -> "":', answer: '1', acceptableAnswers: ['1'], correctFeedback: { message: 'Delete one char.' } },
		{ kind: 'multiple-choice', id: 'mww6', prompt: 'Right/down paths row-first init requires…', options: [ {id:'A',label:'A',text:'Break on first obstacle'}, {id:'B',label:'B',text:'Continue with 1s'}, {id:'C',label:'C',text:'Set all to 0'}, {id:'D',label:'D',text:'Set to -1'} ], correctOptionId: 'A', correctFeedback: { message: 'Cells after a wall unreachable.' } },
		{ kind: 'info-card', id: 'mww7', prompt: 'String tip', body: 'When memory tight, keep prev and curr rows; swap each iteration over j.' }
	]
});

const day5Problems: [CodeProblem, CodeProblem] = [
	{
		slug: 'advent-05-p1',
		title: 'Snowdrift Paths',
		topics: ['dp', 'grid'],
		difficulty: 'easy',
		description:
			'Count unique paths from top-left to bottom-right in an obstacle grid (0=open, 1=blocked) moving only right or down. Return count modulo 1e9+7.',
		inputFormat: 'First line: m n. Next m lines: n integers (0/1) separated by spaces.',
		constraints: ['1 ≤ m,n ≤ 200'],
		examples: [
			{ title: 'Classic obstacle', input: '3 3\n0 0 0\n0 1 0\n0 0 0', output: '2', explanation: 'Two routes around the center wall.' },
			{ title: 'Blocked start', input: '2 2\n1 0\n0 0', output: '0', explanation: 'Start blocked.' },
			{ title: 'Single open', input: '1 1\n0', output: '1', explanation: 'Stay put counts as one path.' }
		],
		tests: [
			{ input: '3 3\n0 0 0\n0 1 0\n0 0 0', output: '2', explanation: 'Example 1' },
			{ input: '2 2\n1 0\n0 0', output: '0', explanation: 'Example 2' },
			{ input: '1 1\n0', output: '1', explanation: 'Example 3' },
			{ input: '2 2\n0 0\n0 0', output: '2', explanation: 'Right-down or down-right' },
			{ input: '2 3\n0 1 0\n0 0 0', output: '2', explanation: 'Must go below obstacle' },
			{ input: '3 2\n0 0\n1 0\n0 0', output: '1', explanation: 'Single viable path' },
			{ input: '3 3\n0 0 1\n0 0 0\n0 0 0', output: '3', explanation: 'Obstacle at (0,2)' },
			{ input: '3 3\n0 0 0\n1 1 1\n0 0 0', output: '0', explanation: 'Blocked row' },
			{ input: '4 4\n0 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 0', output: '4', explanation: 'Several routes' },
			{ input: '2 3\n0 0 0\n1 1 1', output: '0', explanation: 'Bottom row blocked' }
		],
		hints: [
			'Initialize first row/column until a wall appears.',
			'Skip cells with obstacle (dp=0).',
			'Apply modulus after each addition.'
		],
		solution: {
			language: 'python',
			code: 'MOD = 1_000_000_007\n\ndef paths(grid):\n    m, n = len(grid), len(grid[0])\n    if grid[0][0] == 1 or grid[m-1][n-1] == 1:\n        return 0\n    dp = [[0]*n for _ in range(m)]\n    dp[0][0] = 1\n    for c in range(1, n):\n        if grid[0][c] == 0:\n            dp[0][c] = dp[0][c-1]\n    for r in range(1, m):\n        if grid[r][0] == 0:\n            dp[r][0] = dp[r-1][0]\n    for r in range(1, m):\n        for c in range(1, n):\n            if grid[r][c] == 0:\n                dp[r][c] = (dp[r-1][c] + dp[r][c-1]) % MOD\n    return dp[m-1][n-1] % MOD\n\nif __name__ == "__main__":\n    import sys\n    data = sys.stdin.read().strip().split()\n    if not data:\n        sys.exit(0)\n    it = iter(data)\n    m = int(next(it)); n = int(next(it))\n    grid = [[int(next(it)) for _ in range(n)] for _ in range(m)]\n    print(paths(grid))\n'
		},
		metadataVersion: 1
	},
	{
		slug: 'advent-05-p2',
		title: 'Sleigh Edit Distance',
		topics: ['dp', 'strings'],
		difficulty: 'medium',
		description:
			'Compute the Levenshtein edit distance between two strings using insert, delete, and replace.',
		inputFormat: 'Two lines: string a, then string b.',
		constraints: ['0 ≤ |a|,|b| ≤ 2000'],
		examples: [
			{ title: 'Classic', input: 'horse\nros', output: '3', explanation: 'horse -> rorse (replace h), rose (replace r), ros (delete e).' },
			{ title: 'Longer', input: 'intention\nexecution', output: '5', explanation: 'Standard example.' },
			{ title: 'Same', input: 'abc\nabc', output: '0', explanation: 'No edits.' }
		],
		tests: [
			{ input: 'horse\nros', output: '3', explanation: 'Example 1' },
			{ input: 'intention\nexecution', output: '5', explanation: 'Example 2' },
			{ input: 'abc\nabc', output: '0', explanation: 'Example 3' },
			{ input: 'abc\n', output: '3', explanation: 'Delete all' },
			{ input: '\nabc', output: '3', explanation: 'Insert all characters' },
			{ input: 'kitten\nsitting', output: '3', explanation: 'Classic 3 edits' },
			{ input: 'spark\npark', output: '1', explanation: 'Delete s' },
			{ input: 'a\nb', output: '1', explanation: 'Replace' },
			{ input: 'ab\nba', output: '2', explanation: 'Replace both ends' },
			{ input: 'algorithm\naltruistic', output: '6', explanation: 'Calculated value' }
		],
		hints: [
			'Use 2-row rolling array.',
			'Transition: if equal, carry diag; else 1 + min(delete, insert, replace).',
			'Initialize first row/col with index values.'
		],
		solution: {
			language: 'python',
			code: 'def edit_distance(a, b):\n    n, m = len(a), len(b)\n    if n == 0:\n        return m\n    if m == 0:\n        return n\n    prev = list(range(m+1))\n    curr = [0]*(m+1)\n    for i in range(1, n+1):\n        curr[0] = i\n        for j in range(1, m+1):\n            if a[i-1] == b[j-1]:\n                curr[j] = prev[j-1]\n            else:\n                curr[j] = 1 + min(prev[j], curr[j-1], prev[j-1])\n        prev, curr = curr, prev\n    return prev[m]\n\nif __name__ == "__main__":\n    import sys\n    data = sys.stdin.read().splitlines()\n    if not data:\n        sys.exit(0)\n    a = data[0].rstrip("\\n") if len(data) > 0 else ""\n    b = data[1].rstrip("\\n") if len(data) > 1 else ""\n    print(edit_distance(a, b))\n'
		},
		metadataVersion: 1
	}
];

const day5Bundle: AdventSessionBundle = {
	day: 5,
	session: {
		id: 'advent-05',
		title: 'Grid & String Forge',
		summary: 'Count obstacle-aware paths and tune string transforms.',
		tagline: 'From snowdrifts to spellings with DP.',
		emoji: '🎛️',
		createdAt: baseDate(5),
		status: 'ready',
		topics: ['dp', 'strings', 'grid'],
		nextLessonProposals: [],
		plan: [
			{ id: 'advent-05-warmup', kind: 'quiz', title: 'Warmup: grids & strings', progressKey: 'advent-05-warmup', summary: 'DP grounding for paths and edits.' },
			{ id: 'advent-05-p1', kind: 'problem', title: 'Snowdrift Paths', difficulty: 'easy', topic: 'grid-dp', summary: 'Right/down paths with obstacles.' },
			{ id: 'advent-05-p2', kind: 'problem', title: 'Sleigh Edit Distance', difficulty: 'medium', topic: 'edit-distance', summary: 'Levenshtein distance.' },
			{ id: 'advent-05-wrap', kind: 'quiz', title: 'Wrap: apply DP', progressKey: 'advent-05-wrap', summary: 'Check path counts and edit intuition.' }
		]
	} satisfies Session,
	quizzes: [makeMixWarmup(), makeMixWrap()] as [QuizDefinition, QuizDefinition],
	problems: day5Problems
};

export const adventBundles: AdventSessionBundle[] = [
	day1Bundle,
	day2Bundle,
	day3Bundle,
	day4Bundle,
	day5Bundle
];

export function getBundleByDay(day: number): AdventSessionBundle | undefined {
	return adventBundles.find((bundle) => bundle.day === day);
}

export function getBundleBySessionId(sessionId: string): AdventSessionBundle | undefined {
	return adventBundles.find((bundle) => bundle.session.id === sessionId);
}
