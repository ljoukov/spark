import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { renderMarkdown } from '$lib/server/markdown';
import { getUserProblem } from '$lib/server/code/problemRepo';
import { savePlanItemState } from '$lib/server/sessionState/repo';
import { getBundleBySessionId } from '$lib/data/adventSessions';
import { DEFAULT_CODE_SOURCE } from '$lib/code/constants';
import type { CodeProblem, PlanItemState } from '@spark/schemas';
import type { PageServerLoad } from './$types';

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
	const parentData = await parent();
	const { session, userId, sessionState } = parentData;
	const adventBundle = getBundleBySessionId(session.id);

	const planItem = session.plan.find((item) => item.id === id);
	if (!planItem || planItem.kind !== 'problem') {
		throw error(404, { message: 'Problem not found in session plan' });
	}

	const existingState = (sessionState.items[planItem.id] as PlanItemState | undefined) ?? null;
	const existingSource = existingState?.code?.source?.trim() ?? '';
	if (!adventBundle && (!existingState?.code || existingSource.length === 0)) {
		const now = new Date();
		const nextState: PlanItemState = existingState
			? {
					...existingState,
					code: {
						language: 'python',
						source: DEFAULT_CODE_SOURCE,
						savedAt: now
					}
				}
			: {
					status: 'not_started',
					code: {
						language: 'python',
						source: DEFAULT_CODE_SOURCE,
						savedAt: now
					}
				};

		await savePlanItemState(userId, session.id, planItem.id, nextState);
		sessionState.items[planItem.id] = nextState;
	}

	if (adventBundle) {
		const problemDoc = adventBundle.problems.find((problem) => problem.slug === planItem.id);
		if (!problemDoc) {
			throw error(404, { message: `Problem ${planItem.id} not found` });
		}
		const problem = toSerializable(problemDoc);
		return { problem, planItem, sessionId: session.id, userId };
	}

	const problemDoc = await getUserProblem(userId, session.id, planItem.id);
	if (!problemDoc) {
		throw error(404, { message: `Problem ${planItem.id} not found` });
	}

	const problem = toSerializable(problemDoc);

	return { problem, planItem, sessionId: session.id, userId };
};
