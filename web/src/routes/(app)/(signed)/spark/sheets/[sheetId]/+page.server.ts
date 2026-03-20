import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { safeParseGraderWorksheetReport } from '$lib/server/grader/problemReport';
import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { recoverTutorSessionIfStale } from '$lib/server/tutorSessions/recovery';
import { buildInitialTutorReviewState } from '$lib/server/tutorSessions/reviewState';
import { getTutorSession, findTutorSessionForSheet } from '$lib/server/tutorSessions/repo';
import { readTutorWorkspaceState } from '$lib/server/tutorSessions/workspace';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const run = await getGraderRun(user.uid, params.sheetId);
	if (!run) {
		throw error(404, 'Sheet not found');
	}

	const reportPath = run.sheet?.filePath ?? run.sheetPath;
	const reportRaw = await getWorkspaceTextFile(user.uid, run.workspaceId, reportPath);
	const report = reportRaw ? safeParseGraderWorksheetReport(reportRaw) : null;
	const session = await findTutorSessionForSheet({
		userId: user.uid,
		runId: run.id
	});

	let interaction = null as null | {
		id: string;
		workspaceId: string;
		status: string;
		reviewState: ReturnType<typeof buildInitialTutorReviewState>;
		activeTurnAgentId: string | null;
		activeTurnQuestionId: string | null;
		error: string | null;
	};

	if (session) {
		const serviceAccountJson = requireTutorServiceAccountJson();
		const loadedWorkspace = await readTutorWorkspaceState({
			serviceAccountJson,
			userId: user.uid,
			workspaceId: session.workspaceId,
			session
		});
		const recovered = await recoverTutorSessionIfStale({
			serviceAccountJson,
			userId: user.uid,
			session,
			reviewState: loadedWorkspace.reviewState
		});
		const currentSession = recovered?.session ?? (await getTutorSession(user.uid, session.id)) ?? session;
		const currentReviewState = recovered?.reviewState ?? loadedWorkspace.reviewState;
		interaction = {
			id: currentSession.id,
			workspaceId: currentSession.workspaceId,
			status: currentSession.status,
			reviewState: currentReviewState,
			activeTurnAgentId: currentSession.activeTurnAgentId ?? null,
			activeTurnQuestionId: currentSession.activeTurnQuestionId ?? null,
			error: currentSession.error ?? null
		};
	}

	return {
		run: {
			id: run.id,
			workspaceId: run.workspaceId,
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
			error: run.error ?? null,
			createdAt: run.createdAt.toISOString(),
			updatedAt: run.updatedAt.toISOString()
		},
		report,
		initialReviewState:
			report && !interaction
				? buildInitialTutorReviewState({
						report,
						now: run.updatedAt
					})
				: null,
		interaction
	};
};
