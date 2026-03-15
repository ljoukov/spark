<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Camera from '@lucide/svelte/icons/camera';
	import Mic from '@lucide/svelte/icons/mic';
	import Plus from '@lucide/svelte/icons/plus';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ChatInput from './chat-input.svelte';

	type SubmitMode = 'modEnter' | 'enter';

	type Props = {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		maxLines?: number;
		maxChars?: number;
		ariaLabel?: string;
		sendAriaLabel?: string;
		micAriaLabel?: string;
		attachAriaLabel?: string;
		autocomplete?: HTMLTextareaAttributes['autocomplete'];
		spellcheck?: boolean;
		inputClass?: string;
		submitMode?: SubmitMode;
		showAttach?: boolean;
		showMic?: boolean;
		showTakePhoto?: boolean;
		attachmentShortcutLabel?: string | null;
		onInput?: (detail: { value: string; isExpanded?: boolean }) => void;
		onSubmit?: (detail: { value: string }) => void;
		onPaste?: (event: ClipboardEvent) => void;
		onAttachSelect?: () => void;
		onTakePhotoSelect?: () => void;
		onMicClick?: () => void;
	};

	let {
		value = $bindable(''),
		placeholder = 'Type your message',
		disabled = false,
		maxLines = 7,
		maxChars = 1000,
		ariaLabel = 'Message',
		sendAriaLabel = 'Send message',
		micAriaLabel = 'Voice input',
		attachAriaLabel = 'Attach',
		autocomplete = 'off',
		spellcheck = false,
		inputClass = '',
		submitMode = 'modEnter',
		showAttach = false,
		showMic = false,
		showTakePhoto = false,
		attachmentShortcutLabel = null,
		onInput = undefined,
		onSubmit = undefined,
		onPaste = undefined,
		onAttachSelect = undefined,
		onTakePhotoSelect = undefined,
		onMicClick = undefined
	}: Props = $props();

	let isExpanded = $state(false);

	const canSubmit = $derived(!disabled && value.trim().length > 0);

	function handleInput(detail: { value: string; isExpanded?: boolean }) {
		isExpanded = detail.isExpanded ?? detail.value.includes('\n');
		onInput?.(detail);
	}

	function handleSubmit() {
		const trimmed = value.trim();
		if (!trimmed || disabled) {
			return;
		}
		onSubmit?.({ value: trimmed });
	}

	function handleAttachSelect() {
		if (disabled) {
			return;
		}
		onAttachSelect?.();
	}

	function handleTakePhotoSelect() {
		if (disabled) {
			return;
		}
		onTakePhotoSelect?.();
	}

	function handleMicClick() {
		if (disabled) {
			return;
		}
		onMicClick?.();
	}
</script>

