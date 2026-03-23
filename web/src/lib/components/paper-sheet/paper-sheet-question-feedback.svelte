<script lang="ts">
	import { browser } from '$app/environment';
	import type {
		PaperSheetComposerAttachmentDraft,
		PaperSheetFeedbackThread,
		PaperSheetQuestionReview
	} from './types';
	import PaperSheetFeedbackChat from './paper-sheet-feedback-chat.svelte';

	function getToneClass(
		review: PaperSheetQuestionReview,
		thread: PaperSheetFeedbackThread | null
	): string {
		if (thread?.status === 'resolved') {
			return 'is-correct';
		}

		switch (review.status) {
			case 'correct':
				return 'is-correct';
			case 'incorrect':
				return 'is-warning';
			case 'teacher-review':
				return 'is-review';
		}
	}

	function getStatusState(
		review: PaperSheetQuestionReview,
		processing: boolean,
		runtimeStatus: 'connecting' | 'thinking' | 'responding' | null,
		thread: PaperSheetFeedbackThread | null,
		thinkingText: string | null,
		assistantDraftText: string | null,
		fallbackLabel: string
	): {
		kind: 'pending' | 'processing' | 'open' | 'optional' | 'done';
		label: string;
	} {
		if (processing) {
			return {
				kind: 'processing',
				label: 'connecting'
			};
		}

		if (runtimeStatus) {
			return {
				kind: 'processing',
				label: runtimeStatus
			};
		}

		if (thread?.status === 'responding') {
			return {
				kind: 'processing',
				label: assistantDraftText ? 'responding' : thinkingText ? 'thinking' : 'connecting'
			};
		}

		if (thread?.status === 'resolved') {
			return {
				kind: 'done',
				label: 'resolved'
			};
		}

		if (review.status === 'correct') {
			if ((thread?.turns.length ?? 0) > 0) {
				return {
					kind: 'done',
					label: 'shared'
				};
			}

			return {
				kind: 'optional',
				label: fallbackLabel
			};
		}

		if ((thread?.turns.length ?? 0) > 0) {
			return {
				kind: 'open',
				label: 'conversation open'
			};
		}

		return {
			kind: 'pending',
			label: fallbackLabel
		};
	}

	let {
		review,
		open = true,
		draft,
		thread,
		processing = false,
		runtimeStatus = null,
		thinkingText = null,
		assistantDraftText = null,
		showComposer = true,
		showFollowUpButton = false,
		resolvedFollowUpMode = false,
		draftAttachments = [],
		draftAttachmentError = null,
		allowAttachments = false,
		allowTakePhoto = false,
		questionLabel,
		onToggle,
		onRequestFollowUp = undefined,
		onAttachFiles = undefined,
		onRemoveDraftAttachment = undefined,
		onDraftChange,
		onReply
	}: {
		review: PaperSheetQuestionReview;
		open?: boolean;
		draft: string;
		thread: PaperSheetFeedbackThread | null;
		processing?: boolean;
		runtimeStatus?: 'connecting' | 'thinking' | 'responding' | null;
		thinkingText?: string | null;
		assistantDraftText?: string | null;
		showComposer?: boolean;
		showFollowUpButton?: boolean;
		resolvedFollowUpMode?: boolean;
		draftAttachments?: PaperSheetComposerAttachmentDraft[];
		draftAttachmentError?: string | null;
		allowAttachments?: boolean;
		allowTakePhoto?: boolean;
		questionLabel: string;
		onToggle: () => void;
		onRequestFollowUp?: () => void;
		onAttachFiles?: (files: File[]) => void | Promise<void>;
		onRemoveDraftAttachment?: (localId: string) => void;
		onDraftChange: (value: string) => void;
		onReply: (value?: string) => void;
	} = $props();

	const noteLabel = $derived(review.label ?? 'Review note');
	const statusLabel = $derived.by(() => {
		if (review.statusLabel) {
			return review.statusLabel;
		}
		if (review.status === 'correct') {
			return 'optional reply';
		}
		if (review.status === 'teacher-review') {
			return 'reflection prompt';
		}
		return 'response needed';
	});
	const statusState = $derived.by(() =>
		getStatusState(
			review,
			processing,
			runtimeStatus,
			thread,
			thinkingText,
			assistantDraftText,
			statusLabel
		)
	);
	const displayThread = $derived.by(() => [
		{
			id: `${noteLabel}-initial`,
			speaker: 'tutor' as const,
			text: review.note
		},
		...(thread?.turns ?? [])
	]);
	const showAssistantDraft = $derived.by(() => {
		if (!assistantDraftText) {
			return false;
		}
		const lastTurn = displayThread.at(-1);
		return lastTurn?.speaker !== 'tutor' || lastTurn.text !== assistantDraftText;
	});
	const composerDisabled = $derived(
		!showComposer ||
			processing ||
			thread?.status === 'responding' ||
			(thread?.status === 'resolved' && !resolvedFollowUpMode)
	);
	const runtimeLocked = $derived(processing || runtimeStatus !== null || thread?.status === 'responding');
	const composerPlaceholder = $derived(
		resolvedFollowUpMode
			? 'Ask a followup about this feedback...'
			: review.replyPlaceholder ?? 'Write your reply here...'
	);

	$effect(() => {
		if (
			!browser ||
			!thread &&
				runtimeStatus === null &&
				(thinkingText?.trim().length ?? 0) === 0 &&
				(assistantDraftText?.trim().length ?? 0) === 0
		) {
			return;
		}
		const lastTurn = displayThread.at(-1) ?? null;
		console.log('[paper-sheet-feedback-debug] render state', {
			questionLabel,
			runtimeStatus,
			threadStatus: thread?.status ?? null,
			thinkingTextLength: thinkingText?.trim().length ?? 0,
			assistantDraftLength: assistantDraftText?.trim().length ?? 0,
			showAssistantDraft,
			showThinkingBlock: (thinkingText?.trim().length ?? 0) > 0 && !showAssistantDraft,
			lastTurnSpeaker: lastTurn?.speaker ?? null,
			lastTurnPreview: lastTurn?.text.slice(0, 160) ?? null
		});
	});
