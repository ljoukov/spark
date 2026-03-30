import type { SparkSheetPageState } from '@spark/schemas';

import {
	emptySolveSheetAnswers,
	safeParseGraderWorksheetReport,
	safeParseSolveSheetAnswers,
	safeParseSolveSheetDraft
} from '$lib/server/grader/problemReport';
import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { buildInitialTutorReviewState } from '$lib/server/tutorSessions/reviewState';
import { getTutorSession, findTutorSessionForSheet } from '$lib/server/tutorSessions/repo';
import { recoverTutorSessionIfStale } from '$lib/server/tutorSessions/recovery';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';
import { readTutorWorkspaceState } from '$lib/server/tutorSessions/workspace';

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

export async function loadSparkSheetPageState(options: {
	userId: string;
	sheetId: string;
}): Promise<SparkSheetPageState | null> {
	const run = await getGraderRun(options.userId, options.sheetId);
	if (!run) {
		return null;
	}

	const reportPath = run.sheet?.filePath ?? run.sheetPath;
	const artifactRaw = await getWorkspaceTextFile(options.userId, run.workspaceId, reportPath);
	const report = artifactRaw ? safeParseGraderWorksheetReport(artifactRaw) : null;
	const draft = artifactRaw ? safeParseSolveSheetDraft(artifactRaw) : null;
	const draftAnswersRaw =
		run.draftAnswersPath && run.draftAnswersPath.trim().length > 0
			? await getWorkspaceTextFile(options.userId, run.workspaceId, run.draftAnswersPath)
			: null;
	const draftAnswers = draftAnswersRaw
		? safeParseSolveSheetAnswers(draftAnswersRaw) ?? emptySolveSheetAnswers()
		: emptySolveSheetAnswers();
	const sheetPhase = resolveSheetPhase({
		status: run.status,
		explicitPhase: run.sheetPhase,
		hasReport: report !== null,
		hasDraft: draft !== null
	});
	const session = await findTutorSessionForSheet({
		userId: options.userId,
		runId: run.id
	});

	let interaction = null as SparkSheetPageState['interaction'];
	if (session && report) {
		const serviceAccountJson = requireTutorServiceAccountJson();
		const loadedWorkspace = await readTutorWorkspaceState({
			serviceAccountJson,
			userId: options.userId,
			workspaceId: session.workspaceId,
			session
		});
		const recovered = await recoverTutorSessionIfStale({
			serviceAccountJson,
			userId: options.userId,
			session,
			reviewState: loadedWorkspace.reviewState
		});
		const currentSession = recovered?.session ?? (await getTutorSession(options.userId, session.id)) ?? session;
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
			error: run.error ?? null,
			createdAt: run.createdAt.toISOString(),
			updatedAt: run.updatedAt.toISOString()
		},
		artifactPaths: {
			draft: run.sheetPath,
			report: reportPath,
			draftAnswers: run.draftAnswersPath ?? 'sheet/state/answers.json'
		},
		draft,
		draftAnswers: draftAnswers.answers,
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
}
