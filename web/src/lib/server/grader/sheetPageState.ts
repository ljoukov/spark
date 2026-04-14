import type { SparkSheetPageState } from '@spark/schemas';
import { z } from 'zod';

import {
	emptySolveSheetAnswers,
	safeParseGraderWorksheetReport,
	safeParseSolveSheetAnswers,
	safeParseSolveSheetDraft
} from '$lib/server/grader/problemReport';
import {
	rewriteGraderWorksheetReportAssetTargets,
	rewritePaperSheetDataAssetTargets,
	rewriteSolveSheetDraftAssetTargets
} from '$lib/server/grader/sheetAssets';
import { buildGraderRunDisplay } from '$lib/server/grader/presentation';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { buildInitialTutorReviewState } from '$lib/server/tutorSessions/reviewState';
import { getTutorSession, findTutorSessionForSheet } from '$lib/server/tutorSessions/repo';
import { recoverTutorSessionIfStale } from '$lib/server/tutorSessions/recovery';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';
import { readTutorWorkspaceState } from '$lib/server/tutorSessions/workspace';

const uploadManifestSchema = z.object({
	attachments: z.array(
		z.object({
			workspacePath: z.string().trim().min(1),
			contentType: z.string().trim().min(1).optional(),
			filename: z.string().trim().min(1).optional()
		})
	)
});

function buildSheetAttachmentUrl(options: {
	sheetId: string;
	filePath: string;
	filename: string;
}): string {
	const params = new URLSearchParams({
		path: options.filePath,
		filename: options.filename
	});
	return `/api/spark/sheets/${encodeURIComponent(options.sheetId)}/attachment?${params.toString()}`;
}

function isPdfUpload(attachment: { workspacePath: string; contentType?: string }): boolean {
	const contentType = attachment.contentType?.toLowerCase() ?? '';
	return contentType === 'application/pdf' || attachment.workspacePath.toLowerCase().endsWith('.pdf');
}

async function loadSourceLinks(options: {
	userId: string;
	sheetId: string;
	workspaceId: string;
	conversationId?: string | undefined;
	sourceAttachmentIds?: readonly string[] | undefined;
	paperUrl?: string | undefined;
	referencePaperUrl?: string | undefined;
}): Promise<SparkSheetPageState['sourceLinks']> {
	const links: SparkSheetPageState['sourceLinks'] = [];
	const addLink = (link: SparkSheetPageState['sourceLinks'][number]): void => {
		if (!links.some((existing) => existing.href === link.href)) {
			links.push(link);
		}
	};

	const uploadedManifestRaw = await getWorkspaceTextFile(
		options.userId,
		options.workspaceId,
		'grader/uploads/index.json'
	);
	if (uploadedManifestRaw) {
		const parsedManifest = (() => {
			try {
				return uploadManifestSchema.safeParse(JSON.parse(uploadedManifestRaw));
			} catch {
				return null;
			}
		})();
		if (parsedManifest?.success) {
			const pdfUploads = parsedManifest.data.attachments.filter(isPdfUpload);
			for (const [index, attachment] of pdfUploads.entries()) {
				const filename = attachment.filename ?? attachment.workspacePath.split('/').at(-1) ?? 'source.pdf';
				addLink({
					label: pdfUploads.length === 1 ? 'Original PDF' : `Original PDF ${index + 1}`,
					href: buildSheetAttachmentUrl({
						sheetId: options.sheetId,
						filePath: attachment.workspacePath,
						filename
					})
				});
			}
		}
	}

	if (links.length === 0 && options.conversationId && options.sourceAttachmentIds) {
		for (const [index, fileId] of options.sourceAttachmentIds.entries()) {
			const params = new URLSearchParams({
				conversationId: options.conversationId,
				fileId
			});
			addLink({
				label: options.sourceAttachmentIds.length === 1 ? 'Original PDF' : `Original upload ${index + 1}`,
				href: `/api/spark/agent/attachments?${params.toString()}`
			});
		}
	}

	const paperUrl = options.paperUrl ?? options.referencePaperUrl;
	if (paperUrl) {
		addLink({
			label: links.length > 0 ? 'Official PDF' : 'Original PDF',
			href: paperUrl
		});
	}

	return links;
}

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
	const parsedReport = artifactRaw ? safeParseGraderWorksheetReport(artifactRaw) : null;
	const report = parsedReport
		? rewriteGraderWorksheetReportAssetTargets({
				sheetId: run.id,
				report: parsedReport
			})
		: null;
	const parsedDraft = artifactRaw ? safeParseSolveSheetDraft(artifactRaw) : null;
	const draft = parsedDraft
		? rewriteSolveSheetDraftAssetTargets({
				sheetId: run.id,
				draft: parsedDraft
			})
		: null;
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
		const renderableReviewState = currentReviewState
			? {
					...currentReviewState,
					sheet: rewritePaperSheetDataAssetTargets({
						sheetId: run.id,
						sheet: currentReviewState.sheet
					})
				}
			: currentReviewState;
		interaction = {
			id: currentSession.id,
			workspaceId: currentSession.workspaceId,
			status: currentSession.status,
			reviewState: renderableReviewState,
			activeTurnAgentId: currentSession.activeTurnAgentId ?? null,
			activeTurnQuestionId: currentSession.activeTurnQuestionId ?? null,
			error: currentSession.error ?? null
		};
	}

	const sourceLinks = await loadSourceLinks({
		userId: options.userId,
		sheetId: run.id,
		workspaceId: run.workspaceId,
		conversationId: run.conversationId,
		sourceAttachmentIds: run.sourceAttachmentIds,
		paperUrl: run.paper?.paperUrl,
		referencePaperUrl: report?.references?.paperUrl ?? draft?.references?.paperUrl
	});

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
		interaction,
		sourceLinks
	};
}