</script>

<section class={`paper-sheet-note ${getToneClass(review, thread)}`}>
	<div class="paper-sheet-note__frame">
		<button type="button" class="paper-sheet-note__header" aria-expanded={open} onclick={onToggle}>
			<span class="paper-sheet-note__pill">{noteLabel}</span>

			<span class={`paper-sheet-note__status is-${statusState.kind}`}>
				{#if statusState.kind === 'pending'}
					<span class="paper-sheet-note__status-dot" aria-hidden="true"></span>
				{:else if statusState.kind === 'processing'}
					<span class="paper-sheet-note__status-spinner" aria-hidden="true"></span>
				{:else if statusState.kind === 'open'}
					<span class="paper-sheet-note__status-dot is-static" aria-hidden="true"></span>
				{:else}
					<span class="paper-sheet-note__status-icon" aria-hidden="true">✓</span>
				{/if}
				{statusState.label}
			</span>

			<span class="paper-sheet-note__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
		</button>

		{#if open}
			<div class="paper-sheet-note__body">
				<PaperSheetFeedbackChat
					{displayThread}
					{processing}
					{thinkingText}
					{assistantDraftText}
					{showAssistantDraft}
					{showComposer}
					{showFollowUpButton}
					{resolvedFollowUpMode}
					{draft}
					{draftAttachments}
					{draftAttachmentError}
					{allowAttachments}
					{allowTakePhoto}
					placeholder={composerPlaceholder}
					{questionLabel}
					{composerDisabled}
					{runtimeLocked}
					{onRequestFollowUp}
					{onAttachFiles}
					{onRemoveDraftAttachment}
					{onDraftChange}
					{onReply}
				/>
			</div>
		{/if}
	</div>
</section>

<style>
	.paper-sheet-note {
		width: 100%;
		min-width: 0;
		font-family: inherit;
		--note-bg: var(--paper-review-incorrect-bg, #fbefe3);
		--note-left: var(--paper-review-incorrect-border, #c66317);
		--note-dashed: color-mix(in srgb, var(--note-left) 48%, var(--paper-surface, #ffffff));
		--note-badge-bg: color-mix(
			in srgb,
			var(--note-left) 14%,
			var(--paper-surface-elevated, #ffffff)
		);
		--note-badge-border: color-mix(in srgb, var(--note-left) 34%, var(--paper-surface, #ffffff));
		--note-badge-text: var(--paper-review-incorrect-text, #c66317);
		--note-dot: var(--note-left);
		--note-status-pending: var(--paper-review-incorrect-text, #c66317);
		--note-status-processing: var(--paper-review-incorrect-text, #c66317);
		--note-status-done: var(--paper-review-correct-text, #1a8c5b);
		--note-user-bg: var(--paper-lines-markdown-bg, #fdfdfd);
		--note-user-border: color-mix(
			in srgb,
			var(--note-left) 24%,
			var(--paper-border, rgba(33, 74, 58, 0.18))
		);
		--note-input-border: color-mix(in srgb, var(--note-left) 58%, var(--paper-surface, #ffffff));
		--note-text: var(--paper-text, #241d19);
		--note-text-muted: var(--paper-text-soft, rgba(87, 71, 58, 0.72));
		--note-composer-surface: color-mix(
			in srgb,
			var(--paper-surface-elevated, #ffffff) 92%,
			transparent
		);
		--note-composer-hover: color-mix(
			in srgb,
			var(--paper-text-soft, #555555) 10%,
			var(--paper-surface-elevated, #ffffff)
		);
		--markdown-text: var(--note-text);
		--markdown-heading: var(--note-text);
		--markdown-strong: var(--note-text);
		--markdown-link: var(--note-left);
		--markdown-quote-border: var(--note-dashed);
		--markdown-quote-text: var(--note-text-muted);
		--markdown-inline-code-bg: color-mix(
			in srgb,
			var(--note-left) 12%,
			var(--paper-surface, #ffffff)
		);
		--markdown-inline-code-text: var(--note-text);
		--markdown-code-bg: #162033;
		--markdown-code-header-bg: #1f2c44;
		--markdown-code-border: rgba(196, 167, 112, 0.22);
		--markdown-code-text: #f8fafc;
		--markdown-code-muted: #94a3b8;
		--markdown-code-keyword: #c084fc;
		--markdown-code-string: #34d399;
		--markdown-code-number: #fbbf24;
		--markdown-code-function: #60a5fa;
		--markdown-code-type: #f472b6;
		animation: paper-sheet-note-slide-open 0.22s ease both;
	}

	.paper-sheet-note__frame {
		overflow: hidden;
		border-top: 2px dashed var(--note-dashed);
		border-left: 4px solid var(--note-left);
		background: var(--note-bg);
	}

	.paper-sheet-note.is-review {
		--note-bg: var(--paper-review-teacher-bg, #fff7ed);
		--note-left: var(--paper-review-teacher-border, #d6a11e);
		--note-badge-text: var(--paper-review-teacher-text, #b07a00);
		--note-dot: var(--paper-review-teacher-border, #d6a11e);
		--note-status-pending: var(--paper-review-teacher-text, #b07a00);
		--note-status-processing: var(--paper-review-teacher-text, #b07a00);
	}

	.paper-sheet-note.is-correct {
		--note-bg: var(--paper-review-correct-bg, #f0fdf4);
		--note-left: var(--paper-review-correct-border, #22a66e);
		--note-badge-text: var(--paper-review-correct-text, #1a8c5b);
		--note-dot: var(--paper-review-correct-border, #22a66e);
		--note-status-pending: var(--paper-review-correct-text, #1a8c5b);
		--note-status-processing: var(--paper-review-correct-text, #1a8c5b);
	}

	.paper-sheet-note__header {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		border: 0;
		background: transparent;
		padding: 12px 12px 8px;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		color: var(--note-text);
	}

	.paper-sheet-note__pill,
	.paper-sheet-note__status {
		display: inline-flex;
		align-items: center;
		font-weight: 600;
		line-height: 1;
	}

	.paper-sheet-note__pill {
		border-radius: 4px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border: 1px solid var(--note-badge-border);
		background: var(--note-badge-bg);
		padding: 4px 6px;
		color: var(--note-badge-text);
	}

	.paper-sheet-note__status {
		margin-left: auto;
		gap: 8px;
		font-size: 14px;
		text-transform: lowercase;
	}

	.paper-sheet-note__status.is-processing {
		color: var(--note-status-processing);
	}

	.paper-sheet-note__status.is-open,
	.paper-sheet-note__status.is-pending {
		color: var(--note-status-pending);
	}

	.paper-sheet-note__status.is-optional,
	.paper-sheet-note__status.is-done {
		color: var(--note-status-done);
	}

	.paper-sheet-note__status-dot {
		height: 7px;
		width: 7px;
		border-radius: 999px;
		background: var(--note-dot);
		animation: paper-sheet-note-pulse 1.8s ease-in-out infinite;
	}

	.paper-sheet-note__status-spinner {
		height: 12px;
		width: 12px;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--note-status-processing) 20%, transparent);
		border-top-color: var(--note-status-processing);
		animation: paper-sheet-note-spin 0.8s linear infinite;
	}

	.paper-sheet-note__status-dot.is-static {
		animation: none;
	}

	.paper-sheet-note__status-icon {
		font-size: 12px;
		line-height: 1;
	}

	.paper-sheet-note__chevron {
		margin-left: 8px;
		flex-shrink: 0;
		font-size: 15px;
		line-height: 1;
		color: var(--note-left);
	}

	.paper-sheet-note__body {
		padding: 0 12px 12px;
	}

	@media (max-width: 720px) {
		.paper-sheet-note__header {
			flex-wrap: wrap;
		}

		.paper-sheet-note__status {
			margin-left: 0;
		}
	}

	@keyframes paper-sheet-note-slide-open {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes paper-sheet-note-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.75);
		}
	}

	@keyframes paper-sheet-note-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
