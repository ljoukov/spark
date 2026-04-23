import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import {
	buildSparkGraderAgentPrompt,
	buildSparkGraderBrief,
	createTask,
	renderSparkGraderTask,
	resolveSparkAgentSkillFiles,
	SparkChatAttachmentInputSchema,
	SPARK_GRADER_SKILL_IDS,
	SPARK_GRADER_UPLOADS_MANIFEST_PATH,
	SPARK_GRADER_SHEET_PATH,
	SPARK_GRADER_SUMMARY_PATH,
	upsertWorkspaceTextFileDoc
} from '@spark/llm';
import { PaperSheetAnswersSchema } from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	getFirestoreDocument,
	patchFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import {
	safeParseGraderWorksheetReport,
	safeParseSolveSheetDraft
} from '$lib/server/grader/problemReport';
import graderTaskTemplate from '$lib/server/graderAgent/task-template.md?raw';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	answers: PaperSheetAnswersSchema.optional(),
	disableAutoGapsFinder: z.boolean().optional()
});

const uploadManifestAttachmentSchema = SparkChatAttachmentInputSchema.omit({ id: true })
	.extend({
		id: z.string().trim().min(1).optional()
	})
	.transform((attachment) => ({
		...attachment,
		id: attachment.id ?? attachment.storagePath ?? attachment.localPath ?? attachment.filename ?? randomUUID()
	}));

const uploadManifestSchema = z.object({
	attachments: z.array(uploadManifestAttachmentSchema).default([])
});

