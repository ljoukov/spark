import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import type { PageServerLoad } from './$types';

marked.setOptions({ breaks: true, gfm: true });

type ProblemDifficulty = 'Easy' | 'Medium' | 'Hard';

type ProblemDefinition = {
	id: string;
	title: string;
	difficulty: ProblemDifficulty;
	category: string;
	tags: string[];
	estimatedTime: string;
	starterCode: string;
	hints: string[];
	markdownFile: string;
};

type Problem = Omit<ProblemDefinition, 'markdownFile'> & {
	markdownHtml: string;
};

const BALANCED_PIVOT_PROBLEM: ProblemDefinition = {
	id: 'balanced-pivot',
	title: 'Balanced Pivot Index',
	difficulty: 'Medium',
	category: 'Arrays',
	tags: ['prefix-sum', 'array traversal'],
	estimatedTime: '25 minutes',
	starterCode: `from typing import List


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
`,
	hints: [
		'Consider precomputing prefix sums to answer balance checks in O(1).',
		'You do not need nested loops if you know the total sum of the array ahead of time.',
		'Watch out for negative values when evaluating both sides of the pivot index.'
	],
	markdownFile: 'balanced-pivot.md'
};

const PROBLEM_DEFINITIONS: Record<string, ProblemDefinition> = {
	[BALANCED_PIVOT_PROBLEM.id]: BALANCED_PIVOT_PROBLEM,
	'pivot-index': { ...BALANCED_PIVOT_PROBLEM, id: 'pivot-index' }
};

async function loadMarkdownHtml(markdownFile: string): Promise<string> {
	const fileUrl = new URL(`../../../../../lib/content/problems/${markdownFile}`, import.meta.url);
	const markdown = await readFile(fileUrl, 'utf8');
	const parsed = marked.parse(markdown);
	return typeof parsed === 'string' ? parsed : '';
}

async function resolveProblem(id: string): Promise<Problem> {
	const definition = PROBLEM_DEFINITIONS[id] ?? { ...BALANCED_PIVOT_PROBLEM, id };
	const markdownHtml = await loadMarkdownHtml(definition.markdownFile);
	const { markdownFile, ...metadata } = definition;
	return { ...metadata, markdownHtml };
}

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;
	const problem = await resolveProblem(id);

	return {
		problem
	};
};
