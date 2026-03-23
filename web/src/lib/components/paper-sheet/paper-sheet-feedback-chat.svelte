<script lang="ts">
	import { ChatComposer } from '$lib/components/chat/index.js';
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import { normalizeTutorMarkdown } from '@spark/schemas';

	type PaperSheetFeedbackDisplayTurn = {
		id: string;
		speaker: 'student' | 'tutor';
		text: string;
	};

	function appendDraft(seed: string): void {
		const nextValue = draft.trim().length === 0 ? seed : `${draft}\n${seed}`;
		onDraftChange(nextValue);
	}

	let {
		displayThread,
		processing = false,
		thinkingText = null,
		assistantDraftText = null,
		showAssistantDraft = false,
		showComposer = true,
		showFollowUpButton = false,
		showComposerTools = true,
		resolvedFollowUpMode = false,
		draft,
		placeholder,
		questionLabel,
		composerDisabled = false,
		runtimeLocked = false,
		onRequestFollowUp = undefined,
		onDraftChange,
		onReply
	}: {
		displayThread: PaperSheetFeedbackDisplayTurn[];
		processing?: boolean;
		thinkingText?: string | null;
		assistantDraftText?: string | null;
		showAssistantDraft?: boolean;
		showComposer?: boolean;
		showFollowUpButton?: boolean;
		showComposerTools?: boolean;
		resolvedFollowUpMode?: boolean;
		draft: string;
		placeholder: string;
		questionLabel: string;
		composerDisabled?: boolean;
		runtimeLocked?: boolean;
		onRequestFollowUp?: () => void;
		onDraftChange: (value: string) => void;
		onReply: (value?: string) => void;
	} = $props();

	const visibleThinkingText = $derived(showAssistantDraft ? null : thinkingText);
	const visibleDraft = $derived(runtimeLocked ? '' : draft);
	const visiblePlaceholder = $derived(runtimeLocked ? '' : placeholder);
	const visibleAssistantDraftText = $derived(
		assistantDraftText ? normalizeTutorMarkdown(assistantDraftText) : ''
	);
	const composerInputClass = $derived(
		runtimeLocked ? 'paper-sheet-note__input paper-sheet-note__input--locked' : 'paper-sheet-note__input'
	);
</script>

