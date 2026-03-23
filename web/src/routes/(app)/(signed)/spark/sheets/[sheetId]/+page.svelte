<script lang="ts">
	import { browser } from '$app/environment';
	import { PaperSheet } from '$lib/components/paper-sheet/index.js';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import type {
		PaperSheetFeedbackAttachment,
		SparkAgentRunStream,
		PaperSheetFeedbackThread,
		SparkGraderWorksheetReport,
		SparkTutorReviewState
	} from '@spark/schemas';
	import {
		SparkAgentRunStreamSchema,
		SparkAgentWorkspaceFileSchema,
		SparkGraderWorksheetReportSchema,
		SparkTutorReviewStateSchema,
		SparkTutorSessionSchema
	} from '@spark/schemas';
	import { doc, getFirestore, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { getContext, onMount, untrack } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ClientUser = NonNullable<PageData['user']> | null;
	type FeedbackRuntimeStatus = 'connecting' | 'thinking' | 'responding';
	type PendingReply = {
		text: string;
		attachments: PaperSheetFeedbackAttachment[];
	};

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);
	const initialReport = untrack(() => data.report);
	const initialReviewState = untrack(
		() => data.interaction?.reviewState ?? data.initialReviewState ?? null
	);
	const initialInteractionSessionId = untrack(() => data.interaction?.id ?? null);
	const initialInteractionWorkspaceId = untrack(() => data.interaction?.workspaceId ?? null);
	const initialActiveTurnAgentId = untrack(() => data.interaction?.activeTurnAgentId ?? null);
	const initialActiveTurnQuestionId = untrack(() => data.interaction?.activeTurnQuestionId ?? null);

	let authReady = $state(false);
	let report = $state<SparkGraderWorksheetReport | null>(initialReport);
	let reviewState = $state<SparkTutorReviewState | null>(initialReviewState);
	let interactionSessionId = $state<string | null>(initialInteractionSessionId);
	let interactionWorkspaceId = $state<string | null>(initialInteractionWorkspaceId);
	let activeTurnAgentId = $state<string | null>(initialActiveTurnAgentId);
	let activeTurnQuestionId = $state<string | null>(initialActiveTurnQuestionId);
	let activeAgentStream = $state<SparkAgentRunStream | null>(null);
	let requestError = $state<string | null>(null);
	let submittingQuestionIds = $state<Record<string, boolean>>({});
	let pendingReplies = $state<Record<string, PendingReply>>({});

	function encodeWorkspaceFileId(filePath: string): string {
		return encodeURIComponent(filePath);
	}

	function removeQuestionKey<T extends Record<string, unknown>>(value: T, questionId: string): T {
		const { [questionId]: _removed, ...rest } = value;
		return rest as T;
	}

	function cleanupPendingReply(reply: PendingReply | undefined): void {
		if (typeof URL === 'undefined') {
			return;
		}
		for (const attachment of reply?.attachments ?? []) {
			if (attachment.url?.startsWith('blob:')) {
				URL.revokeObjectURL(attachment.url);
			}
		}
	}

	function buildSheetAttachmentUrl(filePath: string, filename: string): string {
		const params = new URLSearchParams({
			path: filePath,
			filename
		});
		return `/api/spark/sheets/${data.run.id}/attachment?${params.toString()}`;
	}

	function buildAttachmentSignature(attachment: {
		filename: string;
		contentType: string;
		sizeBytes: number;
	}): string {
		return `${attachment.filename}::${attachment.contentType}::${attachment.sizeBytes.toString()}`;
	}

	function parseWorkspaceTextFile(
		filePath: string,
		raw: Record<string, unknown> | undefined
	): string | null {
		if (!raw) {
			return null;
		}
		const parsed = SparkAgentWorkspaceFileSchema.safeParse({
			...raw,
			path: filePath
		});
		if (!parsed.success) {
			return null;
		}
		const file = parsed.data;
		if (!('content' in file) || typeof file.content !== 'string') {
			return null;
		}
		return file.content;
	}

	function applyWorkspaceJson<T>(
		filePath: string,
		raw: Record<string, unknown> | undefined,
		parse: (value: unknown) => T,
		apply: (value: T) => void
	): void {
		const text = parseWorkspaceTextFile(filePath, raw);
		if (!text) {
			return;
		}
		try {
			apply(parse(JSON.parse(text)));
		} catch {
			// Ignore transient partial writes.
		}
	}

	async function submitQuestionReply(questionId: string, draft: string, attachments: File[]): Promise<boolean> {
		if (submittingQuestionIds[questionId] || data.run.status !== 'done') {
			return false;
		}
		const pendingReply: PendingReply = {
			text: draft,
			attachments: attachments.map((file, index) => ({
				id:
					typeof crypto !== 'undefined' && 'randomUUID' in crypto
						? crypto.randomUUID()
						: `pending-${questionId}-${index.toString()}-${Date.now().toString()}`,
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				sizeBytes: file.size,
				...(file.type.startsWith('image/') ? { url: URL.createObjectURL(file) } : {})
			}))
		};
		submittingQuestionIds = {
			...submittingQuestionIds,
			[questionId]: true
		};
		pendingReplies = {
			...pendingReplies,
			[questionId]: pendingReply
		};
		activeTurnQuestionId = questionId;
		activeAgentStream = null;
		requestError = null;

		try {
			const formData = new FormData();
			formData.append('action', 'reply');
			formData.append('questionId', questionId);
			formData.append('text', draft);
			for (const attachment of attachments) {
				formData.append('file', attachment);
			}
			const response = await fetch(`/api/spark/sheets/${data.run.id}/turn`, {
				method: 'POST',
				body: formData
			});

			const payload = (await response.json().catch(() => null)) as
				| {
						error?: string;
						issues?: Array<{ message?: string }>;
						sessionId?: string;
						workspaceId?: string;
				  }
				| null;
			if (!response.ok) {
				requestError =
					payload?.issues?.[0]?.message ??
					payload?.error ??
					'Unable to send your worksheet reply.';
				cleanupPendingReply(pendingReply);
				pendingReplies = removeQuestionKey(pendingReplies, questionId);
				return false;
			} else {
				if (payload?.sessionId) {
					interactionSessionId = payload.sessionId;
				}
				if (payload?.workspaceId) {
					interactionWorkspaceId = payload.workspaceId;
				}
				return true;
			}
		} catch {
			requestError = 'Unable to send your worksheet reply.';
			cleanupPendingReply(pendingReply);
			pendingReplies = removeQuestionKey(pendingReplies, questionId);
			return false;
		} finally {
			submittingQuestionIds = removeQuestionKey(submittingQuestionIds, questionId);
		}
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		try {
			const auth = getAuth(getFirebaseApp());
			if (auth.currentUser) {
				authReady = true;
			} else {
				const stopAuth = onIdTokenChanged(auth, (firebaseUser) => {
					if (!firebaseUser) {
						return;
					}
					authReady = true;
					stopAuth();
				});
			}
		} catch (error) {
			console.warn('Failed to initialize sheet auth guard', error);
		}
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !interactionWorkspaceId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const workspaceId = interactionWorkspaceId;
		const stops: Unsubscribe[] = [];
		const subscribeWorkspaceFile = (
			filePath: string,
			apply: (raw: Record<string, unknown> | undefined) => void
		) => {
			const fileRef = doc(
				db,
				'users',
				uid,
				'workspace',
				workspaceId,
				'files',
				encodeWorkspaceFileId(filePath)
			);
			stops.push(
				onSnapshot(
					fileRef,
					(snapshot) => {
						apply(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined);
					},
					(error) => {
						console.warn(`Sheet workspace file subscription failed (${filePath})`, error);
					}
				)
			);
		};
		subscribeWorkspaceFile('state/review.json', (raw) => {
			applyWorkspaceJson(
				'state/review.json',
				raw,
				(value) => SparkTutorReviewStateSchema.parse(value),
				(value) => {
					reviewState = value;
				}
			);
		});
		subscribeWorkspaceFile('context/report.json', (raw) => {
			applyWorkspaceJson(
				'context/report.json',
				raw,
				(value) => SparkGraderWorksheetReportSchema.parse(value),
				(value) => {
					report = value;
				}
			);
		});
		return () => {
			for (const stop of stops) {
				stop();
			}
		};
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !interactionSessionId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const sessionId = interactionSessionId;
		const sessionRef = doc(db, 'spark', uid, 'tutorSessions', sessionId);
		return onSnapshot(
			sessionRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					return;
				}
				const parsed = SparkTutorSessionSchema.safeParse({
					id: interactionSessionId,
					...snapshot.data()
				});
				if (!parsed.success) {
					return;
				}
				activeTurnAgentId = parsed.data.activeTurnAgentId ?? null;
				activeTurnQuestionId = parsed.data.activeTurnQuestionId ?? null;
			},
			(error) => {
				console.warn('Sheet tutor session subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !activeTurnAgentId) {
			activeAgentStream = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const agentId = activeTurnAgentId;
		const logRef = doc(db, 'users', uid, 'agents', agentId, 'logs', 'log');
		return onSnapshot(
			logRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					activeAgentStream = null;
					return;
				}
				const parsed = SparkAgentRunStreamSchema.safeParse(
					(snapshot.data() as Record<string, unknown>).stream
				);
				activeAgentStream = parsed.success ? parsed.data : null;
			},
			(error) => {
				console.warn('Sheet active agent stream subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!reviewState || Object.keys(pendingReplies).length === 0) {
			return;
		}
		let nextPendingReplies = pendingReplies;
		let changed = false;
		for (const [questionId, pendingReply] of Object.entries(pendingReplies)) {
			const thread = reviewState.threads[questionId];
			const lastStudentMessage =
				thread?.messages.findLast((message) => message.author === 'student') ?? null;
			const lastMessageSignatures = (lastStudentMessage?.attachments ?? []).map(buildAttachmentSignature);
			const pendingSignatures = pendingReply.attachments.map(buildAttachmentSignature);
			if (
				lastStudentMessage?.markdown === pendingReply.text &&
				lastMessageSignatures.length === pendingSignatures.length &&
				lastMessageSignatures.every((signature, index) => signature === pendingSignatures[index])
			) {
				if (!changed) {
					nextPendingReplies = { ...pendingReplies };
					changed = true;
				}
				cleanupPendingReply(pendingReply);
				delete nextPendingReplies[questionId];
			}
		}
		if (changed) {
			pendingReplies = nextPendingReplies;
		}
	});

	const activeRuntimeQuestionId = $derived.by(() => {
		if (activeTurnQuestionId) {
			return activeTurnQuestionId;
		}
		if (reviewState) {
			for (const [questionId, thread] of Object.entries(reviewState.threads)) {
				if (thread.status === 'responding') {
					return questionId;
				}
			}
		}
		const firstPendingQuestionId = Object.keys(submittingQuestionIds)[0];
		return firstPendingQuestionId ?? null;
	});

	const feedbackThreads = $derived.by((): Record<string, PaperSheetFeedbackThread> => {
		const threads: Record<string, PaperSheetFeedbackThread> = {};
		if (!reviewState) {
			return threads;
		}
		for (const [questionId, thread] of Object.entries(reviewState.threads)) {
			const turns: PaperSheetFeedbackThread['turns'] = thread.messages.map((message) => ({
				id: message.id,
				speaker: message.author === 'assistant' ? ('tutor' as const) : ('student' as const),
				text: message.markdown,
				attachments: message.attachments?.map((attachment) => ({
					...attachment,
					...(attachment.filePath
						? { url: buildSheetAttachmentUrl(attachment.filePath, attachment.filename) }
						: {})
				}))
			}));
			const pendingReply = pendingReplies[questionId];
			const lastStudentTurn = turns.findLast((turn) => turn.speaker === 'student') ?? null;
			const lastTurnSignatures = (lastStudentTurn?.attachments ?? []).map(buildAttachmentSignature);
			const pendingSignatures = (pendingReply?.attachments ?? []).map(buildAttachmentSignature);
			const shouldAppendPendingTurn =
				pendingReply !== undefined &&
				(lastStudentTurn?.text !== pendingReply.text ||
					lastTurnSignatures.length !== pendingSignatures.length ||
					lastTurnSignatures.some((signature, index) => signature !== pendingSignatures[index]));
			const status: PaperSheetFeedbackThread['status'] =
				shouldAppendPendingTurn ? 'responding' : thread.status;
			const nextTurns: PaperSheetFeedbackThread['turns'] =
				shouldAppendPendingTurn
					? [
							...turns,
							{
								id: `pending-${questionId}`,
								speaker: 'student',
								text: pendingReply.text,
								attachments: pendingReply.attachments
							}
						]
					: turns;
			threads[questionId] = {
				status,
				turns: nextTurns
			};
		}
		return threads;
	});

	const feedbackSending = $derived.by(() => submittingQuestionIds);

	const feedbackRuntimeStatuses = $derived.by((): Record<string, FeedbackRuntimeStatus> => {
		if (!activeRuntimeQuestionId) {
			return {};
		}

		const questionId = activeRuntimeQuestionId;
		const runtimeStatus: FeedbackRuntimeStatus | null = activeAgentStream?.assistant?.trim()
			? 'responding'
			: activeAgentStream?.thoughts?.trim()
				? 'thinking'
				: activeTurnAgentId ||
					  reviewState?.threads[questionId]?.status === 'responding' ||
					  submittingQuestionIds[questionId]
					? 'connecting'
					: null;

		if (!runtimeStatus) {
			return {};
		}

		return {
			[questionId]: runtimeStatus
		};
	});

	const feedbackThinking = $derived.by(() =>
		activeRuntimeQuestionId && activeAgentStream?.thoughts?.trim()
			? { [activeRuntimeQuestionId]: activeAgentStream.thoughts }
			: {}
	);

	const feedbackAssistantDrafts = $derived.by(() =>
		activeRuntimeQuestionId && activeAgentStream?.assistant?.trim()
			? { [activeRuntimeQuestionId]: activeAgentStream.assistant }
			: {}
	);

	$effect(() => {
		if (!browser || !activeRuntimeQuestionId) {
			return;
		}
		const questionId = activeRuntimeQuestionId;
		const thread = feedbackThreads[questionId] ?? null;
		const lastTurn = thread?.turns.at(-1) ?? null;
		console.log('[sheet-feedback-debug] runtime snapshot', {
			sheetId: data.run.id,
			questionId,
			activeTurnQuestionId,
			activeTurnAgentId,
			runtimeStatus: feedbackRuntimeStatuses[questionId] ?? null,
			streamThoughtLength: activeAgentStream?.thoughts?.trim().length ?? 0,
			streamAssistantLength: activeAgentStream?.assistant?.trim().length ?? 0,
			thinkingTextLength: feedbackThinking[questionId]?.trim().length ?? 0,
			assistantDraftLength: feedbackAssistantDrafts[questionId]?.trim().length ?? 0,
			threadStatus: thread?.status ?? null,
			lastTurnSpeaker: lastTurn?.speaker ?? null,
			lastTurnPreview: lastTurn?.text.slice(0, 160) ?? null,
			isSubmitting: Boolean(submittingQuestionIds[questionId]),
			hasPendingReply: pendingReplies[questionId] !== undefined
		});
	});

