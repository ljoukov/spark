import { env } from '$env/dynamic/private';
import { patchFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { SparkGraderWorksheetReportSchema, type SparkGraderWorksheetReport } from '@spark/schemas';
import { z } from 'zod';

import { getWorkspaceTextFile, type SparkGraderRun } from './repo';

const trimmedString = z.string().trim().min(1);

const graderRunSummarySchema = z.object({
	contextLabel: trimmedString.optional(),
	year: trimmedString.optional(),
	paperName: trimmedString.optional(),
	paperUrl: trimmedString.optional(),
	paperStoragePath: trimmedString.optional(),
	markSchemeUrl: trimmedString.optional(),
	markSchemeStoragePath: trimmedString.optional(),
	presentation: z.object({
		title: trimmedString,
		subtitle: trimmedString,
		summaryMarkdown: trimmedString,
		footer: trimmedString
	}),
	totals: z.object({
		awardedMarks: z.number().min(0),
		maxMarks: z.number().min(0)
	}),
	sheet: z.object({
		title: trimmedString.optional(),
		filePath: trimmedString
	})
});

type GraderRunSummary = z.infer<typeof graderRunSummarySchema>;

type RecoveryResult =
	| {
			recovered: false;
			run: SparkGraderRun;
	  }
	| {
			recovered: true;
			run: SparkGraderRun;
	  };

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function isTransientUpstreamFailure(error: string | undefined): boolean {
	if (!error) {
		return false;
	}
	return /\b(?:ChatGPT Codex request failed \((?:500|502|503|504|529)\)|upstream connect error|disconnect\/reset|connection termination|temporarily unavailable|service unavailable|overloaded|gateway timeout)\b/iu.test(
		error
	);
}

function parseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
	try {
		return schema.parse(JSON.parse(raw));
	} catch {
		return null;
	}
}

function buildRecoveredTotals(summary: GraderRunSummary): SparkGraderRun['totals'] {
	const percentage =
		summary.totals.maxMarks > 0
			? (summary.totals.awardedMarks / summary.totals.maxMarks) * 100
			: 0;
	return {
		awardedMarks: summary.totals.awardedMarks,
		maxMarks: summary.totals.maxMarks,
		problemCount: 1,
		gradedCount: 1,
		percentage: Number.isFinite(percentage) ? percentage : 0
	};
}

function buildRecoveredPaper(summary: GraderRunSummary): SparkGraderRun['paper'] | undefined {
	const paper: NonNullable<SparkGraderRun['paper']> = {};
	if (summary.contextLabel) {
		paper.contextLabel = summary.contextLabel;
	}
	if (summary.year) {
		paper.year = summary.year;
	}
	if (summary.paperName) {
		paper.paperName = summary.paperName;
	}
	if (summary.paperUrl) {
		paper.paperUrl = summary.paperUrl;
	}
	if (summary.paperStoragePath) {
		paper.paperStoragePath = summary.paperStoragePath;
	}
	if (summary.markSchemeUrl) {
		paper.markSchemeUrl = summary.markSchemeUrl;
	}
	if (summary.markSchemeStoragePath) {
		paper.markSchemeStoragePath = summary.markSchemeStoragePath;
	}
	return Object.keys(paper).length > 0 ? paper : undefined;
}

function artifactsAreConsistent(options: {
	run: SparkGraderRun;
	summary: GraderRunSummary;
	report: SparkGraderWorksheetReport;
	reportPath: string;
}): boolean {
	if (options.summary.sheet.filePath.trim() !== options.reportPath) {
		return false;
	}
	const reviewScore = options.report.review.score;
	if (reviewScore.got !== options.summary.totals.awardedMarks) {
		return false;
	}
	if (reviewScore.total !== options.summary.totals.maxMarks) {
		return false;
	}
	if (options.report.sheet.title.trim().length === 0) {
		return false;
	}
	if (options.run.workspaceId.trim().length === 0 || options.run.agentId.trim().length === 0) {
		return false;
	}
	return true;
}

export async function recoverTransientFailedGraderRunFromArtifacts(options: {
	userId: string;
	run: SparkGraderRun;
}): Promise<RecoveryResult> {
	const run = options.run;
	if (run.status !== 'failed' || !isTransientUpstreamFailure(run.error)) {
		return { recovered: false, run };
	}

	const summaryPath = run.summaryPath;
	const reportPath = run.sheet?.filePath ?? run.sheetPath;
	const [summaryRaw, reportRaw] = await Promise.all([
		getWorkspaceTextFile(options.userId, run.workspaceId, summaryPath),
		getWorkspaceTextFile(options.userId, run.workspaceId, reportPath)
	]);
	if (!summaryRaw || !reportRaw) {
		return { recovered: false, run };
	}

	const summary = parseJson(summaryRaw, graderRunSummarySchema);
	const report = parseJson(reportRaw, SparkGraderWorksheetReportSchema);
	if (!summary || !report) {
		return { recovered: false, run };
	}
	if (!artifactsAreConsistent({ run, summary, report, reportPath })) {
		return { recovered: false, run };
	}

	const now = new Date();
	const presentation = summary.presentation;
	const totals = buildRecoveredTotals(summary);
	const paper = buildRecoveredPaper(summary);
	const sheet = {
		filePath: reportPath,
		title: summary.sheet.title?.trim() || report.sheet.title
	};
	const resultSummary = presentation.summaryMarkdown;
	const serviceAccountJson = requireServiceAccountJson();

	await patchFirestoreDocument({
		serviceAccountJson,
		documentPath: `spark/${options.userId}/graderRuns/${run.id}`,
		updates: {
			status: 'done',
			sheetPhase: 'graded',
			updatedAt: now,
			completedAt: now,
			resultSummary,
			...(paper ? { paper } : {}),
			presentation,
			totals,
			sheet,
			summaryPath,
			sheetPath: reportPath
		},
		deletes: ['error']
	});

	await patchFirestoreDocument({
		serviceAccountJson,
		documentPath: `users/${options.userId}/agents/${run.agentId}`,
		updates: {
			status: 'done',
			updatedAt: now,
			resultSummary
		},
		deletes: ['error']
	}).catch((error) => {
		console.warn('Unable to patch recovered grader agent state', {
			userId: options.userId,
			runId: run.id,
			agentId: run.agentId,
			error
		});
	});

	return {
		recovered: true,
		run: {
			...run,
			status: 'done',
			sheetPhase: 'graded',
			updatedAt: now,
			completedAt: now,
			resultSummary,
			...(paper ? { paper } : {}),
			presentation,
			totals,
			sheet,
			summaryPath,
			sheetPath: reportPath,
			error: undefined
		}
	};
}