<div class="paper-sheet-note__thread" aria-live="polite" aria-relevant="additions text">
	{#each displayThread as turn (turn.id)}
		<div class={`paper-sheet-note__turn is-${turn.speaker}`}>
			<div class={`paper-sheet-note__bubble is-${turn.speaker}`}>
				<MarkdownContent
					markdown={turn.speaker === 'tutor' ? normalizeTutorMarkdown(turn.text) : turn.text}
					class="paper-sheet-note__bubble-markdown"
				/>
			</div>
		</div>
	{/each}
</div>

{#if processing}
	<div class="paper-sheet-note__processing" role="status" aria-live="polite">
		connecting…
	</div>
{/if}

{#if visibleThinkingText}
	<div class="paper-sheet-note__runtime" role="status" aria-live="polite">
		<p class="paper-sheet-note__runtime-label">Thinking stream</p>
		<div class="paper-sheet-note__runtime-body">
			<MarkdownContent markdown={visibleThinkingText} class="paper-sheet-note__bubble-markdown" />
		</div>
	</div>
{/if}

{#if showAssistantDraft}
	<div class="paper-sheet-note__turn is-tutor">
		<div class="paper-sheet-note__bubble is-tutor is-live-draft">
			<p class="paper-sheet-note__runtime-label">Response stream</p>
			<MarkdownContent
				markdown={visibleAssistantDraftText}
				class="paper-sheet-note__bubble-markdown"
			/>
		</div>
	</div>
{/if}

{#if showFollowUpButton}
	<div class="paper-sheet-note__followup">
		<button
			type="button"
			class="paper-sheet-note__followup-button"
			onclick={() => {
				onRequestFollowUp?.();
			}}
		>
			ask followup
		</button>
	</div>
{/if}

{#if showComposer}
	<div class={`paper-sheet-note__composer ${runtimeLocked ? 'is-runtime-locked' : ''}`}>
		<ChatComposer
			value={visibleDraft}
			placeholder={visiblePlaceholder}
			ariaLabel={`Reply for ${questionLabel}`}
			sendAriaLabel={`Send reply for ${questionLabel}`}
			micAriaLabel={`Add spoken-style reply prompt for ${questionLabel}`}
			attachAriaLabel={`Open attachment options for ${questionLabel}`}
			submitMode="enter"
			maxLines={5}
			showAttach={showComposerTools}
			showMic={showComposerTools}
			showTakePhoto={showComposerTools}
			inputClass={composerInputClass}
			disabled={composerDisabled}
			onInput={({ value }) => {
				onDraftChange(value);
			}}
			onAttachSelect={() => {
				if (!showComposerTools) {
					return;
				}
				appendDraft('[Mock attachment] I want to show my working for this answer.');
			}}
			onTakePhotoSelect={() => {
				if (!showComposerTools) {
					return;
				}
				appendDraft('[Mock photo] Here is a photo of the part I want checked.');
			}}
			onMicClick={() => {
				if (!showComposerTools) {
					return;
				}
				appendDraft('I think I should make one point more clearly here.');
			}}
			onSubmit={({ value }) => {
				if (composerDisabled) {
					return;
				}
				onReply(value);
			}}
		/>
	</div>
{/if}

<style>
	.paper-sheet-note__runtime {
		margin-top: 0.85rem;
		padding: 0.85rem 1rem;
		border-radius: 16px;
		border: 1px solid color-mix(in srgb, var(--note-left) 20%, transparent);
		background: color-mix(in srgb, var(--note-bg) 82%, white);
	}

	.paper-sheet-note__runtime-label {
		margin: 0 0 0.45rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--note-text-muted);
	}

	.paper-sheet-note__runtime-body {
		color: var(--note-text);
	}

	.paper-sheet-note__bubble.is-live-draft {
		border-style: dashed;
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
		font-size: 13px;
		line-height: 1.8;
		color: var(--note-text);
	}

	.paper-sheet-note__bubble-markdown {
		font-size: inherit;
		line-height: inherit;
	}

	.paper-sheet-note__bubble.is-student {
		padding: 10px 14px;
		border: 1px solid var(--note-user-border);
		border-radius: 8px 8px 0 8px;
		background: var(--note-user-bg);
		box-shadow: var(--paper-card-shadow, 0 1px 4px rgba(0, 0, 0, 0.08));
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
		--chat-composer-surface: var(--note-composer-surface);
		--chat-composer-border: var(--note-input-border);
		--chat-composer-stack-gap: 0.4rem;
		--chat-composer-focus-border: color-mix(
			in srgb,
			var(--note-input-border) 78%,
			var(--paper-surface, #ffffff)
		);
		--chat-composer-ring: color-mix(in srgb, var(--note-input-border) 36%, transparent);
		--chat-composer-shadow: none;
		--chat-composer-backdrop: none;
		--chat-composer-padding: 0.4rem 0.45rem 0.4rem 0.55rem;
		--chat-composer-gap: 0.55rem;
		--chat-composer-card-gap: 0.4rem;
		--chat-composer-text: var(--note-text);
		--chat-composer-placeholder: var(--paper-placeholder, rgba(148, 163, 184, 0.96));
		--chat-composer-font-size: 13px;
		--chat-composer-line-height: 1.45;
		--chat-composer-textarea-padding: 0 0.1rem 0.05rem;
		--chat-composer-button-size: 2rem;
		--chat-composer-button-fg: var(--paper-text-soft, rgba(87, 71, 58, 0.72));
		--chat-composer-button-hover-bg: var(--note-composer-hover);
		--chat-composer-button-hover-fg: var(--note-text);
		--chat-composer-trailing-gap: 0.25rem;
		--chat-composer-send-bg: var(--sheet-color);
		--chat-composer-send-fg: #ffffff;
		--chat-composer-send-hover-bg: color-mix(in srgb, var(--sheet-color) 90%, #000000);
		--chat-composer-send-disabled-bg: color-mix(
			in srgb,
			var(--sheet-color) 18%,
			var(--paper-surface, #ffffff)
		);
		--chat-composer-send-disabled-fg: var(--paper-text-subtle, rgba(87, 71, 58, 0.42));
		--chat-composer-send-shadow: none;
	}

	.paper-sheet-note__composer.is-runtime-locked {
		--chat-composer-surface: color-mix(
			in srgb,
			var(--paper-surface-soft, #f6f6f6) 90%,
			var(--note-left) 10%
		);
		--chat-composer-border: color-mix(
			in srgb,
			var(--paper-border, rgba(148, 163, 184, 0.24)) 80%,
			var(--note-left) 20%
		);
	}

	.paper-sheet-note__followup {
		padding-top: 0.35rem;
		display: flex;
		justify-content: flex-end;
	}

	.paper-sheet-note__followup-button {
		border: 1px solid color-mix(in srgb, var(--note-left) 26%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--note-bg) 72%, white);
		padding: 0.45rem 0.8rem;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		text-transform: lowercase;
		color: var(--note-left);
		cursor: pointer;
	}

	.paper-sheet-note__followup-button:hover {
		background: color-mix(in srgb, var(--note-bg) 62%, white);
	}

	:global(.paper-sheet-note__input::placeholder) {
		color: var(--paper-placeholder, rgba(148, 163, 184, 0.96));
	}

	:global(.paper-sheet-note__input--locked) {
		background: color-mix(
			in srgb,
			var(--paper-surface-soft, #f6f6f6) 88%,
			var(--note-left) 12%
		);
		border-radius: 12px;
		padding: 0.55rem 0.75rem 0.45rem !important;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--note-left) 16%, transparent);
	}

	@media (max-width: 720px) {
		.paper-sheet-note__composer {
			padding: 16px 16px 0;
			--chat-composer-button-size: 2rem;
		}

		.paper-sheet-note__thread,
		.paper-sheet-note__processing {
			padding-left: 0;
		}
	}
</style>
