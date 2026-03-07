import { deleteFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { listGraderRuns, resolveGraderRunDocPath } from '$lib/server/grader/repo';
import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required')
});

const runIdSchema = z.object({
	runId: z.string().trim().min(1, 'runId is required')
});

const GRADER_RUN_LIST_LIMIT = 100;

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function toIso(value: Date): string {
	return value.toISOString();
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);
	const runs = await listGraderRuns(userId, GRADER_RUN_LIST_LIMIT);

	const serializedRuns = runs.map((run) => {
		const raw = {
			id: run.id,
			agentId: run.agentId,
			workspaceId: run.workspaceId,
			conversationId: run.conversationId ?? null,
			userPrompt: run.userPrompt ?? null,
			olympiadKey: run.olympiadKey,
			olympiadLabel: run.olympiadLabel,
			summaryPath: run.summaryPath,
			problemsDir: run.problemsDir,
			sourceAttachmentIds: run.sourceAttachmentIds ?? [],
			sourceAttachmentCount: run.sourceAttachmentCount ?? 0,
			status: run.status,
			paper: run.paper
				? {
						olympiad: run.paper.olympiad ?? null,
						year: run.paper.year ?? null,
						paperName: run.paper.paperName ?? null,
						paperUrl: run.paper.paperUrl ?? null,
						markSchemeUrl: run.paper.markSchemeUrl ?? null
					}
				: null,
			presentation: run.presentation
				? {
						title: run.presentation.title ?? null,
						summaryMarkdown: run.presentation.summaryMarkdown ?? null
					}
				: null,
			totals: run.totals
				? {
						awardedMarks: run.totals.awardedMarks,
						maxMarks: run.totals.maxMarks,
						problemCount: run.totals.problemCount,
						gradedCount: run.totals.gradedCount,
						percentage: run.totals.percentage ?? null
					}
				: null,
			problems:
				run.problems?.map((problem) => ({
					id: problem.id,
					index: problem.index,
					title: problem.title ?? null,
					awardedMarks: typeof problem.awardedMarks === 'number' ? problem.awardedMarks : null,
					maxMarks: typeof problem.maxMarks === 'number' ? problem.maxMarks : null,
					verdict: problem.verdict ?? null,
					filePath: problem.filePath
				})) ?? [],
			resultSummary: run.resultSummary ?? null,
			error: run.error ?? null,
			createdAt: toIso(run.createdAt),
			updatedAt: toIso(run.updatedAt),
			completedAt: run.completedAt ? toIso(run.completedAt) : null
		};

		return {
			...raw,
			rawJson: JSON.stringify(raw, null, 2)
		};
	});

	return {
		runs: serializedRuns
	};
};

export const actions: Actions = {
	deleteRun: async ({ params, request }) => {
		const { userId } = paramsSchema.parse(params);
		const formData = await request.formData();
		const parsed = runIdSchema.safeParse({
			runId: typeof formData.get('runId') === 'string' ? formData.get('runId') : ''
		});
		if (!parsed.success) {
			const [issue] = parsed.error.issues;
			return fail(400, { error: issue?.message ?? 'Run ID is required.' });
		}

		const runId = parsed.data.runId;
		const serviceAccountJson = requireServiceAccountJson();

		try {
			await deleteFirestoreDocument({
				serviceAccountJson,
				documentPath: resolveGraderRunDocPath(userId, runId)
			});

			return { success: { message: `Deleted grader run ${runId}.` } as const };
		} catch (error) {
			console.error('Failed to delete grader run', { userId, runId, error });
			return fail(500, { error: 'Failed to delete grader run. Please try again.' });
		}
	}
};
