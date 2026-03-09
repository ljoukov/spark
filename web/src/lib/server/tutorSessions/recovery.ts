import type {
	SparkTutorComposerState,
	SparkTutorReviewState,
	SparkTutorScreenState,
	SparkTutorSession
} from '@spark/schemas';

import { patchTutorSession } from '$lib/server/tutorSessions/repo';
import {
	TUTOR_STATE_COMPOSER_PATH,
	TUTOR_STATE_REVIEW_PATH,
	TUTOR_STATE_SESSION_PATH,
	buildTutorComposerState,
	buildTutorScreenState,
	writeTutorWorkspaceTextFile
} from '$lib/server/tutorSessions/workspace';
import {
	appendTutorReviewMessage,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	summarizeTutorReviewState
} from '$lib/server/tutorSessions/reviewState';

export const TUTOR_THREAD_REPLY_TIMEOUT_MS = 20_000;
export const TUTOR_STALE_REVIEW_RESPONSE_MS = 30_000;
export const TUTOR_FALLBACK_REVIEW_REPLY_MARKDOWN =
	'I still need one more clear revision on this point before I can resolve it.';

function stringifyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function parseInstantMs(value: string): number | null {
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}

function buildRecoveryComposerState(options: {
	status: SparkTutorSession['status'];
	allResolved: boolean;
}): SparkTutorComposerState {
	if (options.status === 'responding') {
		return buildTutorComposerState({
			placeholder: 'Spark is reviewing your reply...',
			disabled: true,
			allowConfidence: false,
			hintButtons: []
		});
	}

	return buildTutorComposerState({
		placeholder: options.allResolved
			? 'All review comments are resolved.'
			: 'Reply to the next open comment thread.',
		disabled: options.allResolved,
		allowConfidence: false,
		hintButtons: []
	});
}

export function recoverStaleTutorReviewState(options: {
	reviewState: SparkTutorReviewState;
	now: Date;
	staleAfterMs?: number;
	fallbackAssistantMarkdown?: string;
}): {
	reviewState: SparkTutorReviewState;
	recoveredThreadIds: string[];
} {
	const staleAfterMs = options.staleAfterMs ?? TUTOR_STALE_REVIEW_RESPONSE_MS;
	const fallbackAssistantMarkdown =
		options.fallbackAssistantMarkdown ?? TUTOR_FALLBACK_REVIEW_REPLY_MARKDOWN;
	const nowIso = options.now.toISOString();
	const nowMs = options.now.getTime();
	const recoveredThreadIds: string[] = [];

	const threads = options.reviewState.threads.map((thread) => {
		if (thread.status !== 'responding') {
			return thread;
		}

		const lastMessage = thread.messages.at(-1) ?? null;
		if (!lastMessage || lastMessage.author !== 'student') {
			return thread;
		}

		const lastMessageMs = parseInstantMs(lastMessage.createdAt);
		if (lastMessageMs === null || nowMs - lastMessageMs < staleAfterMs) {
			return thread;
		}

		recoveredThreadIds.push(thread.id);
		return appendTutorReviewMessage({
			thread,
			author: 'assistant',
			markdown: fallbackAssistantMarkdown,
			createdAt: nowIso,
			status: 'open'
		});
	});

	if (recoveredThreadIds.length === 0) {
		return {
			reviewState: options.reviewState,
			recoveredThreadIds
		};
	}

	return {
		reviewState: {
			...options.reviewState,
			threads,
			updatedAt: nowIso
		},
		recoveredThreadIds
	};
}

export async function recoverTutorSessionIfStale(options: {
	serviceAccountJson: string;
	userId: string;
	session: SparkTutorSession;
	reviewState: SparkTutorReviewState;
}): Promise<null | {
	session: SparkTutorSession;
	reviewState: SparkTutorReviewState;
	screenState: SparkTutorScreenState;
	composerState: SparkTutorComposerState;
	recoveredThreadIds: string[];
}> {
	const now = new Date();
	const recovered = recoverStaleTutorReviewState({
		reviewState: options.reviewState,
		now
	});
	const summary = summarizeTutorReviewState(recovered.reviewState);
	const allResolved = recovered.reviewState.threads.length === 0 || summary.allResolved;
	const nextStatus: SparkTutorSession['status'] =
		summary.respondingThreads > 0
			? 'responding'
			: allResolved
				? 'completed'
				: 'awaiting_student';
	const needsSessionReset =
		options.session.status === 'responding' && summary.respondingThreads === 0;
	const needsRecovery = recovered.recoveredThreadIds.length > 0 || needsSessionReset;

	if (!needsRecovery) {
		return null;
	}

	const nextSession: SparkTutorSession = {
		...options.session,
		status: nextStatus,
		updatedAt: now,
		preview: buildTutorReviewPreview(recovered.reviewState),
		focusLabel: buildTutorReviewFocusLabel(recovered.reviewState) ?? options.session.focusLabel,
		...(allResolved ? { completedAt: now } : {})
	};
	const screenState = buildTutorScreenState({
		session: nextSession,
		focusLabel: nextSession.focusLabel ?? null
	});
	const composerState = buildRecoveryComposerState({
		status: nextStatus,
		allResolved
	});

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.session.workspaceId,
			filePath: TUTOR_STATE_REVIEW_PATH,
			content: stringifyJson(recovered.reviewState),
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.session.workspaceId,
			filePath: TUTOR_STATE_SESSION_PATH,
			content: stringifyJson(screenState),
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.session.workspaceId,
			filePath: TUTOR_STATE_COMPOSER_PATH,
			content: stringifyJson(composerState),
			now
		}),
		patchTutorSession(options.userId, options.session.id, {
			status: nextStatus,
			updatedAt: now,
			preview: nextSession.preview,
			focusLabel: nextSession.focusLabel ?? null,
			...(allResolved ? { completedAt: now } : {})
		})
	]);

	return {
		session: nextSession,
		reviewState: recovered.reviewState,
		screenState,
		composerState,
		recoveredThreadIds: recovered.recoveredThreadIds
	};
}
