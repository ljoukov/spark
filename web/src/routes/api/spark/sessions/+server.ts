import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getWorkspaceTextFile, getGraderRun } from '$lib/server/grader/repo';
import { parseGraderProblemReport } from '$lib/server/grader/problemReport';
import {
	createTutorSession,
	findTutorSessionForGraderProblem,
} from '$lib/server/tutorSessions/repo';
import {
	ensureWorkspaceDoc,
	requireTutorServiceAccountJson
} from '$lib/server/tutorSessions/service';
import { seedTutorWorkspace } from '$lib/server/tutorSessions/workspace';
import {
	buildInitialTutorReviewState,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	summarizeTutorReviewState
} from '$lib/server/tutorSessions/reviewState';
import { SparkTutorSessionSchema } from '@spark/schemas';

const requestSchema = z.object({
	source: z.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('grader-problem'),
			runId: z.string().trim().min(1),
			problemId: z.string().trim().min(1)
		})
	])
});

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsed: z.infer<typeof requestSchema>;
	try {
		parsed = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	const source = parsed.source;
	if (source.kind !== 'grader-problem') {
		return json({ error: 'unsupported_source' }, { status: 400 });
	}

	const existing = await findTutorSessionForGraderProblem({
		userId,
		runId: source.runId,
		problemId: source.problemId
	});
	if (existing) {
		return json(
			{
				sessionId: existing.id,
				href: `/spark/sessions/${existing.id}`,
				existing: true
			},
			{ status: 200 }
		);
	}

	const run = await getGraderRun(userId, source.runId);
	if (!run) {
		return json({ error: 'grader_run_not_found' }, { status: 404 });
	}
	const problem = (run.problems ?? []).find((entry) => entry.id === source.problemId);
	if (!problem) {
		return json({ error: 'problem_not_found' }, { status: 404 });
	}
	const markdown = await getWorkspaceTextFile(userId, run.workspaceId, problem.filePath);
	if (!markdown) {
		return json({ error: 'problem_report_not_found' }, { status: 404 });
	}

	const sections = parseGraderProblemReport(markdown);
	const now = new Date();
	const sessionId = randomUUID();
	const workspaceId = randomUUID();
	const title = `Problem ${problem.index.toString()} tutor`;
	const reviewState = buildInitialTutorReviewState({
		sections,
		now
	});
	const reviewSummary = summarizeTutorReviewState(reviewState);

	const session = SparkTutorSessionSchema.parse({
		id: sessionId,
		workspaceId,
		status: reviewSummary.allResolved ? 'completed' : 'awaiting_student',
		source: {
			kind: 'grader-problem',
			runId: run.id,
			problemId: problem.id,
			problemIndex: problem.index,
			problemTitle: problem.title ?? `Problem ${problem.index.toString()}`,
			...(problem.verdict ? { verdict: problem.verdict } : {}),
			...(typeof problem.awardedMarks === 'number' ? { awardedMarks: problem.awardedMarks } : {}),
			...(typeof problem.maxMarks === 'number' ? { maxMarks: problem.maxMarks } : {})
		},
		title,
		preview: buildTutorReviewPreview(reviewState),
		...(buildTutorReviewFocusLabel(reviewState)
			? { focusLabel: buildTutorReviewFocusLabel(reviewState) }
			: {}),
		createdAt: now,
		updatedAt: now,
		...(reviewSummary.allResolved ? { completedAt: now } : {})
	});

	await ensureWorkspaceDoc({
		userId,
		workspaceId,
		sessionId,
		now
	});
	await createTutorSession(userId, session);
	await seedTutorWorkspace({
		serviceAccountJson: requireTutorServiceAccountJson(),
		userId,
		workspaceId,
		session,
		sections,
		now
	});

	return json(
		{
			sessionId,
			href: `/spark/sessions/${sessionId}`,
			existing: false
		},
		{ status: 201 }
	);
};
