import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { PaperSheetAnswersSchema } from '@spark/schemas';
import { upsertWorkspaceTextFileDoc } from '@spark/llm';
import { env } from '$env/dynamic/private';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getGraderRun, patchGraderRun } from '$lib/server/grader/repo';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	answers: PaperSheetAnswersSchema
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

export const POST: RequestHandler = async ({ request, params }) => {
	const auth = await authenticateApiRequest(request);
	if (!auth.ok) {
		return auth.response;
	}
	const { user } = auth;

	try {
		const { sheetId } = paramsSchema.parse(params);
		const { answers } = requestSchema.parse(await request.json());
		const run = await getGraderRun(user.uid, sheetId);
		if (!run) {
			return json({ error: 'sheet_not_found' }, { status: 404 });
		}
		if (run.sheetPhase === 'graded') {
			return json(
				{ error: 'sheet_already_graded', message: 'This sheet is already graded.' },
				{ status: 409 }
			);
		}

		const now = new Date();
		const answersPath =
			run.draftAnswersPath && run.draftAnswersPath.trim().length > 0
				? run.draftAnswersPath
				: 'sheet/state/answers.json';
		const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
		if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
			return json(
				{ error: 'config_error', message: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing.' },
				{ status: 500 }
			);
		}
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
		await patchGraderRun(user.uid, run.id, {
			draftAnswersPath: answersPath,
			updatedAt: now
		});

		return json({
			status: 'saved',
			answersPath
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		console.error('Failed to save sheet draft answers', {
			error
		});
		return json(
			{ error: 'save_failed', message: 'Unable to save worksheet answers.' },
			{ status: 500 }
		);
	}
};
