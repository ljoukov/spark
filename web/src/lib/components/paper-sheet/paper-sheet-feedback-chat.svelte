<script lang="ts">
	import { ChatComposer } from '$lib/components/chat/index.js';
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import {
		SPARK_ATTACHMENT_FILE_INPUT_ACCEPT,
		isSparkImageAttachmentMimeType,
		resolveSparkAttachmentBadge
	} from '$lib/spark/attachments';
	import { normalizeTutorMarkdown } from '@spark/schemas';
	import type {
		PaperSheetComposerAttachmentDraft,
		PaperSheetFeedbackTurn
	} from './types';

	function openPicker(input: HTMLInputElement | null): void {
		if (!input) {
			return;
		}
		input.value = '';
		input.click();
	}

	let {
		displayThread,
		processing = false,
		thinkingText = null,
		assistantDraftText = null,
		showAssistantDraft = false,
		showComposer = true,
		showFollowUpButton = false,
		resolvedFollowUpMode = false,
		draft,
		draftAttachments = [],
		draftAttachmentError = null,
		allowAttachments = false,
		allowTakePhoto = false,
		placeholder,
		questionLabel,
		composerDisabled = false,
		runtimeLocked = false,
		onRequestFollowUp = undefined,
		onAttachFiles = undefined,
		onRemoveDraftAttachment = undefined,
		onDraftChange,
		onReply
	}: {
		displayThread: PaperSheetFeedbackTurn[];
		processing?: boolean;
		thinkingText?: string | null;
		assistantDraftText?: string | null;
		showAssistantDraft?: boolean;
		showComposer?: boolean;
		showFollowUpButton?: boolean;
		resolvedFollowUpMode?: boolean;
		draft: string;
		draftAttachments?: PaperSheetComposerAttachmentDraft[];
		draftAttachmentError?: string | null;
		allowAttachments?: boolean;
		allowTakePhoto?: boolean;
		placeholder: string;
		questionLabel: string;
		composerDisabled?: boolean;
		runtimeLocked?: boolean;
		onRequestFollowUp?: () => void;
		onAttachFiles?: (files: File[]) => void | Promise<void>;
		onRemoveDraftAttachment?: (localId: string) => void;
		onDraftChange: (value: string) => void;
		onReply: (value?: string) => void;
	} = $props();

	let attachmentInputRef = $state<HTMLInputElement | null>(null);
	let photoInputRef = $state<HTMLInputElement | null>(null);

	const visibleThinkingText = $derived(showAssistantDraft ? null : thinkingText);
	const visibleDraft = $derived(runtimeLocked ? '' : draft);
	const visiblePlaceholder = $derived(runtimeLocked ? '' : placeholder);
	const visibleAssistantDraftText = $derived(
		assistantDraftText ? normalizeTutorMarkdown(assistantDraftText) : ''
	);
	const submitReady = $derived(
		!composerDisabled && (visibleDraft.trim().length > 0 || draftAttachments.length > 0)
	);
	const composerInputClass = $derived(
		runtimeLocked ? 'paper-sheet-note__input paper-sheet-note__input--locked' : 'paper-sheet-note__input'
	);

	function handleAttachmentInput(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}
		const files = target.files ? Array.from(target.files) : [];
		target.value = '';
		if (files.length === 0) {
			return;
		}
		void onAttachFiles?.(files);
	}
</script>

