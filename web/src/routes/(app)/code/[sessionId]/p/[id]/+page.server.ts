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
	summary: string;
	summaryBullets: readonly string[];
	difficulty: 'easy' | 'medium' | 'hard';
	primaryTopic: string;
	topics: readonly string[];
	tags: readonly string[];
	tasks: readonly string[];
	constraints: readonly string[];
	edgeCases: readonly string[];
	hints: readonly string[];
	followUpIdeas: readonly string[];
	examples: CodeProblem['examples'];
	solution: CodeProblem['solution'];
	metadataVersion: number;
	starterCode: string;
	sourcePath: string;
	sourceMarkdown: string;
	markdownHtml: string;
};

function renderMarkdown(markdown: string): string {
	const parsed = marked.parse(markdown);
	return typeof parsed === 'string' ? parsed : '';
}

function toSerializable(problem: CodeProblem): SerializableProblem {
	return {
		id: problem.slug,
		title: problem.title,
		summary: problem.summary,
		summaryBullets: problem.summaryBullets,
		difficulty: problem.difficulty,
		primaryTopic: problem.primaryTopic,
		topics: problem.topics,
		tags: problem.tags,
		tasks: problem.tasks,
		constraints: problem.constraints,
		edgeCases: problem.edgeCases,
		hints: problem.hints,
		followUpIdeas: problem.followUpIdeas,
		examples: problem.examples,
		solution: problem.solution,
		metadataVersion: problem.metadataVersion,
		starterCode: problem.starterCode,
		sourcePath: problem.source.path,
		sourceMarkdown: problem.source.markdown,
		markdownHtml: renderMarkdown(problem.source.markdown)
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
