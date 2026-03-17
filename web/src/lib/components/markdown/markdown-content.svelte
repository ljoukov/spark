<script lang="ts">
	import { browser } from '$app/environment';
	import { renderMarkdown, renderMarkdownInline } from '$lib/markdown';

	async function copyText(value: string): Promise<boolean> {
		if (!browser) {
			return false;
		}
		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(value);
				return true;
			} catch {
				// Fall back to document.execCommand below.
			}
		}
		try {
			const textarea = document.createElement('textarea');
			textarea.value = value;
			textarea.setAttribute('readonly', 'true');
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			textarea.style.pointerEvents = 'none';
			document.body.appendChild(textarea);
			textarea.select();
			const ok = document.execCommand('copy');
			textarea.remove();
			return ok;
		} catch {
			return false;
		}
	}

	const copyResetTimers = new WeakMap<HTMLButtonElement, number>();

	function setCopyButtonState(
		button: HTMLButtonElement,
		state: 'idle' | 'copied' | 'error' | 'empty',
		label: string
	): void {
		button.setAttribute('aria-label', label);
		if (state === 'idle') {
			delete button.dataset.copyState;
		} else {
			button.dataset.copyState = state;
		}
		const existingTimer = copyResetTimers.get(button);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}
		const timeoutId = window.setTimeout(() => {
			button.setAttribute('aria-label', 'Copy code');
			delete button.dataset.copyState;
		}, 1400);
		copyResetTimers.set(button, timeoutId);
	}

	async function handleCodeCopyClick(event: MouseEvent): Promise<void> {
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>('[data-code-copy]');
		if (!button) {
			return;
		}
		event.preventDefault();
		const codeEl = button.closest('.code-block')?.querySelector('code');
		const code = codeEl?.textContent ?? '';
		if (!code) {
			setCopyButtonState(button, 'empty', 'No code');
			return;
		}
		const ok = await copyText(code);
		setCopyButtonState(button, ok ? 'copied' : 'error', ok ? 'Copied' : 'Copy failed');
	}

	let {
		markdown,
		inline = false,
		class: className = undefined
	}: {
		markdown: string;
		inline?: boolean;
		class?: string;
	} = $props();

	const renderedHtml = $derived.by(() => {
		const trimmed = markdown.trim();
		if (trimmed.length === 0) {
			return '';
		}
		return inline ? renderMarkdownInline(markdown) : renderMarkdown(markdown);
	});

	const rootClass = $derived(
		['markdown-content', inline ? 'is-inline' : null, className].filter(Boolean).join(' ')
	);
	let rootElement = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!browser || !rootElement) {
			return;
		}
		const element = rootElement;
		element.addEventListener('click', handleCodeCopyClick);
		return () => {
			element.removeEventListener('click', handleCodeCopyClick);
		};
	});
</script>