function buildDraftAnswersContent(answers: z.infer<typeof PaperSheetAnswersSchema>): string {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			mode: 'draft_answers',
			answers
		},
		null,
		2
	)}\n`;
}

function buildGraderTaskWithDraftContext(): string {
	return [
		renderSparkGraderTask(graderTaskTemplate).trim(),
		'',
		'## Digital worksheet-answer grading (must follow)',
		'- This is `sheet-answer-grading`, not handwritten/source transcription.',
		'- Read `sheet/output/draft.json` before you build the final graded worksheet.',
		'- Read `sheet/state/answers.json` and use those recorded answers as the student submission.',
		'- Do not transcribe, OCR, crop, render source pages, or run a source-fidelity audit just to capture the student answers; the answers are already digital.',
		'- Preserve the draft worksheet structure, numbering, marks, tables, cloze blanks, and flow-chart layout exactly unless a validation error forces a minimal schema repair.',
		'- For `mcq` answers, grade the selected option id. For `answer_bank`, `fill`, `cloze`, `match`, `spelling`, and `flow`, grade the saved object values. For `lines` and `calc`, grade the saved string value.',
		'- Use draft `references.officialSolutionMarkdown` or `references.gradingMarkdown` as the answer key when present. If no key exists, solve from the visible draft prompt at the stated student level.',
		'- Write `grader/output/sheet.json` and `grader/output/run-summary.json`, then call `validate_grader_artifacts({"requireSourceFidelityAudit": false})` and `publish_sheet({})`.',
		'- `grader/output/transcription.md` is not required for this digital-answer path.'
	]
		.join('\n')
		.trim()
		.concat('\n');
}

function buildDirectGraderRerunTask(options: { sourcePaperOnlyNoStudent: boolean }): string {
	return [
		renderSparkGraderTask(graderTaskTemplate).trim(),
		'',
		'## Existing grader rerun context',
		'- This is a rerun for an existing grader worksheet, not a grade-from-draft request.',
		'- Use the uploaded/linked source material and any existing grader workspace artifacts only as context for rebuilding the worksheet.',
		'- Do not require `sheet/output/draft.json` or `sheet/state/answers.json`; those files only exist for generated draft-sheet grading.',
		options.sourcePaperOnlyNoStudent
			? '- No student answers were provided in the original run. Publish an unanswered source worksheet with `review.mode` set to `"awaiting_answers"` and no per-question scores.'
			: '- If student answers are present, include per-question scores for every question so the UI can show awarded/total marks.'
	]
		.join('\n')
		.trim()
		.concat('\n');
}

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function requireTasksEnv(): { serviceUrl: string; apiKey: string } {
	const serviceUrl = env.TASKS_SERVICE_URL;
	if (!serviceUrl || serviceUrl.trim().length === 0) {
		throw new Error('TASKS_SERVICE_URL is missing');
	}
	const apiKey = env.TASKS_API_KEY;
	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('TASKS_API_KEY is missing');
	}
	return { serviceUrl, apiKey };
}

async function hasStopRequestedAgent(options: {
	serviceAccountJson: string;
	userId: string;
	agentId: string;
}): Promise<boolean> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: options.serviceAccountJson,
		documentPath: `users/${options.userId}/agents/${options.agentId}`
	});
	return snapshot.exists && snapshot.data?.stop_requested === true;
}

export const POST: RequestHandler = async ({ request, params }) => {
	const auth = await authenticateApiRequest(request);
	if (!auth.ok) {
		return auth.response;
	}
	const { user } = auth;

	try {
		const { sheetId } = paramsSchema.parse(params);
		const { answers, disableAutoGapsFinder } = requestSchema.parse(
			await request.json().catch(() => ({}))
		);
		const run = await getGraderRun(user.uid, sheetId);
		if (!run) {
			return json({ error: 'sheet_not_found' }, { status: 404 });
		}
		const serviceAccountJson = requireServiceAccountJson();
		const tasksEnv = requireTasksEnv();
		if (run.sheetPhase === 'building' && run.status !== 'done') {
			return json(
				{ error: 'sheet_not_ready', message: 'This sheet is still being prepared.' },
				{ status: 409 }
			);
		}
		if (run.sheetPhase === 'grading' && run.status === 'executing') {
			if (
				!(await hasStopRequestedAgent({
					serviceAccountJson,
					userId: user.uid,
					agentId: run.agentId
				}))
			) {
				return json(
					{ error: 'grading_in_progress', message: 'This sheet is already being graded.' },
					{ status: 409 }
				);
			}
		}

		const now = new Date();
		const currentArtifactPath = run.sheet?.filePath ?? run.sheetPath;
		const currentArtifactRaw = await getWorkspaceTextFile(user.uid, run.workspaceId, currentArtifactPath);
		const currentReport = currentArtifactRaw
			? safeParseGraderWorksheetReport(currentArtifactRaw)
			: null;
		const currentDraft = currentArtifactRaw ? safeParseSolveSheetDraft(currentArtifactRaw) : null;
		const gradeFromDraft = currentReport === null && (currentDraft !== null || run.sheetPhase === 'solving');
		const sourcePaperOnlyNoStudent =
			!gradeFromDraft && !answers && currentReport?.review.mode === 'awaiting_answers';
		const answersPath =
			run.draftAnswersPath && run.draftAnswersPath.trim().length > 0
				? run.draftAnswersPath
				: 'sheet/state/answers.json';
		if (answers) {
			await upsertWorkspaceTextFileDoc({
				serviceAccountJson,
				userId: user.uid,
				workspaceId: run.workspaceId,
				filePath: answersPath,
				content: buildDraftAnswersContent(answers),
				contentType: 'application/json',
				createdAt: now,
				updatedAt: now
			});
		}

		const uploadsRaw = await getWorkspaceTextFile(
			user.uid,
			run.workspaceId,
			SPARK_GRADER_UPLOADS_MANIFEST_PATH
		);
		const uploads = uploadsRaw
			? uploadManifestSchema.parse(JSON.parse(uploadsRaw)).attachments
			: [];
		const seedEmptyUploadManifest = uploadsRaw === null;
		const agentId = randomUUID();
		const input = {
			referenceSourcePolicy: gradeFromDraft
				? ('uploaded-only' as const)
				: ('allow-official-references' as const),
			...(sourcePaperOnlyNoStudent
				? {
						sourcePaperOnlyNoStudent: true,
						notes:
							'No student answers were provided in the original run. Rebuild the uploaded source as an unanswered worksheet and keep review.mode as awaiting_answers.'
					}
				: {
						notes: gradeFromDraft
							? 'Digital-answer grading: the worksheet draft already exists in sheet/output/draft.json and the recorded answers are in sheet/state/answers.json. Do not transcribe or OCR student answers; preserve the draft structure and grade the saved answer values.'
							: 'Rerun the grader for the existing worksheet using the original uploaded material and linked workspace artifacts.'
					})
		};
		const brief = buildSparkGraderBrief({
			sourceText: run.userPrompt,
			input,
			attachments: uploads
		});
		const requestPayload = {
			createdAt: now.toISOString(),
			sourceText: run.userPrompt ?? null,
			input,
			attachments: uploads,
			...(sourcePaperOnlyNoStudent ? { sourcePaperOnlyNoStudent: true } : {})
		};
		const skillFiles = resolveSparkAgentSkillFiles(SPARK_GRADER_SKILL_IDS);
		const graderTask = gradeFromDraft
			? buildGraderTaskWithDraftContext()
			: buildDirectGraderRerunTask({ sourcePaperOnlyNoStudent });

		await Promise.all([
			upsertWorkspaceTextFileDoc({
				serviceAccountJson,
				userId: user.uid,
				workspaceId: run.workspaceId,
				filePath: 'brief.md',
				content: gradeFromDraft
					? `${brief.trim()}\n\n## Existing worksheet draft paths\n- sheet/output/draft.json\n- ${answersPath}\n`
					: `${brief.trim()}\n\n## Existing grader artifact path\n- ${currentArtifactPath}\n`,
				contentType: 'text/markdown',
				createdAt: now,
				updatedAt: now
			}),
			upsertWorkspaceTextFileDoc({
				serviceAccountJson,
				userId: user.uid,
				workspaceId: run.workspaceId,
				filePath: 'request.json',
				content: `${JSON.stringify(requestPayload, null, 2)}\n`,
				contentType: 'application/json',
				createdAt: now,
				updatedAt: now
			}),
			upsertWorkspaceTextFileDoc({
				serviceAccountJson,
				userId: user.uid,
				workspaceId: run.workspaceId,
				filePath: 'grader/task.md',
				content: graderTask,
				contentType: 'text/markdown',
				createdAt: now,
				updatedAt: now
			}),
			...(seedEmptyUploadManifest
				? [
						upsertWorkspaceTextFileDoc({
							serviceAccountJson,
							userId: user.uid,
							workspaceId: run.workspaceId,
							filePath: SPARK_GRADER_UPLOADS_MANIFEST_PATH,
							content: `${JSON.stringify({ attachments: [] }, null, 2)}\n`,
							contentType: 'application/json',
							createdAt: now,
							updatedAt: now
						})
					]
				: []),
			...skillFiles.map((skillFile) =>
				upsertWorkspaceTextFileDoc({
					serviceAccountJson,
					userId: user.uid,
					workspaceId: run.workspaceId,
					filePath: skillFile.path,
					content: skillFile.content,
					contentType: skillFile.contentType,
					createdAt: now,
					updatedAt: now
				})
			)
		]);

		await setFirestoreDocument({
			serviceAccountJson,
			documentPath: `users/${user.uid}/agents/${agentId}`,
			data: {
				id: agentId,
				prompt: buildSparkGraderAgentPrompt({
					summaryPath: SPARK_GRADER_SUMMARY_PATH,
					sheetPath: SPARK_GRADER_SHEET_PATH
				}),
				status: 'created',
				workspaceId: run.workspaceId,
				graderRunId: run.id,
				graderSummaryPath: SPARK_GRADER_SUMMARY_PATH,
				graderSheetPath: SPARK_GRADER_SHEET_PATH,
				inputAttachments: uploads,
				graderInputAttachments: uploads,
				...(disableAutoGapsFinder === true ? { disableAutoGapsFinder: true } : {}),
				createdAt: now,
				updatedAt: now,
				statesTimeline: [{ state: 'created', timestamp: now }]
			}
		});

		await patchFirestoreDocument({
			serviceAccountJson,
			documentPath: `spark/${user.uid}/graderRuns/${run.id}`,
			updates: {
				agentId,
				status: 'executing',
				sheetPhase: 'grading',
				draftAnswersPath: answersPath,
				updatedAt: now,
				summaryPath: run.summaryPath,
				sheetPath: run.sheetPath
			},
			deletes: ['error', 'completedAt', 'resultSummary']
		});

		await createTask(
			{
				type: 'runAgent',
				runAgent: { userId: user.uid, agentId, workspaceId: run.workspaceId }
			},
			{
				serviceUrl: tasksEnv.serviceUrl,
				apiKey: tasksEnv.apiKey,
				serviceAccountJson
			}
		);

		return json({
			status: 'started',
			agentId
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		console.error('Failed to start sheet grading', {
			error
		});
		return json(
			{ error: 'grade_failed', message: 'Unable to start grading for this sheet.' },
			{ status: 500 }
		);
	}
};
