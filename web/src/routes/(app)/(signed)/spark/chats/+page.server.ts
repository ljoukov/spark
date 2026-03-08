import { listGraderRuns } from '$lib/server/grader/repo';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const GRADER_RUN_LIMIT = 50;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const graderRuns = await listGraderRuns(user.uid, GRADER_RUN_LIMIT);

	return {
		graderRuns: graderRuns
			.filter((run) => Boolean(run.conversationId))
			.map((run) => ({
				conversationId: run.conversationId ?? '',
				status: run.status,
				score:
					run.totals && run.totals.maxMarks > 0
						? `${run.totals.awardedMarks.toString()}/${run.totals.maxMarks.toString()}`
						: null
			}))
	};
};
