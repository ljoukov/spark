import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import {
	buildSparkGraderAgentPrompt,
	buildSparkGraderBrief,
	createTask,
	renderSparkGraderTask,
	SparkChatAttachmentInputSchema,
	SPARK_GRADER_UPLOADS_MANIFEST_PATH,
	SPARK_GRADER_SHEET_PATH,
	SPARK_GRADER_SUMMARY_PATH,
	upsertWorkspaceTextFileDoc
} from '@spark/llm';
import { PaperSheetAnswersSchema } from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { patchFirestoreDocument, setFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import graderTaskTemplate from '$lib/server/graderAgent/task-template.md?raw';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	answers: PaperSheetAnswersSchema.optional()
});

const uploadManifestSchema = z.object({
	attachments: z.array(SparkChatAttachmentInputSchema).default([])
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
		'## Existing worksheet draft (must follow)',
		'- Read `sheet/output/draft.json` before you build the final graded worksheet.',
		'- Preserve that worksheet structure, numbering, tables, cloze blanks, and flow-chart layout unless a validation error forces a minimal repair.',
		'- Read `sheet/state/answers.json` and use those recorded answers as the student submission.',
		'- Keep the final graded worksheet aligned to the draft sheet the student saw.'
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

export const POST: RequestHandler = async ({ request, params }) => {
	const auth = await authenticateApiRequest(request);
	if (!auth.ok) {
		return auth.response;
	}
	const { user } = auth;

	try {
		const { sheetId } = paramsSchema.parse(params);
		const { answers } = requestSchema.parse(await request.json().catch(() => ({})));
		const run = await getGraderRun(user.uid, sheetId);
		if (!run) {
			return json({ error: 'sheet_not_found' }, { status: 404 });
		}
		if (run.sheetPhase === 'building' && run.status !== 'done') {
			return json(
				{ error: 'sheet_not_ready', message: 'This sheet is still being prepared.' },
				{ status: 409 }
			);
		}
		if (run.sheetPhase === 'graded') {
			return json(
				{ error: 'sheet_already_graded', message: 'This sheet is already graded.' },
				{ status: 409 }
			);
		}
		if (run.sheetPhase === 'grading' && run.status === 'executing') {
			return json(
				{ error: 'grading_in_progress', message: 'This sheet is already being graded.' },
				{ status: 409 }
			);
		}

		const serviceAccountJson = requireServiceAccountJson();
		const tasksEnv = requireTasksEnv();
		const now = new Date();
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
		const uploads = uploadsRaw ? uploadManifestSchema.parse(JSON.parse(uploadsRaw)).attachments : [];
		const agentId = randomUUID();
		const input = {
			referenceSourcePolicy: 'uploaded-only' as const,
			notes:
				'The worksheet draft already exists in sheet/output/draft.json and the recorded answers are in sheet/state/answers.json. Preserve that student-facing structure when building the graded sheet.'
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
			attachments: uploads
		};

		await Promise.all([
			upsertWorkspaceTextFileDoc({
				serviceAccountJson,
				userId: user.uid,
				workspaceId: run.workspaceId,
				filePath: 'brief.md',
				content: `${brief.trim()}\n\n## Existing worksheet draft paths\n- sheet/output/draft.json\n- ${answersPath}\n`,
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
				content: buildGraderTaskWithDraftContext(),
				contentType: 'text/markdown',
				createdAt: now,
				updatedAt: now
			})
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