<div class="paper-sheet-note__thread" aria-live="polite" aria-relevant="additions text">
	{#each displayThread as turn (turn.id)}
		<div class={`paper-sheet-note__turn is-${turn.speaker}`}>
			<div class={`paper-sheet-note__bubble is-${turn.speaker}`}>
				{#if turn.attachments && turn.attachments.length > 0}
					<div class="paper-sheet-note__attachments">
						{#each turn.attachments as attachment (attachment.id)}
							{@const isImage = isSparkImageAttachmentMimeType(attachment.contentType)}
							{@const attachmentUrl = attachment.url}
							{@const badge = resolveSparkAttachmentBadge({
								filename: attachment.filename,
								contentType: attachment.contentType
							})}
							{#if isImage && attachmentUrl}
								<a
									class="paper-sheet-note__attachment-card is-image"
									href={attachmentUrl}
									target="_blank"
									rel="noreferrer"
								>
									<img src={attachmentUrl} alt={attachment.filename} loading="lazy" />
									<span class="paper-sheet-note__attachment-name">{attachment.filename}</span>
								</a>
							{:else if attachmentUrl}
								<a
									class="paper-sheet-note__attachment-card is-file"
									href={attachmentUrl}
									target="_blank"
									rel="noreferrer"
								>
									<span class="paper-sheet-note__attachment-badge">{badge}</span>
									<span class="paper-sheet-note__attachment-name">{attachment.filename}</span>
								</a>
							{:else}
								<div class="paper-sheet-note__attachment-card is-file">
									<span class="paper-sheet-note__attachment-badge">{badge}</span>
									<span class="paper-sheet-note__attachment-name">{attachment.filename}</span>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
				{#if turn.text.trim().length > 0}
					<MarkdownContent
						markdown={turn.speaker === 'tutor' ? normalizeTutorMarkdown(turn.text) : turn.text}
						class="paper-sheet-note__bubble-markdown"
					/>
				{/if}
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
		<input
			class="paper-sheet-note__file-input"
			bind:this={attachmentInputRef}
			type="file"
			accept={SPARK_ATTACHMENT_FILE_INPUT_ACCEPT}
			multiple
			onchange={handleAttachmentInput}
		/>
		<input
			class="paper-sheet-note__file-input"
			bind:this={photoInputRef}
			type="file"
			accept="image/*"
			capture="environment"
			onchange={handleAttachmentInput}
		/>
		{#if draftAttachments.length > 0}
			<div class="paper-sheet-note__attachments is-draft">
				{#each draftAttachments as attachment (attachment.localId)}
					{@const isImage = isSparkImageAttachmentMimeType(attachment.contentType)}
					{@const badge = resolveSparkAttachmentBadge({
						filename: attachment.filename,
						contentType: attachment.contentType
					})}
					<div class={`paper-sheet-note__attachment-card ${isImage && attachment.previewUrl ? 'is-image' : 'is-file'}`}>
						{#if isImage && attachment.previewUrl}
							<img src={attachment.previewUrl} alt={attachment.filename} loading="lazy" />
						{:else}
							<span class="paper-sheet-note__attachment-badge">{badge}</span>
						{/if}
						<span class="paper-sheet-note__attachment-name">{attachment.filename}</span>
						<button
							type="button"
							class="paper-sheet-note__attachment-remove"
							aria-label={`Remove ${attachment.filename}`}
							disabled={composerDisabled}
							onclick={() => {
								onRemoveDraftAttachment?.(attachment.localId);
							}}
						>
							×
						</button>
					</div>
				{/each}
			</div>
		{/if}
		{#if draftAttachmentError}
			<p class="paper-sheet-note__attachment-error" role="alert">{draftAttachmentError}</p>
		{/if}
		<ChatComposer
			value={visibleDraft}
			placeholder={visiblePlaceholder}
			ariaLabel={`Reply for ${questionLabel}`}
			sendAriaLabel={`Send reply for ${questionLabel}`}
			micAriaLabel={`Add spoken-style reply prompt for ${questionLabel}`}
			attachAriaLabel={`Open attachment options for ${questionLabel}`}
			submitMode="enter"
			maxLines={5}
			showAttach={allowAttachments}
			showMic={false}
			showTakePhoto={allowAttachments && allowTakePhoto}
			{submitReady}
			showSubmitSpinner={runtimeLocked}
			compactSubmitSpinner={runtimeLocked}
			inputClass={composerInputClass}
			disabled={composerDisabled}
			onInput={({ value }) => {
				onDraftChange(value);
			}}
			onAttachSelect={() => {
				if (!allowAttachments) {
					return;
				}
				openPicker(attachmentInputRef);
			}}
			onTakePhotoSelect={() => {
				if (!allowAttachments || !allowTakePhoto) {
					return;
				}
				openPicker(photoInputRef);
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
		font-size: 16px;
		line-height: 1.8;
		color: var(--note-text);
	}

	.paper-sheet-note__bubble-markdown {
		font-size: inherit;
		line-height: inherit;
	}

	.paper-sheet-note__attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-bottom: 0.45rem;
	}

	.paper-sheet-note__attachments.is-draft {
		margin-bottom: 0.7rem;
	}

	.paper-sheet-note__attachment-card {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		max-width: min(18rem, 100%);
		padding: 0.45rem 0.55rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--note-left) 18%, transparent);
		background: color-mix(in srgb, var(--paper-surface-elevated, #ffffff) 92%, transparent);
		color: inherit;
		text-decoration: none;
	}

	.paper-sheet-note__attachment-card.is-image {
		align-items: stretch;
		flex-direction: column;
		width: min(12rem, 100%);
		padding: 0.4rem;
	}

	.paper-sheet-note__attachment-card.is-image img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: 10px;
		background: color-mix(in srgb, var(--note-left) 8%, transparent);
	}

	.paper-sheet-note__attachment-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.2rem;
		padding: 0.2rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--note-left) 12%, transparent);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.paper-sheet-note__attachment-name {
		min-width: 0;
		font-size: 0.82rem;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.paper-sheet-note__attachment-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		width: 1.5rem;
		height: 1.5rem;
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--note-left) 12%, transparent);
		color: inherit;
		cursor: pointer;
	}

	.paper-sheet-note__attachment-error {
		margin: 0 0 0.55rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--note-left);
	}

	.paper-sheet-note__bubble.is-student {
		padding: 10px 14px;
		border: 1.5px solid var(--note-user-border);
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
		padding: 16px 0 0;
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
		--chat-composer-font-size: 16px;
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
		--chat-composer-spinner-shell-padding: 0.18rem;
		--chat-composer-spinner-shell-bg: color-mix(
			in srgb,
			var(--paper-surface-elevated, #ffffff) 92%,
			var(--note-left) 8%
		);
		--chat-composer-spinner-shell-border: color-mix(
			in srgb,
			var(--note-left) 34%,
			var(--paper-surface, #ffffff)
		);
		--chat-composer-spinner-shell-fg: var(--sheet-color);
	}

	.paper-sheet-note__file-input {
		display: none;
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

	@media (max-width: 720px) {
		.paper-sheet-note__composer {
			padding: 16px 0 0;
			--chat-composer-button-size: 2rem;
		}

		.paper-sheet-note__thread,
		.paper-sheet-note__processing {
			padding-left: 0;
		}
	}
</style>
