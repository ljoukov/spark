<script lang="ts">
	type Props = {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		maxLines?: number;
		maxChars?: number;
		ariaLabel?: string;
		autocomplete?: string;
		spellcheck?: boolean;
		inputClass?: string;
		onInput?: (detail: { value: string }) => void;
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
		onInput = undefined,
		onSubmit = undefined
	}: Props = $props();

	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	function resizeTextarea() {
		if (!textareaEl) {
			return;
		}
		textareaEl.style.height = 'auto';
		const style = getComputedStyle(textareaEl);
		const lineHeight = Number.parseFloat(style.lineHeight) || 20;
		const paddingTop = Number.parseFloat(style.paddingTop) || 0;
		const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
		const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;
		const nextHeight = Math.min(textareaEl.scrollHeight, maxHeight);
		textareaEl.style.height = `${nextHeight}px`;
		textareaEl.style.overflowY = textareaEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
	}

	function handleInput(event: Event) {
		const target = event.target as HTMLTextAreaElement;
		value = target.value;
		resizeTextarea();
		onInput?.({ value });
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
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
	class={`min-h-[2.75rem] w-full resize-none rounded-2xl border-2 border-input bg-background px-4 py-3 text-base shadow-sm transition-colors focus-visible:border-ring ${
		inputClass
	}`}
	bind:this={textareaEl}
	bind:value
	oninput={handleInput}
	onkeydown={handleKeyDown}
	disabled={disabled}
	{autocomplete}
	spellcheck={spellcheck}
	rows={1}
	maxlength={maxChars}
	aria-label={ariaLabel}
	{placeholder}
></textarea>
