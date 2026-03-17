import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { safeParseGraderWorksheetReport } from '$lib/server/grader/problemReport';
import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { getWorkspaceTextFile, listGraderRuns } from '$lib/server/grader/repo';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const runs = await listGraderRuns(user.uid, 100);
	const sheets = await Promise.all(
		runs.map(async (run) => {
			const reportPath = run.sheet?.filePath ?? run.sheetPath;
			const reportRaw = await getWorkspaceTextFile(user.uid, run.workspaceId, reportPath);
			const report = reportRaw ? safeParseGraderWorksheetReport(reportRaw) : null;

			return {
				id: run.id,
				status: run.status,
				display: buildGraderRunDisplay({
					status: run.status,
					paper: run.paper,
					presentation: run.presentation,
					resultSummary: run.resultSummary ?? null
				}),
				totals: run.totals
					? {
							awardedMarks: run.totals.awardedMarks,
							maxMarks: run.totals.maxMarks,
							percentage: run.totals.percentage ?? null
						}
					: null,
				previewSheet: report?.sheet ?? null,
				createdAt: run.createdAt.toISOString(),
				updatedAt: run.updatedAt.toISOString(),
				error: run.error ?? null
			};
		})
	);

	return {
		sheets
	};
};
