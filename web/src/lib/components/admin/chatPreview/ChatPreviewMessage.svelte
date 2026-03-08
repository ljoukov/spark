<script lang="ts">
	import TaskCard from '$lib/components/spark/chat/TaskCard.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import type { ChatPreviewMessage } from './types';

	let { message }: { message: ChatPreviewMessage } = $props();

	const messageHtml = $derived(
		message.role === 'assistant' && message.text ? renderMarkdown(message.text) : ''
	);
	const thinkingHtml = $derived(message.thinkingText ? renderMarkdown(message.thinkingText) : '');

	function resolvePlaceholderLabel(
		value: NonNullable<ChatPreviewMessage['placeholder']>
	): 'Establishing connection...' | 'Sending request...' | 'Thinking...' {
		switch (value) {
			case 'connecting':
				return 'Establishing connection...';
			case 'sending':
				return 'Sending request...';
			case 'thinking':
				return 'Thinking...';
		}
	}
</script>

<div class={`agent-message ${message.role === 'user' ? 'is-user' : 'is-agent'}`}>
	{#if message.attachments && message.attachments.length > 0}
		<div class={`message-attachments ${message.role === 'user' ? 'is-user' : 'is-agent'}`}>
			{#each message.attachments as attachment (attachment.id)}
				<div class={`message-attachment ${attachment.kind === 'image' ? 'is-image' : 'is-file'}`}>
					<div class="message-attachment__inner">
						<span class="message-attachment__icon">
							{attachment.kind === 'image' ? 'IMG' : 'PDF'}
						</span>
						<p class="message-attachment__name">{attachment.name}</p>
						<p class="message-attachment__detail">{attachment.detail}</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="message-bubble">
		{#if message.role === 'assistant' && message.runCards && message.runCards.length > 0}
			<div class="message-run-cards">
				{#each message.runCards as item, index (index)}
					<TaskCard userId="" runCard={item.runCard} preview={item.preview} />
				{/each}
			</div>
		{/if}

		{#if message.role === 'assistant' && message.thinkingText}
			<div class="message-thinking">
				<p class="message-thinking__label">Thinking...</p>
				<div class="message-thinking__body message-markdown markdown">
					{@html thinkingHtml}
				</div>
			</div>
		{/if}

		{#if message.role === 'assistant' && messageHtml}
			<div class="message-markdown markdown">
				{@html messageHtml}
			</div>
		{:else if message.role === 'assistant' && message.placeholder}
			<p class="message-placeholder message-status">
				<span class="message-status__spinner" aria-hidden="true"></span>
				{resolvePlaceholderLabel(message.placeholder)}
			</p>
		{:else if message.role === 'user' && message.text}
			<p class="message-plain">{message.text}</p>
		{/if}
	</div>
</div>

<style lang="postcss">
	.agent-message {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
		align-items: flex-start;
	}

	.agent-message.is-user {
		align-items: flex-end;
		text-align: right;
		padding-left: 1rem;
	}

	.message-bubble {
		padding: 0;
		border-radius: 0;
		border: none;
		background: transparent;
		max-width: min(46rem, 100%);
		width: 100%;
		line-height: 1.7;
		font-size: 1rem;
		color: var(--text-primary, var(--foreground));
	}

	.agent-message.is-user .message-bubble {
		padding: 0.65rem 1rem;
		border-radius: 1.5rem 1.5rem 0.5rem 1.5rem;
		border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
		background: color-mix(in srgb, var(--accent) 9%, var(--card));
		width: auto;
		max-width: min(40rem, 100%);
		text-align: left;
		box-shadow: 0 10px 30px -26px rgba(15, 23, 42, 0.3);
	}

	.message-plain {
		margin: 0;
		white-space: pre-wrap;
	}

	.message-run-cards {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 0.8rem;
	}

	.message-attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-bottom: 0.4rem;
	}

	.message-attachments.is-user {
		justify-content: flex-end;
	}

	.message-attachment {
		flex: 0 0 auto;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, white 4%), color-mix(in srgb, var(--card) 90%, transparent)),
			radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%);
		min-width: 8.75rem;
		min-height: 7rem;
		padding: 0.7rem;
		box-shadow: 0 14px 24px -26px rgba(15, 23, 42, 0.35);
	}

	.message-attachment.is-image {
		width: 13rem;
	}

	.message-attachment.is-file {
		width: 10rem;
	}

	.message-attachment__inner {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 0.35rem;
		height: 100%;
	}

	.message-attachment__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: fit-content;
		padding: 0.22rem 0.5rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
	}

	.message-attachment__name,
	.message-attachment__detail {
		margin: 0;
	}

	.message-attachment__name {
		font-size: 0.83rem;
		font-weight: 600;
	}

	.message-attachment__detail {
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.message-thinking {
		border-radius: 0.9rem;
		border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
		background: color-mix(in srgb, var(--muted) 42%, transparent);
		padding: 0.6rem 0.75rem;
		margin-bottom: 0.75rem;
	}

	.message-thinking__label {
		margin: 0;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
	}

	.message-thinking__body {
		margin-top: 0.35rem;
		font-size: 0.8rem;
		line-height: 1.45;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		max-height: 8rem;
		overflow: hidden;
	}

	.message-markdown {
		font-size: 0.98rem;
		line-height: 1.65;
	}

	.message-placeholder {
		margin: 0;
		opacity: 0.68;
	}

	.message-status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.message-status__spinner {
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 9999px;
		border: 2px solid color-mix(in srgb, var(--border) 80%, transparent);
		border-top-color: color-mix(in srgb, var(--foreground) 56%, transparent);
		animation: message-status-spin 1s linear infinite;
	}

	:global(.message-markdown > * + *) {
		margin-top: 0.75rem;
	}

	:global(.message-markdown h2),
	:global(.message-markdown h3) {
		margin-top: 1rem;
		margin-bottom: 0.4rem;
		font-size: 1.05rem;
		font-weight: 600;
	}

	:global(.message-markdown p) {
		margin: 0;
	}

	:global(.message-markdown ul),
	:global(.message-markdown ol) {
		padding-left: 1.25rem;
		margin: 0;
		list-style-position: outside;
	}

	:global(.message-markdown ul) {
		list-style-type: disc;
	}

	:global(.message-markdown ol) {
		list-style-type: decimal;
	}

	:global(.message-markdown table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.86rem;
		border-radius: 0.85rem;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
	}

	:global(.message-markdown thead) {
		background: color-mix(in srgb, var(--muted) 65%, transparent);
	}

	:global(.message-markdown th),
	:global(.message-markdown td) {
		padding: 0.55rem 0.65rem;
		text-align: left;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
	}

	:global(.message-markdown tbody tr:last-child td) {
		border-bottom: none;
	}

	:global(.message-markdown :not(pre) > code) {
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85rem;
		padding: 0.1rem 0.3rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	:global(.message-thinking__body > * + *) {
		margin-top: 0.45rem;
	}

	@keyframes message-status-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 640px) {
		.message-attachment.is-image,
		.message-attachment.is-file {
			width: 100%;
		}
	}
</style>
