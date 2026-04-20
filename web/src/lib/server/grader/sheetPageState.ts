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
import {
	findConversationIdForGraderRun,
	getGraderRun,
	getWorkspaceTextFile
} from '$lib/server/grader/repo';
import {
	buildInitialTutorReviewState,
	syncTutorReviewStateWithReport
} from '$lib/server/tutorSessions/reviewState';
import { findTutorSessionForSheet } from '$lib/server/tutorSessions/repo';

const uploadManifestSchema = z.object({
	attachments: z.array(
		z.object({
			workspacePath: z.string().trim().min(1),
			contentType: z.string().trim().min(1).optional(),
			filename: z.string().trim().min(1).optional()
		})
	)
});

type SourceLinkKind = SparkSheetPageState['sourceLinks'][number]['kind'];

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

function buildSharedPdfUrl(options: { storagePath: string; filename: string }): string {
	const params = new URLSearchParams({
		path: options.storagePath,
		filename: options.filename
	});
	return `/api/spark/shared-pdfs?${params.toString()}`;
}

function isPdfUpload(attachment: { workspacePath: string; contentType?: string }): boolean {
	const contentType = attachment.contentType?.toLowerCase() ?? '';
	return (
		contentType === 'application/pdf' || attachment.workspacePath.toLowerCase().endsWith('.pdf')
	);
}

function classifySourcePdfUpload(attachment: { workspacePath: string; filename?: string }): {
	kind: SourceLinkKind;
	label: string;
} {
	const labelText = `${attachment.filename ?? ''} ${attachment.workspacePath}`.toLowerCase();
	if (/(?:^|[-_\s])ms(?:[-_\s.]|$)|mark[-_\s]?scheme|marking[-_\s]?scheme/.test(labelText)) {
		return {
			kind: 'mark_scheme',
			label: 'Mark scheme PDF'
		};
	}
	if (/(?:^|[-_\s])qp(?:[-_\s.]|$)|question[-_\s]?paper|paper/.test(labelText)) {
		return {
			kind: 'paper',
			label: 'Question paper PDF'
		};
	}
	return {
		kind: 'upload',
		label: 'Original PDF'
	};
}

async function loadSourceLinks(options: {
	userId: string;
	sheetId: string;
	workspaceId: string;
	conversationId?: string | undefined;
	sourceAttachmentIds?: readonly string[] | undefined;
	paperUrl?: string | undefined;
	paperStoragePath?: string | undefined;
	referencePaperUrl?: string | undefined;
	referencePaperStoragePath?: string | undefined;
	markSchemeUrl?: string | undefined;
	markSchemeStoragePath?: string | undefined;
	referenceMarkSchemeUrl?: string | undefined;
	referenceMarkSchemeStoragePath?: string | undefined;
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
				const filename =
					attachment.filename ?? attachment.workspacePath.split('/').at(-1) ?? 'source.pdf';
				const classification = classifySourcePdfUpload(attachment);
				addLink({
					kind: classification.kind,
					label:
						classification.kind === 'upload' && pdfUploads.length > 1
							? `Original PDF ${index + 1}`
							: classification.label,
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
				kind: 'upload',
				label:
					options.sourceAttachmentIds.length === 1
						? 'Original upload'
						: `Original upload ${index + 1}`,
				href: `/api/spark/agent/attachments?${params.toString()}`
			});
		}
	}

	const paperStoragePath = options.paperStoragePath ?? options.referencePaperStoragePath;
	if (paperStoragePath) {
		addLink({
			kind: 'paper',
			label: 'Question paper PDF',
			href: buildSharedPdfUrl({
				storagePath: paperStoragePath,
				filename: paperStoragePath.split('/').at(-1) ?? 'question-paper.pdf'
			})
		});
	} else {
		const paperUrl = options.paperUrl ?? options.referencePaperUrl;
		if (paperUrl) {
			addLink({
				kind: 'paper',
				label: 'Question paper PDF',
				href: paperUrl
			});
		}
	}
	const markSchemeStoragePath =
		options.markSchemeStoragePath ?? options.referenceMarkSchemeStoragePath;
	if (markSchemeStoragePath) {
		addLink({
			kind: 'mark_scheme',
			label: 'Mark scheme PDF',
			href: buildSharedPdfUrl({
				storagePath: markSchemeStoragePath,
				filename: markSchemeStoragePath.split('/').at(-1) ?? 'mark-scheme.pdf'
			})
		});
	} else {
		const markSchemeUrl = options.markSchemeUrl ?? options.referenceMarkSchemeUrl;
		if (markSchemeUrl) {
			addLink({
				kind: 'mark_scheme',
				label: 'Mark scheme PDF',
				href: markSchemeUrl
			});
		}
	}
	if (options.conversationId) {
		const params = new URLSearchParams({ conversationId: options.conversationId });
		addLink({
			kind: 'chat',
			label: 'Request chat',
			href: `/spark?${params.toString()}`
		});
	}

	return links;
}

async function resolveSheetConversationId(options: {
	userId: string;
	runId: string;
	conversationId?: string | undefined;
}): Promise<string | undefined> {
	if (options.conversationId) {
		return options.conversationId;
	}
	try {
		return (await findConversationIdForGraderRun(options.userId, options.runId)) ?? undefined;
	} catch (error) {
		console.warn('Unable to resolve source chat for sheet', {
			userId: options.userId,
			runId: options.runId,
			error
		});
		return undefined;
	}
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
		? (safeParseSolveSheetAnswers(draftAnswersRaw) ?? emptySolveSheetAnswers())
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
		const currentReviewState = session.reviewState
			? syncTutorReviewStateWithReport({
					reviewState: session.reviewState,
					report,
					now: session.updatedAt
				})
			: buildInitialTutorReviewState({
					report,
					now: session.updatedAt
				});
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
			id: session.id,
			workspaceId: session.workspaceId,
			status: session.status,
			reviewState: renderableReviewState,
			activeTurnAgentId: session.activeTurnAgentId ?? null,
			activeTurnQuestionId: session.activeTurnQuestionId ?? null,
			error: session.error ?? null
		};
	}

	const conversationId = await resolveSheetConversationId({
		userId: options.userId,
		runId: run.id,
		conversationId: run.conversationId
	});

	const sourceLinks = await loadSourceLinks({
		userId: options.userId,
		sheetId: run.id,
		workspaceId: run.workspaceId,
		conversationId,
		sourceAttachmentIds: run.sourceAttachmentIds,
		paperUrl: run.paper?.paperUrl,
		paperStoragePath: run.paper?.paperStoragePath,
		referencePaperUrl: report?.references?.paperUrl ?? draft?.references?.paperUrl,
		referencePaperStoragePath:
			report?.references?.paperStoragePath ?? draft?.references?.paperStoragePath,
		markSchemeUrl: run.paper?.markSchemeUrl,
		markSchemeStoragePath: run.paper?.markSchemeStoragePath,
		referenceMarkSchemeUrl: report?.references?.markSchemeUrl ?? draft?.references?.markSchemeUrl,
		referenceMarkSchemeStoragePath:
			report?.references?.markSchemeStoragePath ?? draft?.references?.markSchemeStoragePath
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
