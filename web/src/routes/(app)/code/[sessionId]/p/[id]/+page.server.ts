import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import { z } from 'zod';
import { getUserProblem } from '$lib/server/code/problemRepo';
import type { CodeProblem } from '@spark/schemas';
import type { PageServerLoad } from './$types';

marked.setOptions({ breaks: true, gfm: true });

const paramsSchema = z.object({
	id: z.string().trim().min(1, 'Problem id is required')
});

type SerializableProblem = {
	id: string;
	title: string;
	difficulty: CodeProblem['difficulty'];
	topics: readonly string[];
	description: string;
	descriptionHtml: string;
	inputFormat: string;
	inputFormatHtml: string;
	constraints: readonly string[];
	examples: Array<CodeProblem['examples'][number] & { explanationHtml: string }>;
	tests: Array<
		CodeProblem['tests'][number] & {
			index: number;
			explanationHtml: string | null;
		}
	>;
	hints: readonly string[];
	hintsHtml: readonly string[];
	solution: CodeProblem['solution'] & { code: string };
	metadataVersion: number;
};

function renderMarkdown(markdown: string): string {
	const parsed = marked.parse(markdown);
	return typeof parsed === 'string' ? parsed : '';
}

function toSerializable(problem: CodeProblem): SerializableProblem {
	return {
		id: problem.slug,
		title: problem.title,
		difficulty: problem.difficulty,
		topics: problem.topics,
		description: problem.description,
		descriptionHtml: renderMarkdown(problem.description),
		inputFormat: problem.inputFormat,
		inputFormatHtml: renderMarkdown(problem.inputFormat),
		constraints: problem.constraints,
		examples: problem.examples.map((example) => ({
			...example,
			explanationHtml: renderMarkdown(example.explanation)
		})),
		tests: problem.tests.map((test, index) => ({
			...test,
			index,
			explanationHtml: test.explanation ? renderMarkdown(test.explanation) : null
		})),
		hints: problem.hints,
		hintsHtml: problem.hints.map((hint) => renderMarkdown(hint)),
		solution: {
			...problem.solution,
			code: problem.solution.code
		},
		metadataVersion: problem.metadataVersion
	};
}

export const load: PageServerLoad = async ({ params, parent }) => {
	const { id } = paramsSchema.parse(params);
	const { session, userId } = await parent();

	const planItem = session.plan.find((item) => item.id === id);
	if (!planItem || planItem.kind !== 'problem') {
		throw error(404, { message: 'Problem not found in session plan' });
	}

	const problemDoc = await getUserProblem(userId, session.id, planItem.id);
	if (!problemDoc) {
		throw error(404, { message: `Problem ${planItem.id} not found` });
	}

	const problem = toSerializable(problemDoc);

	return { problem, planItem, sessionId: session.id, userId };
};
