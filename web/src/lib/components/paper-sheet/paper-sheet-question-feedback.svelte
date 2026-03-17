<script lang="ts">
	import { ChatComposer } from '$lib/components/chat/index.js';
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import type { PaperSheetQuestionReview } from './types';

	type ThreadTurn = {
		id: string;
		speaker: 'student' | 'tutor';
		text: string;
	};

	function getToneClass(review: PaperSheetQuestionReview): string {
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
		thread: ThreadTurn[],
		fallbackLabel: string
	): {
		kind: 'pending' | 'processing' | 'open' | 'optional' | 'done';
		label: string;
	} {
		if (processing) {
			return {
				kind: 'processing',
				label: 'processing'
			};
		}

		if (review.status === 'correct') {
			if (thread.length > 0) {
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

		if (thread.length > 0) {
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

	function appendDraft(seed: string): void {
		const nextValue = draft.trim().length === 0 ? seed : `${draft}\n${seed}`;
		onDraftChange(nextValue);
	}

	let {
		review,
		open = true,
		draft,
		thread,
		processing = false,
		questionLabel,
		onToggle,
		onDraftChange,
		onReply
	}: {
		review: PaperSheetQuestionReview;
		open?: boolean;
		draft: string;
		thread: ThreadTurn[];
		processing?: boolean;
		questionLabel: string;
		onToggle: () => void;
		onDraftChange: (value: string) => void;
		onReply: (value?: string) => void;
	} = $props();

	const noteLabel = $derived(review.label ?? 'Tutor note');
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
	const statusState = $derived.by(() => getStatusState(review, processing, thread, statusLabel));
	const displayThread = $derived.by((): ThreadTurn[] => [
		{
			id: `${noteLabel}-initial`,
			speaker: 'tutor',
			text: review.note
		},
		...thread
	]);
</script>

<section class={`paper-sheet-note ${getToneClass(review)}`}>
	<div class="paper-sheet-note__frame">
		<button type="button" class="paper-sheet-note__header" aria-expanded={open} onclick={onToggle}>
			<span class="paper-sheet-note__pill">{noteLabel}</span>

			<span class={`paper-sheet-note__status is-${statusState.kind}`}>
				{#if statusState.kind === 'pending'}
					<span class="paper-sheet-note__status-dot" aria-hidden="true"></span>
				{:else if statusState.kind === 'open'}
					<span class="paper-sheet-note__status-dot is-static" aria-hidden="true"></span>
				{:else}
					<span class="paper-sheet-note__status-icon" aria-hidden="true">
						{statusState.kind === 'processing' ? '…' : '✓'}
					</span>
				{/if}
				{statusState.label}
			</span>

			<span class="paper-sheet-note__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
		</button>

		{#if open}
			<div class="paper-sheet-note__body">
				<div class="paper-sheet-note__thread" aria-live="polite" aria-relevant="additions text">
					{#each displayThread as turn (turn.id)}
						<div class={`paper-sheet-note__turn is-${turn.speaker}`}>
							<div class={`paper-sheet-note__bubble is-${turn.speaker}`}>
								<MarkdownContent markdown={turn.text} class="paper-sheet-note__bubble-markdown" />
							</div>
						</div>
					{/each}
				</div>

				{#if processing}
					<div class="paper-sheet-note__processing" role="status" aria-live="polite">sending…</div>
				{/if}

				<div class="paper-sheet-note__composer">
					<ChatComposer
						value={draft}
						placeholder={review.replyPlaceholder ?? 'Write your response to the tutor...'}
						ariaLabel={`Reply to tutor for ${questionLabel}`}
						sendAriaLabel={`Send reply to tutor for ${questionLabel}`}
						micAriaLabel={`Add spoken-style reply prompt for ${questionLabel}`}
						attachAriaLabel={`Open attachment options for ${questionLabel}`}
						submitMode="enter"
						maxLines={5}
						showAttach={true}
						showMic={true}
						showTakePhoto={true}
						inputClass="paper-sheet-note__input"
						onInput={({ value }) => {
							onDraftChange(value);
						}}
						onAttachSelect={() => {
							appendDraft('[Mock attachment] I want to show the tutor my working for this answer.');
						}}
						onTakePhotoSelect={() => {
							appendDraft('[Mock photo] Here is a photo of the part I want feedback on.');
						}}
						onMicClick={() => {
							appendDraft('I think I should make one point more clearly here.');
						}}
						onSubmit={({ value }) => {
							onReply(value);
						}}
					/>
				</div>
			</div>
		{/if}
	</div>
</section>

<style>
	.paper-sheet-note {
		width: 100%;
		min-width: 0;
		font-family: inherit;
		--note-bg: #fffbea;
		--note-left: #d97706;
		--note-dashed: #fbbf24;
		--note-badge-bg: #fef9c3;
		--note-badge-border: #fde047;
		--note-badge-text: #a16207;
		--note-dot: #f59e0b;
		--note-status-pending: #d97706;
		--note-status-processing: #a16207;
		--note-status-done: #16a34a;
		--note-user-bg: #fffde7;
		--note-user-border: #f9d700;
		--note-input-border: #f2cd2f;
		--note-text: #241d19;
		--note-text-muted: rgba(87, 71, 58, 0.72);
		--markdown-text: var(--note-text);
		--markdown-heading: var(--note-text);
		--markdown-strong: var(--note-text);
		--markdown-link: var(--note-left);
		--markdown-quote-border: var(--note-dashed);
		--markdown-quote-text: var(--note-text-muted);
		--markdown-inline-code-bg: color-mix(in srgb, var(--note-left) 12%, #ffffff);
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
		--note-bg: #fff7ed;
		--note-left: #c2410c;
		--note-dashed: #fb923c;
		--note-badge-bg: #ffedd5;
		--note-badge-border: #fdba74;
		--note-badge-text: #9a3412;
		--note-dot: #ef4444;
		--note-status-pending: #c2410c;
		--note-status-processing: #9a3412;
		--note-input-border: #fdba74;
		--note-user-bg: #fff0e0;
		--note-user-border: #f4a05a;
	}

	.paper-sheet-note.is-correct {
		--note-bg: #f0fdf4;
		--note-left: #16a34a;
		--note-dashed: #86efac;
		--note-badge-bg: #dcfce7;
		--note-badge-border: #86efac;
		--note-badge-text: #166534;
		--note-dot: #16a34a;
		--note-status-pending: #15803d;
		--note-status-processing: #166534;
		--note-input-border: #86efac;
		--note-user-bg: #f0fdf4;
		--note-user-border: #86efac;
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

	.paper-sheet-note__bubble {
		font-size: 13px;
		line-height: 1.8;
		color: var(--note-text);
	}

	.paper-sheet-note__bubble-markdown {
		font-size: inherit;
		line-height: inherit;
	}

	.paper-sheet-note__thread {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 0 4px;
		margin-bottom: 8px;
	}

	.paper-sheet-note__turn {
		display: flex;
	}

	.paper-sheet-note__turn.is-student {
		justify-content: flex-end;
	}

	.paper-sheet-note__bubble {
		max-width: min(32rem, 100%);
	}

	.paper-sheet-note__bubble.is-student {
		padding: 10px 14px;
		border: 1px solid var(--note-user-border);
		border-radius: 8px 8px 0 8px;
		background: var(--note-user-bg);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
	}

	.paper-sheet-note__bubble.is-tutor {
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.paper-sheet-note__processing {
		padding: 0 4px 4px 32px;
		font-size: 12px;
		font-style: italic;
		color: var(--note-status-processing);
	}

	.paper-sheet-note__composer {
		padding: 16px 16px 0;
		--chat-composer-surface: rgba(255, 255, 255, 0.92);
		--chat-composer-border: var(--note-input-border);
		--chat-composer-stack-gap: 0.4rem;
		--chat-composer-focus-border: color-mix(
			in srgb,
			var(--note-input-border) 78%,
			rgba(36, 29, 25, 0.18)
		);
		--chat-composer-ring: color-mix(in srgb, var(--note-input-border) 36%, transparent);
		--chat-composer-shadow: none;
		--chat-composer-backdrop: none;
		--chat-composer-padding: 0.4rem 0.45rem 0.4rem 0.55rem;
		--chat-composer-gap: 0.55rem;
		--chat-composer-card-gap: 0.4rem;
		--chat-composer-text: var(--note-text);
		--chat-composer-placeholder: rgba(148, 163, 184, 0.96);
		--chat-composer-font-size: 13px;
		--chat-composer-line-height: 1.45;
		--chat-composer-textarea-padding: 0 0.1rem 0.05rem;
		--chat-composer-button-size: 2rem;
		--chat-composer-button-fg: rgba(87, 71, 58, 0.72);
		--chat-composer-button-hover-bg: rgba(226, 211, 184, 0.34);
		--chat-composer-button-hover-fg: var(--note-text);
		--chat-composer-trailing-gap: 0.25rem;
		--chat-composer-send-bg: var(--sheet-color);
		--chat-composer-send-fg: #ffffff;
		--chat-composer-send-hover-bg: color-mix(in srgb, var(--sheet-color) 90%, #000000);
		--chat-composer-send-disabled-bg: color-mix(in srgb, var(--sheet-color) 18%, #ffffff);
		--chat-composer-send-disabled-fg: rgba(87, 71, 58, 0.42);
		--chat-composer-send-shadow: none;
	}

	:global(.paper-sheet-note__input::placeholder) {
		color: rgba(148, 163, 184, 0.96);
	}

	@media (max-width: 720px) {
		.paper-sheet-note__header {
			flex-wrap: wrap;
		}

		.paper-sheet-note__status {
			margin-left: 0;
		}

		.paper-sheet-note__composer {
			padding: 16px 16px 0;
			--chat-composer-button-size: 2rem;
		}

		.paper-sheet-note__thread,
		.paper-sheet-note__processing {
			padding-left: 0;
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
</style>