<div class="composer-stack">
	<div class="composer-card">
		<div class={`composer-field ${isExpanded ? 'is-expanded' : ''}`}>
			{#if showAttach}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="composer-btn composer-attach composer-leading"
						type="button"
						aria-label={attachAriaLabel}
						{disabled}
					>
						<Plus class="composer-icon" />
					</DropdownMenu.Trigger>

					<DropdownMenu.Content class="composer-menu" sideOffset={12} align="start">
						<DropdownMenu.Item class="composer-menu__item" onSelect={handleAttachSelect} {disabled}>
							<span class="composer-menu__icon" aria-hidden="true">
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									class="composer-menu__paperclip"
								>
									<path
										d="M10 9V15C10 16.1046 10.8954 17 12 17V17C13.1046 17 14 16.1046 14 15V7C14 4.79086 12.2091 3 10 3V3C7.79086 3 6 4.79086 6 7V15C6 18.3137 8.68629 21 12 21V21C15.3137 21 18 18.3137 18 15V8"
										stroke="currentColor"
									></path>
								</svg>
							</span>
							<span>Add photos &amp; files</span>
							{#if attachmentShortcutLabel}
								<DropdownMenu.Shortcut>{attachmentShortcutLabel}</DropdownMenu.Shortcut>
							{/if}
						</DropdownMenu.Item>

						{#if showTakePhoto}
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								class="composer-menu__item"
								onSelect={handleTakePhotoSelect}
								{disabled}
							>
								<span class="composer-menu__icon" aria-hidden="true">
									<Camera class="composer-icon" />
								</span>
								<span>Take photo</span>
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}

			<div class="composer-input">
				<ChatInput
					bind:value
					{placeholder}
					{disabled}
					{maxLines}
					{maxChars}
					{ariaLabel}
					{autocomplete}
					{spellcheck}
					variant="chat"
					{submitMode}
					inputClass={`composer-textarea ${inputClass}`.trim()}
					{onPaste}
					onInput={handleInput}
					onSubmit={handleSubmit}
				/>
			</div>

			<div class="composer-trailing">
				{#if showMic}
					<button
						class="composer-btn composer-mic"
						type="button"
						aria-label={micAriaLabel}
						{disabled}
						onclick={handleMicClick}
					>
						<Mic class="composer-icon" />
					</button>
				{/if}

				<button
					class="composer-btn composer-send"
					type="button"
					aria-label={sendAriaLabel}
					onclick={handleSubmit}
					disabled={!canSubmit}
				>
					<ArrowUp class="composer-icon" />
				</button>
			</div>

			<div class="composer-spacer" aria-hidden="true"></div>
		</div>
	</div>
</div>

<style>
	.composer-stack {
		display: flex;
		flex-direction: column;
		gap: var(--chat-composer-stack-gap, 0.6rem);
	}

	.composer-card {
		padding: var(--chat-composer-padding, 0.625rem);
		border-radius: var(--chat-composer-radius, 12px);
		border: 1px solid var(--chat-composer-border, var(--chat-border, rgba(148, 163, 184, 0.3)));
		background: var(--chat-composer-surface, var(--chat-surface, rgba(255, 255, 255, 0.94)));
		backdrop-filter: var(--chat-composer-backdrop, blur(16px));
		box-shadow: var(
			--chat-composer-shadow,
			0 18px 45px -32px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.55)
		);
		display: flex;
		flex-direction: column;
		gap: var(--chat-composer-card-gap, 0.6rem);
		overflow: clip;
		background-clip: padding-box;
	}

	.composer-card:focus-within {
		border-color: var(
			--chat-composer-focus-border,
			color-mix(in srgb, var(--text-secondary, rgba(30, 41, 59, 0.6)) 40%, transparent)
		);
		box-shadow:
			0 0 0 3px
				color-mix(
					in srgb,
					var(--chat-composer-ring, var(--ring, rgba(99, 102, 241, 0.4))) 35%,
					transparent
				),
			var(
				--chat-composer-shadow,
				0 18px 45px -32px rgba(15, 23, 42, 0.35),
				inset 0 1px 0 rgba(255, 255, 255, 0.55)
			);
	}

	.composer-field {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas: 'leading input trailing';
		align-items: center;
		gap: var(--chat-composer-gap, 0.6rem);
	}

	.composer-input {
		grid-area: input;
		min-width: 0;
		display: flex;
		align-items: stretch;
	}

	:global(.composer-textarea) {
		width: 100%;
		padding: var(--chat-composer-textarea-padding, 0.15rem 0.2rem 0.25rem);
		font-family: inherit;
		font-size: var(--chat-composer-font-size, 0.95rem);
		line-height: var(--chat-composer-line-height, 1.5rem);
		color: var(--chat-composer-text, var(--text-primary, var(--foreground, #111827)));
	}

	:global(.composer-textarea::placeholder) {
		color: var(--chat-composer-placeholder, var(--text-secondary, rgba(100, 116, 139, 0.72)));
	}

	.composer-leading {
		grid-area: leading;
	}

	.composer-trailing {
		grid-area: trailing;
		display: flex;
		align-items: center;
		gap: var(--chat-composer-trailing-gap, 0.4rem);
	}

	.composer-spacer {
		grid-area: spacer;
		display: none;
	}

	.composer-field.is-expanded {
		grid-template-areas:
			'input input input'
			'leading spacer trailing';
		row-gap: 0.45rem;
		align-items: end;
	}

	.composer-field.is-expanded .composer-spacer {
		display: block;
	}

	.composer-field.is-expanded .composer-input {
		padding-bottom: 0.25rem;
	}

	.composer-btn {
		display: grid;
		place-items: center;
		height: var(--chat-composer-button-size, 2.25rem);
		width: var(--chat-composer-button-size, 2.25rem);
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--chat-composer-button-fg, var(--text-secondary, rgba(30, 41, 59, 0.6)));
		transition:
			transform 0.2s ease,
			background 0.2s ease,
			color 0.2s ease,
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.composer-field.is-expanded .composer-btn {
		align-self: end;
	}

	.composer-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.composer-btn:not(.composer-send):not(:disabled):hover {
		background: var(--chat-composer-button-hover-bg, rgba(148, 163, 184, 0.18));
		color: var(--chat-composer-button-hover-fg, var(--text-primary, var(--foreground)));
		transform: translateY(-1px);
	}

	.composer-send {
		background: var(--chat-composer-send-bg, var(--chat-send-bg, #111827));
		color: var(--chat-composer-send-fg, var(--chat-send-fg, #ffffff));
		box-shadow: var(--chat-composer-send-shadow, 0 12px 30px -18px rgba(15, 23, 42, 0.35));
	}

	.composer-send:not(:disabled):hover {
		background: var(
			--chat-composer-send-hover-bg,
			color-mix(
				in srgb,
				var(--chat-composer-send-bg, var(--chat-send-bg, #111827)) 88%,
				transparent
			)
		);
		color: var(--chat-composer-send-fg, var(--chat-send-fg, #ffffff));
		transform: translateY(-1px) scale(1.02);
	}

	.composer-send:disabled {
		background: var(
			--chat-composer-send-disabled-bg,
			color-mix(
				in srgb,
				var(--chat-composer-send-bg, var(--chat-send-bg, #111827)) 60%,
				transparent
			)
		);
		color: var(
			--chat-composer-send-disabled-fg,
			color-mix(
				in srgb,
				var(--chat-composer-send-fg, var(--chat-send-fg, #ffffff)) 70%,
				transparent
			)
		);
	}

	.composer-icon {
		height: 1.05rem;
		width: 1.05rem;
	}

	:global(.composer-menu) {
		min-width: 15.5rem;
		padding: 0.35rem;
		border-radius: 1rem;
	}

	:global(.composer-menu__item) {
		gap: 0.65rem;
		padding: 0.6rem 0.65rem;
		border-radius: 0.75rem;
		font-size: 0.92rem;
	}

	:global(.composer-menu__icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
	}

	:global(.composer-menu__paperclip) {
		width: 1rem;
		height: 1rem;
	}
</style>
