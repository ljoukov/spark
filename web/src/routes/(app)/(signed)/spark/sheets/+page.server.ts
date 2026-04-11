import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import {
	safeParseGraderWorksheetReport,
	safeParseSolveSheetDraft
} from '$lib/server/grader/problemReport';
import { getSheetDashboard } from '$lib/server/grader/dashboardRepo';
import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { getWorkspaceTextFile, listGraderRuns } from '$lib/server/grader/repo';
import { buildSheetSubjectTag, normalizeSheetSubjectKey } from '$lib/spark/sheetSubjects';

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

function resolveSubjectTags(options: {
	analysis?: {
		subjectTags: Array<{ key: string; label: string }>;
		primarySubjectKey?: string | undefined;
	} | null;
	previewSubject?: string | null;
}): Array<{ key: string; label: string }> {
	if (options.analysis && options.analysis.subjectTags.length > 0) {
		return options.analysis.subjectTags.map((tag) => ({
			key: normalizeSheetSubjectKey(tag.key),
			label: tag.label
		}));
	}
	const previewSubject = options.previewSubject?.trim();
	if (!previewSubject) {
		return [];
	}
	return [buildSheetSubjectTag(previewSubject)];
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const dashboard = await getSheetDashboard(user.uid);
	const analysisByRunId = new Map(dashboard?.runAnalyses.map((analysis) => [analysis.runId, analysis]) ?? []);
	const runs = await listGraderRuns(user.uid, 100);
	const sheets = await Promise.all(
		runs.map(async (run) => {
			const reportPath = run.sheet?.filePath ?? run.sheetPath;
			const artifactRaw = await getWorkspaceTextFile(user.uid, run.workspaceId, reportPath);
			const report = artifactRaw ? safeParseGraderWorksheetReport(artifactRaw) : null;
			const draft = artifactRaw ? safeParseSolveSheetDraft(artifactRaw) : null;
			const analysis = analysisByRunId.get(run.id) ?? null;
			const sheetPhase = resolveSheetPhase({
				status: run.status,
				explicitPhase: run.sheetPhase,
				hasReport: report !== null,
				hasDraft: draft !== null
			});
			const previewSheet = report?.sheet ?? draft?.sheet ?? null;
			const subjectTags = resolveSubjectTags({
				analysis,
				previewSubject: previewSheet?.subject ?? null
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
				previewSheet,
				analysis:
					analysis === null
						? null
						: {
								primarySubjectKey: analysis.primarySubjectKey
									? normalizeSheetSubjectKey(analysis.primarySubjectKey)
									: null,
								summary: analysis.summary ?? null,
								strongSpots: analysis.strongSpots,
								weakSpots: analysis.weakSpots,
								specifics: analysis.specifics,
								nextSteps: analysis.nextSteps,
								generalFeedback: analysis.generalFeedback ?? null
							},
				subjectTags,
				primarySubjectKey:
					analysis?.primarySubjectKey
						? normalizeSheetSubjectKey(analysis.primarySubjectKey)
						: (subjectTags[0]?.key ?? null),
				createdAt: run.createdAt.toISOString(),
				updatedAt: run.updatedAt.toISOString(),
				error: run.error ?? null
			};
		})
	);

	return {
		sheets,
		dashboard:
			dashboard === null
				? null
				: {
						...dashboard,
						subjects: dashboard.subjects.map((subject) => ({
							...subject,
							key: normalizeSheetSubjectKey(subject.key)
						})),
						strengths: dashboard.strengths.map((entry) => ({
							...entry,
							subjectKeys: entry.subjectKeys.map((key) => normalizeSheetSubjectKey(key))
						})),
						weakSpots: dashboard.weakSpots.map((entry) => ({
							...entry,
							subjectKeys: entry.subjectKeys.map((key) => normalizeSheetSubjectKey(key))
						})),
						runAnalyses: dashboard.runAnalyses.map((analysis) => ({
							...analysis,
							primarySubjectKey: analysis.primarySubjectKey
								? normalizeSheetSubjectKey(analysis.primarySubjectKey)
								: null,
							subjectTags: analysis.subjectTags.map((tag) => ({
								...tag,
								key: normalizeSheetSubjectKey(tag.key)
							}))
						})),
						updatedAt: dashboard.updatedAt.toISOString()
					}
	};
};
