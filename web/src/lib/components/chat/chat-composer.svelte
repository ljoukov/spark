<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Camera from '@lucide/svelte/icons/camera';
	import Mic from '@lucide/svelte/icons/mic';
	import Plus from '@lucide/svelte/icons/plus';
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ChatInput from './chat-input.svelte';

	type SubmitMode = 'modEnter' | 'enter';

	type Props = {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		showSubmitSpinner?: boolean;
		compactSubmitSpinner?: boolean;
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
		submitReady?: boolean;
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
		showSubmitSpinner = false,
		compactSubmitSpinner = false,
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
		submitReady = undefined,
		attachmentShortcutLabel = null,
		onInput = undefined,
		onSubmit = undefined,
		onPaste = undefined,
		onAttachSelect = undefined,
		onTakePhotoSelect = undefined,
		onMicClick = undefined
	}: Props = $props();

	let isExpanded = $state(false);
	let inputValue = $state('');
	let inputPlaceholder = $state('');
	let compactSpinnerVisible = $state(false);
	let preparingCompactSpinner = $state(false);

	const canSubmit = $derived(
		typeof submitReady === 'boolean' ? submitReady && !disabled : !disabled && inputValue.trim().length > 0
	);
	const hasAttachAction = $derived(Boolean(onAttachSelect));
	const hasTakePhotoAction = $derived(Boolean(onTakePhotoSelect));
	const hasMicAction = $derived(Boolean(onMicClick));
	const showAttachmentMenu = $derived(
		(showAttach && hasAttachAction) || (showTakePhoto && hasTakePhotoAction)
	);
	const wantsCompactSpinnerShell = $derived(showSubmitSpinner && compactSubmitSpinner);
	const showCompactSpinnerShell = $derived(compactSpinnerVisible);

	const COMPACT_TRANSITION_MULTIPLIER = 1;
	const COMPACT_FIELD_FADE_MS = 160 * COMPACT_TRANSITION_MULTIPLIER;
	const COMPACT_FIELD_OUTRO_MS = 120 * COMPACT_TRANSITION_MULTIPLIER;

	function handleInput(detail: { value: string; isExpanded?: boolean }) {
		inputValue = detail.value;
		value = detail.value;
		isExpanded = detail.isExpanded ?? detail.value.includes('\n');
		onInput?.(detail);
	}

	function handleSubmit() {
		const trimmed = inputValue.trim();
		if (!canSubmit || disabled) {
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

	$effect(() => {
		if (preparingCompactSpinner || compactSpinnerVisible) {
			return;
		}
		inputValue = value;
		inputPlaceholder = placeholder;
	});

	$effect(() => {
		if (!wantsCompactSpinnerShell) {
			preparingCompactSpinner = false;
			compactSpinnerVisible = false;
			inputValue = value;
			inputPlaceholder = placeholder;
			return;
		}

		preparingCompactSpinner = true;
		compactSpinnerVisible = false;
		inputValue = '';
		inputPlaceholder = '';
		let cancelled = false;

		void (async () => {
			await tick();
			if (cancelled) {
				return;
			}
			compactSpinnerVisible = true;
			preparingCompactSpinner = false;
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

<div class={`composer-stack ${showCompactSpinnerShell ? 'is-spinner-only' : ''}`}>
	<div class={`composer-card ${showCompactSpinnerShell ? 'is-spinner-only' : ''}`}>
		<div class={`composer-field ${isExpanded ? 'is-expanded' : ''} ${showCompactSpinnerShell ? 'is-spinner-only' : ''}`}>
			{#if showAttachmentMenu && !showCompactSpinnerShell}
				<div
					class="composer-leading composer-leading-shell"
					in:fade={{ duration: COMPACT_FIELD_FADE_MS }}
					out:fade={{ duration: COMPACT_FIELD_OUTRO_MS }}
				>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="composer-btn composer-attach"
							type="button"
							aria-label={attachAriaLabel}
							{disabled}
						>
							<Plus class="composer-icon" />
						</DropdownMenu.Trigger>

						<DropdownMenu.Content class="chat-composer__menu" sideOffset={12} align="start">
							{#if showAttach && hasAttachAction}
								<DropdownMenu.Item
									class="chat-composer__menu-item"
									onSelect={handleAttachSelect}
									{disabled}
								>
									<span class="chat-composer__menu-icon" aria-hidden="true">
										<svg
											width="18"
											height="18"
											viewBox="0 0 24 24"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											class="chat-composer__menu-paperclip"
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
							{/if}

							{#if showTakePhoto && hasTakePhotoAction}
								{#if showAttach && hasAttachAction}
									<DropdownMenu.Separator />
								{/if}
								<DropdownMenu.Item
									class="chat-composer__menu-item"
									onSelect={handleTakePhotoSelect}
									{disabled}
								>
									<span class="chat-composer__menu-icon" aria-hidden="true">
										<Camera class="composer-icon" />
									</span>
									<span>Take photo</span>
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}

			{#if !showCompactSpinnerShell}
				<div class="composer-input" in:fade={{ duration: COMPACT_FIELD_FADE_MS }} out:fade={{ duration: COMPACT_FIELD_OUTRO_MS }}>
					<ChatInput
						bind:value={inputValue}
						placeholder={inputPlaceholder}
						{disabled}
						{maxLines}
						{maxChars}
						{ariaLabel}
						{autocomplete}
						{spellcheck}
						variant="chat"
						{submitMode}
						inputClass={`chat-composer__textarea ${inputClass}`.trim()}
						{onPaste}
						onInput={handleInput}
						onLayoutChange={({ isExpanded: nextIsExpanded }) => {
							isExpanded = nextIsExpanded;
						}}
						onSubmit={handleSubmit}
					/>
				</div>
			{/if}

			<div class={`composer-trailing ${showCompactSpinnerShell ? 'is-spinner-only' : ''}`}>
				{#if showMic && hasMicAction && !showCompactSpinnerShell}
					<button
						in:fade={{ duration: COMPACT_FIELD_FADE_MS }}
						out:fade={{ duration: COMPACT_FIELD_OUTRO_MS }}
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
					class={`composer-btn composer-send ${showCompactSpinnerShell ? 'composer-send--spinner-only' : ''}`}
					type="button"
					aria-label={sendAriaLabel}
					onclick={handleSubmit}
					disabled={showSubmitSpinner || !canSubmit}
				>
					{#if showSubmitSpinner}
						<span class="composer-spinner" aria-hidden="true"></span>
					{:else}
						<ArrowUp class="composer-icon" />
					{/if}
				</button>
			</div>

			{#if !showCompactSpinnerShell}
				<div class="composer-spacer" aria-hidden="true"></div>
			{/if}
		</div>
	</div>
</div>

<style>
	.composer-stack {
		display: flex;
		flex-direction: column;
		gap: var(--chat-composer-stack-gap, 0.6rem);
	}

	.composer-stack.is-spinner-only {
		align-items: flex-end;
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
		transition:
			padding var(--chat-composer-shell-transition-duration, 0.2s) ease,
			border-radius var(--chat-composer-shell-transition-duration, 0.2s) ease,
			background var(--chat-composer-shell-transition-duration, 0.2s) ease,
			border-color var(--chat-composer-shell-transition-duration, 0.2s) ease,
			box-shadow var(--chat-composer-shell-transition-duration, 0.2s) ease;
	}

	.composer-card.is-spinner-only {
		padding: var(--chat-composer-spinner-shell-padding, 0.2rem);
		border-radius: 999px;
		background: var(
			--chat-composer-spinner-shell-bg,
			color-mix(in srgb, var(--chat-composer-surface, rgba(255, 255, 255, 0.94)) 92%, transparent)
		);
		border-color: var(
			--chat-composer-spinner-shell-border,
			var(--chat-composer-border, rgba(148, 163, 184, 0.3))
		);
		box-shadow: none;
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

	:global(.chat-composer__textarea) {
		width: 100%;
		padding: var(--chat-composer-textarea-padding, 0.15rem 0.2rem 0.25rem);
		font-family: inherit;
		font-size: var(--chat-composer-font-size, 0.95rem);
		line-height: var(--chat-composer-line-height, 1.5rem);
		color: var(--chat-composer-text, var(--text-primary, var(--foreground, #111827)));
	}

	:global(.chat-composer__textarea::placeholder) {
		color: var(--chat-composer-placeholder, var(--text-secondary, rgba(100, 116, 139, 0.72)));
	}

	.composer-leading {
		grid-area: leading;
	}

	.composer-leading-shell {
		display: flex;
		align-items: center;
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

	.composer-field.is-spinner-only {
		display: flex;
		align-items: center;
		justify-content: flex-end;
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

	.composer-trailing.is-spinner-only {
		gap: 0;
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
			transform var(--chat-composer-button-transition-duration, 0.2s) ease,
			background var(--chat-composer-button-transition-duration, 0.2s) ease,
			color var(--chat-composer-button-transition-duration, 0.2s) ease,
			border-color var(--chat-composer-button-transition-duration, 0.2s) ease,
			box-shadow var(--chat-composer-button-transition-duration, 0.2s) ease;
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

	.composer-send--spinner-only,
	.composer-send--spinner-only:disabled {
		background: transparent;
		border-color: transparent;
		color: var(
			--chat-composer-spinner-shell-fg,
			var(--chat-composer-send-bg, var(--chat-send-bg, #111827))
		);
		box-shadow: none;
		opacity: 1;
		cursor: default;
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

	.composer-send--spinner-only:disabled {
		background: transparent;
		border-color: transparent;
		color: var(
			--chat-composer-spinner-shell-fg,
			var(--chat-composer-send-bg, var(--chat-send-bg, #111827))
		);
		box-shadow: none;
		opacity: 1;
	}

	.composer-icon {
		height: 1.05rem;
		width: 1.05rem;
	}

	.composer-spinner {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, currentColor 40%, transparent);
		border-top-color: currentColor;
		animation: chat-composer-spin 0.8s linear infinite;
	}

	@keyframes chat-composer-spin {
		to {
			transform: rotate(360deg);
		}
	}

	:global(.chat-composer__menu) {
		min-width: 15.5rem;
		padding: 0.35rem;
		border-radius: 1rem;
	}

	:global(.chat-composer__menu-item) {
		gap: 0.65rem;
		padding: 0.6rem 0.65rem;
		border-radius: 0.75rem;
		font-size: 0.92rem;
	}

	:global(.chat-composer__menu-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
	}

	:global(.chat-composer__menu-paperclip) {
		width: 1rem;
		height: 1rem;
	}
</style>
