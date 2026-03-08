import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { parseGraderProblemReport } from '$lib/server/grader/problemReport';
import { findTutorSessionForGraderProblem } from '$lib/server/tutorSessions/repo';
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
	const problem = (run.problems ?? []).find((entry) => entry.id === params.problemId);
	if (!problem) {
		throw error(404, 'Problem not found');
	}
	const markdown = await getWorkspaceTextFile(user.uid, run.workspaceId, problem.filePath);
	if (!markdown) {
		throw error(404, 'Problem report file not found');
	}
	const sections = parseGraderProblemReport(markdown);
	const tutorSession = await findTutorSessionForGraderProblem({
		userId: user.uid,
		runId: run.id,
		problemId: problem.id
	});
	return {
		run: {
			id: run.id,
			status: run.status,
			olympiadLabel: run.olympiadLabel
		},
		problem: {
			id: problem.id,
			index: problem.index,
			title: problem.title ?? `Problem ${problem.index.toString()}`,
			awardedMarks: typeof problem.awardedMarks === 'number' ? problem.awardedMarks : null,
			maxMarks: typeof problem.maxMarks === 'number' ? problem.maxMarks : null,
			verdict: problem.verdict ?? null,
			filePath: problem.filePath
		},
		tutorSession: tutorSession
			? {
					id: tutorSession.id,
					status: tutorSession.status
				}
			: null,
		sections: {
			...sections
		}
	};
};