</script>

<svelte:head>
	<title>Spark · {data.run.display.title}</title>
</svelte:head>

<section class="sheet-page">
	{#if requestError}
		<p class="action-error" role="alert">{requestError}</p>
	{/if}

	{#if report && reviewState}
		<div class="sheet-shell">
			<PaperSheet
				sheet={reviewState.sheet}
				answers={reviewState.answers}
				review={reviewState.review}
				reviewMode="live"
				editable={false}
				allowFeedbackReplies={data.run.status === 'done'}
				feedbackThreads={feedbackThreads}
				feedbackSending={feedbackSending}
				feedbackRuntimeStatuses={feedbackRuntimeStatuses}
				feedbackThinking={feedbackThinking}
				feedbackAssistantDrafts={feedbackAssistantDrafts}
				onReplyToTutor={(questionId, draft, attachments) => {
					return submitQuestionReply(questionId, draft, attachments);
				}}
			/>
		</div>
	{:else}
		<section class="pending-card">
			<h2>
				{data.run.status === 'failed'
					? 'This sheet failed to grade'
					: data.run.status === 'stopped'
						? 'This sheet was stopped before grading finished'
						: data.run.status === 'created'
							? 'This sheet is queued for grading'
							: 'This sheet is still being graded'}
			</h2>
			<p>
				{data.run.error ??
					(data.run.status === 'created'
						? 'Spark has queued this worksheet and will publish the paper-sheet view once grading starts.'
						: 'The worksheet artifact has not been published yet. Refresh this page once the grading step finishes.')}
			</p>
		</section>
	{/if}
</section>

<style lang="postcss">
	.sheet-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(100%, 1024px);
		max-width: 1024px;
		margin: 0 auto;
	}

	.pending-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.pending-card p {
		margin: 0.75rem 0 0;
	}

	.action-error {
		margin: 0;
		color: var(--destructive);
		font-weight: 600;
	}

	.sheet-shell {
		overflow: auto;
		padding-bottom: 0.2rem;
	}

	.pending-card h2 {
		margin: 0;
	}

	@media (min-width: 1025px) {
		.sheet-page {
			padding-block: 1.25rem 2rem;
		}
	}
</style>
