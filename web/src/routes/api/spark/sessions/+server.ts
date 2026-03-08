import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getWorkspaceTextFile, getGraderRun } from '$lib/server/grader/repo';
import { parseGraderProblemReport } from '$lib/server/grader/problemReport';
import {
	createTutorSession,
	findTutorSessionForGraderProblem,
	patchTutorSession
} from '$lib/server/tutorSessions/repo';
import {
	ensureWorkspaceDoc,
	createTutorTurnAgentRun,
	requireTutorServiceAccountJson
} from '$lib/server/tutorSessions/service';
import { seedTutorWorkspace } from '$lib/server/tutorSessions/workspace';
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
	const agentId = randomUUID();
	const title = `Problem ${problem.index.toString()} tutor`;

	const session = SparkTutorSessionSchema.parse({
		id: sessionId,
		workspaceId,
		status: 'responding',
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
		preview: 'Preparing your tutor session.',
		activeTurnAgentId: agentId,
		latestDraftRevision: 0,
		createdAt: now,
		updatedAt: now
	});

	await ensureWorkspaceDoc({
		userId,
		workspaceId,
		agentId,
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
	await patchTutorSession(userId, sessionId, {
		activeTurnAgentId: agentId,
		status: 'responding',
		updatedAt: now
	});

	await createTutorTurnAgentRun({
		userId,
		agentId,
		workspaceId,
		sessionId,
		prompt: `Open the tutor session for ${title} and deliver the first coaching turn.`,
		title,
		action: 'initial',
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
