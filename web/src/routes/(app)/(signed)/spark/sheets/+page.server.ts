import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import {
	safeParseGraderWorksheetReport,
	safeParseSolveSheetDraft
} from '$lib/server/grader/problemReport';
import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { getWorkspaceTextFile, listGraderRuns } from '$lib/server/grader/repo';

function resolveSheetPhase(options: {
	status: 'created' | 'executing' | 'stopped' | 'failed' | 'done';
	explicitPhase?: 'building' | 'solving' | 'grading' | 'graded';
	hasReport: boolean;
	hasDraft: boolean;
}): 'building' | 'solving' | 'grading' | 'graded' {
	if (options.explicitPhase) {
		return options.explicitPhase;
	}
	if (options.hasReport) {
		return 'graded';
	}
	if (options.hasDraft) {
		return 'solving';
	}
	if (options.status === 'done') {
		return 'graded';
	}
	return 'grading';
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const runs = await listGraderRuns(user.uid, 100);
	const sheets = await Promise.all(
		runs.map(async (run) => {
			const reportPath = run.sheet?.filePath ?? run.sheetPath;
			const artifactRaw = await getWorkspaceTextFile(user.uid, run.workspaceId, reportPath);
			const report = artifactRaw ? safeParseGraderWorksheetReport(artifactRaw) : null;
			const draft = artifactRaw ? safeParseSolveSheetDraft(artifactRaw) : null;
			const sheetPhase = resolveSheetPhase({
				status: run.status,
				explicitPhase: run.sheetPhase,
				hasReport: report !== null,
				hasDraft: draft !== null
			});

			return {
				id: run.id,
				status: run.status,
				sheetPhase,
				display: buildGraderRunDisplay({
					status: run.status,
					sheetPhase,
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
				previewSheet: report?.sheet ?? draft?.sheet ?? null,
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
