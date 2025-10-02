import type { PageLoad } from './$types';

type ProblemDifficulty = 'Easy' | 'Medium' | 'Hard';

type Problem = {
	id: string;
	title: string;
	difficulty: ProblemDifficulty;
	category: string;
	tags: string[];
	estimatedTime: string;
	markdown: string;
	starterCode: string;
	hints: string[];
};

const MOCK_PROBLEM: Problem = {
	id: 'balanced-pivot',
	title: 'Balanced Pivot Index',
	difficulty: 'Medium',
	category: 'Arrays',
	tags: ['prefix-sum', 'array traversal'],
	estimatedTime: '25 minutes',
	hints: [
		'Consider precomputing prefix sums to answer balance checks in O(1).',
		'You do not need nested loops if you know the total sum of the array ahead of time.',
		'Watch out for negative values when evaluating both sides of the pivot index.'
	],
	markdown: String.raw`## Problem
You are given an integer array \`nums\`. A pivot index is an index where the sum of all the numbers strictly to the left of the index is equal to the sum of all the numbers strictly to the right of the index.

Return the leftmost pivot index. If no such index exists, return \`-1\`.

The array can include negative numbers. Your solution should run in linear time.

## Tasks
- Return the first index that balances the array.
- If multiple pivots exist, choose the smallest index.
- If no pivot satisfies the condition, return \`-1\`.

## Constraints
- \`1 <= nums.length <= 10^5\`
- \`-10^3 <= nums[i] <= 10^3\`

## Examples

### Example 1

Input

\`\`\`
nums = [1, 7, 3, 6, 5, 6]
\`\`\`

Output: \`3\`

Explanation: The sum of the numbers to the left of index 3 (1 + 7 + 3 = 11) equals the sum of the numbers to the right (5 + 6 = 11).

### Example 2

Input

\`\`\`
nums = [2, 1, -1]
\`\`\`

Output: \`0\`

Explanation: 0 is a pivot index because the left side sum is 0 (no elements) and the right side sum is \`1 + (-1) = 0\`.

### Example 3

Input

\`\`\`
nums = [2, 1, 1]
\`\`\`

Output: \`-1\`

Explanation: There is no index where the left and right sums are equal.

## Discussion
A single pass with a running prefix sum and the total sum lets you determine whether the current index is a pivot in constant time. Updating your running totals as you go keeps the solution linear.
`,
	starterCode: String.raw`from typing import List


def pivot_index(nums: List[int]) -> int:
    """Return the leftmost index where left and right sums match."""
    # TODO: replace the placeholder implementation
    total = sum(nums)
    left = 0

    for index, value in enumerate(nums):
        right = total - left - value
        if left == right:
            return index
        left += value

    return -1


if __name__ == "__main__":
    samples = [
        [1, 7, 3, 6, 5, 6],
        [2, 1, -1],
        [2, 1, 1],
    ]

    for nums in samples:
        print(f"pivot_index({nums}) -> {pivot_index(nums)}")
`
};

const PROBLEMS: Record<string, Problem> = {
	[MOCK_PROBLEM.id]: MOCK_PROBLEM,
	'pivot-index': { ...MOCK_PROBLEM, id: 'pivot-index' }
};

export const load: PageLoad = async ({ params }) => {
	const { id } = params;
	const problem = PROBLEMS[id] ?? { ...MOCK_PROBLEM, id };

	return {
		problem
	};
};
