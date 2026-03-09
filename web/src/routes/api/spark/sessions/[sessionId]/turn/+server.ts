import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { generateText, parseJsonFromLlmText } from '@spark/llm';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	TUTOR_FALLBACK_REVIEW_REPLY_MARKDOWN,
	TUTOR_THREAD_REPLY_TIMEOUT_MS,
	recoverTutorSessionIfStale
} from '$lib/server/tutorSessions/recovery';
import { getTutorSession, patchTutorSession } from '$lib/server/tutorSessions/repo';
import {
	appendTutorReviewMessage,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	findTutorReviewThread,
	summarizeTutorReviewState,
	updateTutorReviewThread
} from '$lib/server/tutorSessions/reviewState';
import {
	TUTOR_STATE_COMPOSER_PATH,
	TUTOR_STATE_REVIEW_PATH,
	TUTOR_STATE_SESSION_PATH,
	buildTutorComposerState,
	buildTutorScreenState,
	readTutorWorkspaceState,
	writeTutorWorkspaceTextFile
} from '$lib/server/tutorSessions/workspace';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

const paramsSchema = z.object({
	sessionId: z.string().trim().min(1)
});

const requestSchema = z.object({
	action: z.literal('reply'),
	threadId: z.string().trim().min(1),
	text: z.string().trim().min(1)
});

function stringifyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function formatThreadMessages(markdownByRole: Array<{ author: 'assistant' | 'student'; markdown: string }>): string {
	return markdownByRole
		.map((entry) => `${entry.author === 'assistant' ? 'Reviewer' : 'Student'}:\n${entry.markdown}`)
		.join('\n\n');
}

function buildTutorThreadPrompt(options: {
	problemMarkdown: string;
	officialSolutionMarkdown: string;
	transcriptMarkdown: string;
	gradingMarkdown: string;
	overallFeedbackMarkdown: string;
	threadLabel: string;
	threadExcerpt: string | null;
	threadMessages: Array<{ author: 'assistant' | 'student'; markdown: string }>;
	studentReplyMarkdown: string;
}): string {
	return [
		'You are replying on a maths tutor review thread that should feel like a GitHub PR review conversation.',
		'Focus only on the selected thread.',
		'If the student has now addressed the issue, acknowledge that briefly and mark it resolved.',
		'If the issue is still open, explain the single most important missing point and keep the student doing the work.',
		'Do not give away a full solution unless the thread is clearly blocked without one.',
		'Keep the reviewer reply concise and specific.',
		'',
		'Official problem formulation:',
		options.problemMarkdown || '(missing)',
		'',
		'Official solution baseline:',
		options.officialSolutionMarkdown || '(missing)',
		'',
		'Full student transcript:',
		options.transcriptMarkdown || '(missing)',
		'',
		'Grading summary:',
		options.gradingMarkdown || '(missing)',
		'',
		'Problem-level feedback:',
		options.overallFeedbackMarkdown || '(missing)',
		'',
		`Selected thread: ${options.threadLabel}`,
		options.threadExcerpt ? `Attached student text: ${options.threadExcerpt}` : 'Attached student text: none',
		'',
		'Thread conversation so far:',
		formatThreadMessages(options.threadMessages),
		'',
		'Latest student reply:',
		options.studentReplyMarkdown,
		'',
		'Return JSON only in this exact shape:',
		'{"assistantReplyMarkdown":"string","resolved":true}'
	].join('\n');
}

