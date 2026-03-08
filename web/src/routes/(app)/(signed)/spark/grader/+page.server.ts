import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { listGraderRuns } from '$lib/server/grader/repo';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}
	const runs = await listGraderRuns(user.uid, 100);
	return {
		runs: runs.map((run) => ({
			id: run.id,
			status: run.status,
			display: buildGraderRunDisplay({
				status: run.status,
				paper: run.paper,
				presentation: run.presentation,
				totals: run.totals,
				problems: run.problems,
				resultSummary: run.resultSummary ?? null
			}),
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
						contextLabel: run.paper.contextLabel ?? null,
						year: run.paper.year ?? null,
						paperName: run.paper.paperName ?? null
					}
				: null,
			createdAt: run.createdAt.toISOString(),
			updatedAt: run.updatedAt.toISOString(),
			completedAt: run.completedAt ? run.completedAt.toISOString() : null,
			error: run.error ?? null
		}))
	};
};
