import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { runAgentLoop, tool } from '@ljoukov/llm';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getTutorSession, patchTutorSession } from '$lib/server/tutorSessions/repo';
import {
	TUTOR_STATE_SESSION_PATH,
	TUTOR_UI_INLINE_FEEDBACK_PATH,
	buildTutorScreenState,
	readTutorWorkspaceState,
	writeTutorWorkspaceTextFile
} from '$lib/server/tutorSessions/workspace';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

const paramsSchema = z.object({
	sessionId: z.string().trim().min(1)
});

const requestSchema = z.object({
	text: z.string(),
	revision: z.number().int().min(0)
});

function buildDraftPrompt(options: {
	draft: string;
	tutorMarkdown: string;
	problem: string;
	transcript: string;
	grading: string;
	annotations: string;
	overallFeedback: string;
}): string {
	return [
		'You are generating inline gray coaching text for a maths tutor composer.',
		'This is not the main tutor response. Keep it short, specific, and non-solution-giving.',
		'Write at most two short sentences.',
		'Prefer encouragement, precision checks, and proof-logic prompts over hints that give the next step away.',
		'If the student draft is too short or vague, ask for the missing thing directly.',
		'Do not restate the whole problem. Do not solve the problem.',
		'',
		'Current top tutor response:',
		options.tutorMarkdown,
		'',
		'Problem:',
		options.problem,
		'',
		'Student transcript from the original graded work:',
		options.transcript,
		'',
		'Grading summary:',
		options.grading,
		'',
		'Line-by-line annotations:',
		options.annotations,
		'',
		'Overall feedback:',
		options.overallFeedback,
		'',
		'Current student draft:',
		options.draft
	].join('\n');
}

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsedParams: z.infer<typeof paramsSchema>;
	let parsedBody: z.infer<typeof requestSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
		parsedBody = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	const session = await getTutorSession(userId, parsedParams.sessionId);
	if (!session) {
		return json({ error: 'session_not_found' }, { status: 404 });
	}

	const now = new Date();
	const serviceAccountJson = requireTutorServiceAccountJson();

	await patchTutorSession(userId, session.id, {
		latestDraftRevision: parsedBody.revision
	});

	const draft = parsedBody.text.trim();
	if (session.status !== 'awaiting_student' || draft.length === 0) {
		await Promise.all([
			writeTutorWorkspaceTextFile({
				serviceAccountJson,
				userId,
				workspaceId: session.workspaceId,
				filePath: TUTOR_UI_INLINE_FEEDBACK_PATH,
				content: '',
				now
			}),
			writeTutorWorkspaceTextFile({
				serviceAccountJson,
				userId,
				workspaceId: session.workspaceId,
				filePath: TUTOR_STATE_SESSION_PATH,
				content: `${JSON.stringify(
					buildTutorScreenState({
						session: {
							...session,
							updatedAt: session.updatedAt
						},
						draftRevision: parsedBody.revision,
						focusLabel: session.focusLabel ?? null
					}),
					null,
					2
				)}\n`,
				now
			})
		]);
		return json({ status: 'cleared' }, { status: 200 });
	}

	const workspace = await readTutorWorkspaceState({
		serviceAccountJson,
		userId,
		workspaceId: session.workspaceId,
		session
	});

	let toolCalled = false;
	const set_inline_feedback = tool({
		description: "Write the short inline gray coaching text shown inside the student's composer.",
		inputSchema: z
			.object({
				markdown: z.string()
			})
			.strict(),
		execute: async ({ markdown }) => {
			const latestSession = await getTutorSession(userId, session.id);
			if (
				!latestSession ||
				latestSession.latestDraftRevision !== parsedBody.revision ||
				latestSession.status !== 'awaiting_student'
			) {
				return { status: 'stale_skipped' };
			}
			toolCalled = true;
			await Promise.all([
				writeTutorWorkspaceTextFile({
					serviceAccountJson,
					userId,
					workspaceId: session.workspaceId,
					filePath: TUTOR_UI_INLINE_FEEDBACK_PATH,
					content: markdown.trim(),
					now: new Date()
				}),
				writeTutorWorkspaceTextFile({
					serviceAccountJson,
					userId,
					workspaceId: session.workspaceId,
					filePath: TUTOR_STATE_SESSION_PATH,
					content: `${JSON.stringify(
						buildTutorScreenState({
							session: latestSession,
							draftRevision: parsedBody.revision,
							focusLabel: latestSession.focusLabel ?? null
						}),
						null,
						2
					)}\n`,
					now: new Date()
				})
			]);
			return { status: 'updated' };
		}
	});

	const result = await runAgentLoop({
		model: 'chatgpt-gpt-5.4',
		input: buildDraftPrompt({
			draft,
			tutorMarkdown: workspace.tutorMarkdown,
			problem: workspace.context.problem,
			transcript: workspace.context.transcript,
			grading: workspace.context.grading,
			annotations: workspace.context.annotations,
			overallFeedback: workspace.context.overallFeedback
		}),
		instructions:
			'Call set_inline_feedback exactly once. Do not produce the main tutor response. Do not give away the answer.',
		tools: {
			set_inline_feedback
		},
		maxSteps: 2
	});

	if (!toolCalled && result.text.trim().length > 0) {
		const latestSession = await getTutorSession(userId, session.id);
		if (
			latestSession &&
			latestSession.latestDraftRevision === parsedBody.revision &&
			latestSession.status === 'awaiting_student'
		) {
			await Promise.all([
				writeTutorWorkspaceTextFile({
					serviceAccountJson,
					userId,
					workspaceId: session.workspaceId,
					filePath: TUTOR_UI_INLINE_FEEDBACK_PATH,
					content: result.text.trim(),
					now: new Date()
				}),
				writeTutorWorkspaceTextFile({
					serviceAccountJson,
					userId,
					workspaceId: session.workspaceId,
					filePath: TUTOR_STATE_SESSION_PATH,
					content: `${JSON.stringify(
						buildTutorScreenState({
							session: latestSession,
							draftRevision: parsedBody.revision,
							focusLabel: latestSession.focusLabel ?? null
						}),
						null,
						2
					)}\n`,
					now: new Date()
				})
			]);
		}
	}

	return json({ status: 'ok' }, { status: 200 });
};