async function withTimeout<T>(options: {
	label: string;
	timeoutMs: number;
	run: () => Promise<T>;
}): Promise<T> {
	return await new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`${options.label}_timeout`));
		}, options.timeoutMs);

		options
			.run()
			.then((value) => {
				clearTimeout(timeout);
				resolve(value);
			})
			.catch((error) => {
				clearTimeout(timeout);
				reject(error);
			});
	});
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

	let session = await getTutorSession(userId, parsedParams.sessionId);
	if (!session) {
		return json({ error: 'session_not_found' }, { status: 404 });
	}
	if (session.status === 'completed') {
		return json({ error: 'session_completed' }, { status: 409 });
	}

	const serviceAccountJson = requireTutorServiceAccountJson();
	let workspace = await readTutorWorkspaceState({
		serviceAccountJson,
		userId,
		workspaceId: session.workspaceId,
		session
	});
	const recovered = await recoverTutorSessionIfStale({
		serviceAccountJson,
		userId,
		session,
		reviewState: workspace.reviewState,
		draftRevision: session.latestDraftRevision
	});
	if (recovered) {
		console.warn('Recovered stale tutor review state before handling reply', {
			userId,
			sessionId: session.id,
			recoveredThreadIds: recovered.recoveredThreadIds
		});
		session = recovered.session;
		workspace = {
			...workspace,
			screenState: recovered.screenState,
			composerState: recovered.composerState,
			reviewState: recovered.reviewState
		};
	}

	if (session.status === 'completed') {
		return json({ error: 'session_completed' }, { status: 409 });
	}
	if (session.status === 'responding') {
		return json({ error: 'session_busy' }, { status: 409 });
	}

	const now = new Date();
	const currentThread = findTutorReviewThread(workspace.reviewState, parsedBody.threadId);
	if (!currentThread) {
		return json({ error: 'thread_not_found' }, { status: 404 });
	}
	if (currentThread.status === 'resolved') {
		return json({ error: 'thread_resolved' }, { status: 409 });
	}

	const studentReplyThread = appendTutorReviewMessage({
		thread: currentThread,
		author: 'student',
		markdown: parsedBody.text,
		createdAt: now.toISOString(),
		status: 'responding'
	});
	const respondingReviewState = updateTutorReviewThread({
		reviewState: workspace.reviewState,
		thread: studentReplyThread,
		now
	});
	const respondingSession = {
		...session,
		status: 'responding' as const,
		updatedAt: now
	};

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_REVIEW_PATH,
			content: stringifyJson(respondingReviewState),
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_SESSION_PATH,
			content: stringifyJson(
				buildTutorScreenState({
					session: respondingSession,
					draftRevision: session.latestDraftRevision,
					focusLabel: currentThread.label
				})
			),
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_COMPOSER_PATH,
			content: stringifyJson(
				buildTutorComposerState({
					placeholder: 'Spark is reviewing your reply...',
					disabled: true,
					allowConfidence: false,
					hintButtons: []
				})
			),
			now
		}),
		patchTutorSession(userId, session.id, {
			status: 'responding',
			updatedAt: now,
			focusLabel: currentThread.label
		})
	]);

	type ReviewDecision = {
		assistantReplyMarkdown: string;
		resolved: boolean;
	};

	let rawModelReply = '';
	try {
		console.info('Tutor review reply generation started', {
			userId,
			sessionId: session.id,
			threadId: currentThread.id
		});
		rawModelReply = await withTimeout({
			label: 'tutor_review_reply',
			timeoutMs: TUTOR_THREAD_REPLY_TIMEOUT_MS,
			run: async () =>
				await generateText({
					modelId: 'chatgpt-gpt-5.4-fast',
					contents: [
						{
							role: 'user',
							parts: [
								{
									type: 'text',
									text: buildTutorThreadPrompt({
										problemMarkdown: workspace.context.problem,
										officialSolutionMarkdown: workspace.context.officialSolution,
										transcriptMarkdown: workspace.context.transcript,
										gradingMarkdown: workspace.context.grading,
										overallFeedbackMarkdown: workspace.context.overallFeedback,
										threadLabel: currentThread.label,
										threadExcerpt: currentThread.excerpt ?? null,
										threadMessages: studentReplyThread.messages.map((message) => ({
											author: message.author,
											markdown: message.markdown
										})),
										studentReplyMarkdown: parsedBody.text
									})
								}
							]
						}
					]
				})
		});
		console.info('Tutor review reply generation completed', {
			userId,
			sessionId: session.id,
			threadId: currentThread.id,
			responseChars: rawModelReply.length
		});
	} catch (error) {
		console.error('Tutor review reply generation failed', {
			userId,
			sessionId: session.id,
			threadId: currentThread.id,
			error
		});
		rawModelReply = '';
	}

	const parsedDecision = (() => {
		if (rawModelReply.trim().length === 0) {
			return null;
		}
		try {
			return z
				.object({
					assistantReplyMarkdown: z.string().trim().min(1),
					resolved: z.boolean()
				})
				.parse(parseJsonFromLlmText(rawModelReply));
		} catch {
			return null;
		}
	})();

	const finalizedDecision: ReviewDecision = parsedDecision ?? {
		assistantReplyMarkdown: TUTOR_FALLBACK_REVIEW_REPLY_MARKDOWN,
		resolved: false
	};

	const finalNow = new Date();
	const finalThread = appendTutorReviewMessage({
		thread: studentReplyThread,
		author: 'assistant',
		markdown: finalizedDecision.assistantReplyMarkdown,
		createdAt: finalNow.toISOString(),
		status: finalizedDecision.resolved ? 'resolved' : 'open',
		...(finalizedDecision.resolved ? { resolvedAt: finalNow.toISOString() } : {})
	});
	const finalReviewState = updateTutorReviewThread({
		reviewState: respondingReviewState,
		thread: finalThread,
		now: finalNow
	});
	const summary = summarizeTutorReviewState(finalReviewState);
	const nextStatus: 'completed' | 'awaiting_student' = summary.allResolved
		? 'completed'
		: 'awaiting_student';
	const nextSession = {
		...session,
		status: nextStatus,
		updatedAt: finalNow,
		preview: buildTutorReviewPreview(finalReviewState),
		focusLabel: buildTutorReviewFocusLabel(finalReviewState) ?? session.focusLabel,
		...(summary.allResolved ? { completedAt: finalNow } : {})
	};

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_REVIEW_PATH,
			content: stringifyJson(finalReviewState),
			now: finalNow
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_SESSION_PATH,
			content: stringifyJson(
				buildTutorScreenState({
					session: nextSession,
					draftRevision: session.latestDraftRevision,
					focusLabel: nextSession.focusLabel ?? null
				})
			),
			now: finalNow
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: TUTOR_STATE_COMPOSER_PATH,
			content: stringifyJson(
				buildTutorComposerState({
					placeholder: summary.allResolved
						? 'All review comments are resolved.'
						: 'Reply to the next open comment thread.',
					disabled: summary.allResolved,
					allowConfidence: false,
					hintButtons: []
				})
			),
			now: finalNow
		}),
		patchTutorSession(userId, session.id, {
			status: nextStatus,
			updatedAt: finalNow,
			preview: nextSession.preview,
			focusLabel: nextSession.focusLabel ?? null,
			...(summary.allResolved ? { completedAt: finalNow } : {})
		})
	]);

	console.info('Tutor review reply finalized', {
		userId,
		sessionId: session.id,
		threadId: currentThread.id,
		resolved: finalizedDecision.resolved,
		nextStatus
	});

	return json(
		{
			status: nextStatus,
			resolved: finalizedDecision.resolved
		},
		{ status: 200 }
	);
};
