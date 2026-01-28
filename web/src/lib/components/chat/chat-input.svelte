<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	type ChatInputVariant = 'default' | 'chat';

	type SubmitMode = 'modEnter' | 'enter';

	type Props = {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		maxLines?: number;
		maxChars?: number;
		ariaLabel?: string;
		autocomplete?: HTMLTextareaAttributes['autocomplete'];
		spellcheck?: boolean;
		inputClass?: string;
		variant?: ChatInputVariant;
		submitMode?: SubmitMode;
		onInput?: (detail: { value: string; isExpanded?: boolean }) => void;
		onSubmit?: (detail: { value: string }) => void;
	};

	let {
		value = $bindable(''),
		placeholder = 'Type your message',
		disabled = false,
		maxLines = 7,
		maxChars = 1000,
		ariaLabel = 'Message',
		autocomplete = 'off',
		spellcheck = false,
		inputClass = '',
		variant = 'default',
		submitMode = 'modEnter',
		onInput = undefined,
		onSubmit = undefined
	}: Props = $props();

	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	function resolveBaseClass(currentVariant: ChatInputVariant): string {
		if (currentVariant === 'chat') {
			return [
				'min-h-0',
				'w-full',
				'resize-none',
				'rounded-none',
				'border-0',
				'bg-transparent',
				'px-0',
				'py-0',
				'text-[0.95rem]',
				'leading-6',
				'text-foreground',
				'placeholder:text-muted-foreground',
				'focus-visible:outline-none',
				'shadow-none'
			].join(' ');
		}
		return [
			'min-h-[2.75rem]',
			'w-full',
			'resize-none',
			'rounded-2xl',
			'border-2',
			'border-input',
			'bg-background',
			'px-4',
			'py-3',
			'text-base',
			'shadow-sm',
			'transition-colors',
			'focus-visible:border-ring'
		].join(' ');
	}

	function resizeTextarea() {
		if (!textareaEl) {
			return;
		}
		textareaEl.style.height = 'auto';
		const style = getComputedStyle(textareaEl);
		const lineHeight = Number.parseFloat(style.lineHeight) || 20;
		const paddingTop = Number.parseFloat(style.paddingTop) || 0;
		const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
		const wantsExtraLine = variant === 'chat' && submitMode === 'enter' && value.includes('\n');
		const singleHeight = lineHeight + paddingTop + paddingBottom;
		const minLines = wantsExtraLine ? Math.max(3, Math.min(maxLines, 3)) : 1;
		const minHeight = lineHeight * minLines + paddingTop + paddingBottom;
		const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;
		const nextHeight = Math.min(Math.max(textareaEl.scrollHeight, minHeight), maxHeight);
		textareaEl.style.height = `${nextHeight}px`;
		textareaEl.style.overflowY = textareaEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
		const isExpanded = wantsExtraLine || textareaEl.scrollHeight > singleHeight + 1;
		textareaEl.dataset.expanded = isExpanded ? 'true' : 'false';
	}

	function handleInput(event: Event) {
		const target = event.target as HTMLTextAreaElement;
		value = target.value;
		resizeTextarea();
		const isExpanded = target.dataset.expanded === 'true';
		onInput?.({ value, isExpanded });
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing) {
			return;
		}
		if (submitMode === 'enter') {
			if (event.shiftKey) {
				return;
			}
			event.preventDefault();
			const trimmed = value.trim();
			if (!trimmed) {
				return;
			}
			onSubmit?.({ value: trimmed });
			return;
		}
		if (event.metaKey || event.ctrlKey) {
			event.preventDefault();
			const trimmed = value.trim();
			if (!trimmed) {
				return;
			}
			onSubmit?.({ value: trimmed });
		}
	}

	$effect(() => {
		void value;
		resizeTextarea();
	});
</script>

<textarea
	class={`${resolveBaseClass(variant)} ${inputClass}`}
	bind:this={textareaEl}
	bind:value
	oninput={handleInput}
	onkeydown={handleKeyDown}
	{disabled}
	{autocomplete}
	{spellcheck}
	rows={1}
	maxlength={maxChars}
	aria-label={ariaLabel}
	{placeholder}
></textarea>