{#if inline}
	<span bind:this={rootElement} class={rootClass}>
		{@html renderedHtml}
	</span>
{:else}
	<div bind:this={rootElement} class={rootClass}>
		{@html renderedHtml}
	</div>
{/if}

<style>
	.markdown-content {
		color: var(--markdown-text, inherit);
		font-size: inherit;
		line-height: inherit;
	}

	.markdown-content.is-inline {
		display: inline;
	}

	:global(.markdown-content > * + *) {
		margin-top: 0.75rem;
	}

	:global(.markdown-content h1),
	:global(.markdown-content h2),
	:global(.markdown-content h3),
	:global(.markdown-content h4) {
		margin-top: 1rem;
		margin-bottom: 0.4rem;
		font-size: 1.05em;
		font-weight: 600;
		line-height: 1.35;
		color: var(--markdown-heading, var(--markdown-text, inherit));
	}

	:global(.markdown-content p) {
		margin: 0;
	}

	:global(.markdown-content ul),
	:global(.markdown-content ol) {
		margin: 0;
		padding-left: 1.25rem;
		list-style-position: outside;
	}

	:global(.markdown-content ul) {
		list-style-type: disc;
	}

	:global(.markdown-content ol) {
		list-style-type: decimal;
	}

	:global(.markdown-content li + li) {
		margin-top: 0.3rem;
	}

	:global(.markdown-content a) {
		color: var(--markdown-link, currentColor);
		text-decoration: underline;
		text-underline-offset: 0.16em;
	}

	:global(.markdown-content strong) {
		color: var(--markdown-strong, currentColor);
		font-weight: 700;
	}

	:global(.markdown-content em) {
		font-style: italic;
	}

	:global(.markdown-content blockquote) {
		margin: 0;
		padding-left: 0.9rem;
		border-left: 3px solid
			var(--markdown-quote-border, color-mix(in srgb, currentColor 18%, transparent));
		color: var(--markdown-quote-text, color-mix(in srgb, currentColor 78%, transparent));
	}

	:global(.markdown-content table) {
		width: 100%;
		border-collapse: collapse;
		border-radius: 0.85rem;
		overflow: hidden;
		border: 1px solid
			var(--markdown-table-border, color-mix(in srgb, currentColor 16%, transparent));
		font-size: 0.92em;
	}

	:global(.markdown-content thead) {
		background: var(--markdown-table-head-bg, color-mix(in srgb, currentColor 8%, transparent));
	}

	:global(.markdown-content th),
	:global(.markdown-content td) {
		padding: 0.55rem 0.65rem;
		text-align: left;
		border-bottom: 1px solid
			var(--markdown-table-border, color-mix(in srgb, currentColor 16%, transparent));
	}

	:global(.markdown-content tbody tr:last-child td) {
		border-bottom: none;
	}

	:global(.markdown-content :not(pre) > code) {
		padding: 0.1rem 0.3rem;
		border-radius: 0.3rem;
		background: var(--markdown-inline-code-bg, color-mix(in srgb, currentColor 12%, transparent));
		color: var(--markdown-inline-code-text, currentColor);
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85em;
	}

	:global(.markdown-content .katex-display) {
		margin: 0.85rem 0;
		overflow-x: auto;
		overflow-y: hidden;
	}

	:global(.markdown-content .code-block) {
		margin: 0.85rem 0;
		overflow: hidden;
		border: 1px solid var(--markdown-code-border, #273449);
		border-radius: 0.75rem;
		background: var(--markdown-code-bg, #0f172a);
		box-shadow: 0 16px 30px -28px rgba(15, 23, 42, 0.25);
	}

	:global(.markdown-content .code-block__header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0.75rem;
		border-bottom: 1px solid var(--markdown-code-border, #273449);
		background: var(--markdown-code-header-bg, #162033);
		font-size: 0.7rem;
		letter-spacing: 0.01em;
		text-transform: lowercase;
	}

	:global(.markdown-content .code-block__lang) {
		font-weight: 600;
		color: var(--markdown-code-muted, #94a3b8);
	}

	:global(.markdown-content .code-block__copy) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--markdown-code-muted, #94a3b8);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease,
			border-color 0.15s ease;
	}

	:global(.markdown-content .code-block__copy:hover) {
		color: var(--markdown-code-text, #e2e8f0);
		border-color: var(--markdown-code-border, #273449);
		background: color-mix(in srgb, var(--markdown-code-border, #273449) 55%, transparent);
	}

	:global(.markdown-content .code-block__copy-icon) {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
	}

	:global(.markdown-content .code-block__copy[data-copy-state='copied']) {
		color: var(--markdown-code-string, #34d399);
	}

	:global(.markdown-content .code-block__copy[data-copy-state='error']) {
		color: #ef4444;
	}

	:global(.markdown-content .code-block pre) {
		margin: 0;
		padding: 0.85rem 0.9rem 0.95rem;
		overflow-x: auto;
		background: transparent;
	}

	:global(.markdown-content .code-block pre code) {
		display: block;
		padding: 0;
		color: var(--markdown-code-text, #e2e8f0);
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85rem;
	}

	:global(.markdown-content .hljs-comment),
	:global(.markdown-content .hljs-quote) {
		color: var(--markdown-code-muted, #94a3b8);
		font-style: italic;
	}

	:global(.markdown-content .hljs-keyword),
	:global(.markdown-content .hljs-selector-tag),
	:global(.markdown-content .hljs-literal) {
		color: var(--markdown-code-keyword, #c084fc);
		font-weight: 600;
	}

	:global(.markdown-content .hljs-string),
	:global(.markdown-content .hljs-symbol),
	:global(.markdown-content .hljs-template-tag) {
		color: var(--markdown-code-string, #34d399);
	}

	:global(.markdown-content .hljs-number),
	:global(.markdown-content .hljs-regexp),
	:global(.markdown-content .hljs-attr) {
		color: var(--markdown-code-number, #fbbf24);
	}

	:global(.markdown-content .hljs-title),
	:global(.markdown-content .hljs-function) {
		color: var(--markdown-code-function, #60a5fa);
	}

	:global(.markdown-content .hljs-type),
	:global(.markdown-content .hljs-built_in),
	:global(.markdown-content .hljs-class) {
		color: var(--markdown-code-type, #f472b6);
	}
</style>
