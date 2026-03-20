import type {
	SparkTutorComposerState,
	SparkTutorReviewState,
	SparkTutorScreenState,
	SparkTutorSession
} from '@spark/schemas';

import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
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

function parseFirestoreInstantMs(value: unknown): number | null {
	if (value instanceof Date) {
		return value.getTime();
	}
	if (
		value &&
		typeof value === 'object' &&
		'seconds' in (value as Record<string, unknown>) &&
		'nanoseconds' in (value as Record<string, unknown>)
	) {
		const record = value as {
			seconds: unknown;
			nanoseconds: unknown;
		};
		if (typeof record.seconds === 'number' && typeof record.nanoseconds === 'number') {
			return record.seconds * 1000 + Math.floor(record.nanoseconds / 1_000_000);
		}
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const timestamp = Date.parse(String(value));
		return Number.isNaN(timestamp) ? null : timestamp;
	}
	return null;
}

async function isTutorAgentLikelyStillActive(options: {
	serviceAccountJson: string;
	userId: string;
	agentId: string;
	staleAfterMs: number;
	nowMs: number;
}): Promise<boolean> {
	const agentDocPath = `users/${options.userId}/agents/${options.agentId}`;
	const [agentSnap, logSnap] = await Promise.all([
		getFirestoreDocument({
			serviceAccountJson: options.serviceAccountJson,
			documentPath: agentDocPath
		}),
		getFirestoreDocument({
			serviceAccountJson: options.serviceAccountJson,
			documentPath: `${agentDocPath}/logs/log`
		})
	]);

	if (!agentSnap.exists || !agentSnap.data) {
		return false;
	}
	const rawStatus = agentSnap.data.status;
	if (rawStatus !== 'created' && rawStatus !== 'executing') {
		return false;
	}

	const latestActivityMs = Math.max(
		parseFirestoreInstantMs(agentSnap.data.updatedAt) ?? 0,
		parseFirestoreInstantMs(logSnap.data?.updatedAt) ?? 0
	);
	if (latestActivityMs === 0) {
		return false;
	}
	return options.nowMs - latestActivityMs < options.staleAfterMs;
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

	const threads = Object.fromEntries(Object.entries(options.reviewState.threads).map(([questionId, thread]) => {
		if (thread.status !== 'responding') {
			return [questionId, thread];
		}

		const lastMessage = thread.messages.at(-1) ?? null;
		if (!lastMessage || lastMessage.author !== 'student') {
			return [questionId, thread];
		}

		const lastMessageMs = parseInstantMs(lastMessage.createdAt);
		if (lastMessageMs === null || nowMs - lastMessageMs < staleAfterMs) {
			return [questionId, thread];
		}

		recoveredThreadIds.push(questionId);
		return [
			questionId,
			appendTutorReviewMessage({
				thread,
				author: 'assistant',
				markdown: fallbackAssistantMarkdown,
				createdAt: nowIso,
				status: 'open'
			})
		];
	}));

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
	const nowMs = now.getTime();
	const keepActiveAgent =
		typeof options.session.activeTurnAgentId === 'string' &&
		options.session.activeTurnAgentId.length > 0 &&
		(await isTutorAgentLikelyStillActive({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			agentId: options.session.activeTurnAgentId,
			staleAfterMs: TUTOR_STALE_REVIEW_RESPONSE_MS,
			nowMs
		}).catch(() => false));
	const recovered = keepActiveAgent
		? {
				reviewState: options.reviewState,
				recoveredThreadIds: []
			}
		: recoverStaleTutorReviewState({
				reviewState: options.reviewState,
				now
			});
	const summary = summarizeTutorReviewState(recovered.reviewState);
	const allResolved = summary.totalThreads === 0 || summary.allResolved;
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
		patchTutorSession(
			options.userId,
			options.session.id,
			{
				status: nextStatus,
				updatedAt: now,
				preview: nextSession.preview,
				focusLabel: nextSession.focusLabel ?? null,
				...(allResolved ? { completedAt: now } : {})
			},
			nextStatus === 'responding' ? undefined : ['activeTurnAgentId', 'activeTurnQuestionId']
		)
	]);

	return {
		session: nextSession,
		reviewState: recovered.reviewState,
		screenState,
		composerState,
		recoveredThreadIds: recovered.recoveredThreadIds
	};
}
