import { getGraderRun } from '$lib/server/grader/repo';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}
	const run = await getGraderRun(user.uid, params.runId);
	if (!run) {
		throw error(404, 'Grader run not found');
	}
	const problems = [...(run.problems ?? [])].sort((a, b) => a.index - b.index);
	return {
		run: {
			id: run.id,
			agentId: run.agentId,
			workspaceId: run.workspaceId,
			status: run.status,
			olympiadLabel: run.olympiadLabel,
			createdAt: run.createdAt.toISOString(),
			updatedAt: run.updatedAt.toISOString(),
			completedAt: run.completedAt ? run.completedAt.toISOString() : null,
			resultSummary: run.resultSummary ?? null,
			error: run.error ?? null,
			totals: run.totals
				? {
						awardedMarks: run.totals.awardedMarks,
						maxMarks: run.totals.maxMarks,
						problemCount: run.totals.problemCount,
						gradedCount: run.totals.gradedCount,
						percentage: run.totals.percentage ?? null
					}
				: null,
			paper: run.paper
				? {
						olympiad: run.paper.olympiad ?? null,
						year: run.paper.year ?? null,
						paperName: run.paper.paperName ?? null,
						paperUrl: run.paper.paperUrl ?? null,
						markSchemeUrl: run.paper.markSchemeUrl ?? null
					}
				: null
		},
		problems: problems.map((problem) => ({
			id: problem.id,
			index: problem.index,
			title: problem.title ?? `Problem ${problem.index.toString()}`,
			awardedMarks: typeof problem.awardedMarks === 'number' ? problem.awardedMarks : null,
			maxMarks: typeof problem.maxMarks === 'number' ? problem.maxMarks : null,
			verdict: problem.verdict ?? null,
			filePath: problem.filePath
		}))
	};
};
