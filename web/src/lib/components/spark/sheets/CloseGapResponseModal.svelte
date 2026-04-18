<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { ChatComposer } from '$lib/components/chat/index.js';
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import {
		SPARK_ATTACHMENT_FILE_INPUT_ACCEPT,
		SPARK_ATTACHMENT_UNSUPPORTED_MESSAGE,
		isSparkSupportedClientFile,
		resolveSparkAttachmentBadge
	} from '$lib/spark/attachments';
	import type { PaperSheetFeedbackAttachment } from '@spark/schemas';

	type CloseGapMessage = {
		id: string;
		author: 'assistant' | 'student';
		markdown: string;
		attachments?: PaperSheetFeedbackAttachment[];
	};

	type RuntimeStatus = 'connecting' | 'thinking' | 'responding' | null;

	let {
		questionLabel,
		questionPrompt,
		studentAnswer,
		reviewNote,
		messages = [],
		draft = $bindable(''),
		placeholder = 'Write your response here',
		runtimeStatus = null,
		thinkingText = null,
		assistantDraftText = null,
		sending = false,
		resolved = false,
		onClose,
		onSubmit
	}: {
		questionLabel: string;
		questionPrompt: string;
		studentAnswer: string;
		reviewNote: string;
		messages?: CloseGapMessage[];
		draft?: string;
		placeholder?: string;
		runtimeStatus?: RuntimeStatus;
		thinkingText?: string | null;
		assistantDraftText?: string | null;
		sending?: boolean;
		resolved?: boolean;
		onClose: () => void;
		onSubmit: (value: string, files: File[]) => boolean | void | Promise<boolean | void>;
	} = $props();

	let attachmentInputElement = $state<HTMLInputElement | null>(null);
	let messagesElement = $state<HTMLDivElement | null>(null);
	let selectedFiles = $state<File[]>([]);
	let attachmentError = $state<string | null>(null);
	let lastScrolledStudentMessageId = $state<string | null>(null);
	let scheduledScrollTimeouts: number[] = [];

	const isRuntimeLocked = $derived(sending || runtimeStatus !== null);
	const canSend = $derived(!isRuntimeLocked && !resolved && (draft.trim().length > 0 || selectedFiles.length > 0));
	const latestStudentMessageId = $derived.by(() => {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message?.author === 'student') {
				return message.id;
			}
		}
		return null;
	});
	const shouldUseThreadPadding = $derived(latestStudentMessageId !== null);
	const statusLabel = $derived.by(() => {
		if (runtimeStatus === 'responding') {
			return assistantDraftText ? null : 'Responding...';
		}
		if (runtimeStatus === 'thinking') {
			return 'Thinking...';
		}
		if (runtimeStatus === 'connecting') {
			return 'Starting review...';
		}
		return null;
	});

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}

	function handleResize(): void {
		lastScrolledStudentMessageId = null;
		scheduleScrollToLatestStudentMessage();
	}

	function openAttachmentPicker(): void {
		attachmentInputElement?.click();
	}

	function removeSelectedFile(file: File): void {
		selectedFiles = selectedFiles.filter((selectedFile) => selectedFile !== file);
	}

	function handleAttachmentChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		attachmentError = null;
		const files = Array.from(input.files ?? []);
		const supportedFiles: File[] = [];
		for (const file of files) {
			if (!isSparkSupportedClientFile(file)) {
				attachmentError = SPARK_ATTACHMENT_UNSUPPORTED_MESSAGE;
				continue;
			}
			supportedFiles.push(file);
		}
		if (supportedFiles.length > 0) {
			selectedFiles = [...selectedFiles, ...supportedFiles];
		}
		input.value = '';
	}

	function scrollMessageToThreadTop(messageId: string): boolean {
		if (!messagesElement) {
			return false;
		}
		const nodes = messagesElement.querySelectorAll<HTMLElement>('[data-message-id]');
		let target: HTMLElement | null = null;
		for (const node of nodes) {
			if (node.dataset.messageId === messageId) {
				target = node;
				break;
			}
		}
		if (!target) {
			return false;
		}
		const offset =
			target.getBoundingClientRect().top -
			messagesElement.getBoundingClientRect().top +
			messagesElement.scrollTop -
			16;
		messagesElement.scrollTo({
			top: Math.max(0, offset),
			behavior: 'auto'
		});
		return true;
	}

	function findLatestStudentMessageId(): string | null {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message?.author === 'student') {
				return message.id;
			}
		}
		return null;
	}

	function clearScheduledScrolls(): void {
		for (const timeout of scheduledScrollTimeouts) {
			window.clearTimeout(timeout);
		}
		scheduledScrollTimeouts = [];
	}

	function scheduleScrollToLatestStudentMessage(): void {
		if (!browser) {
			return;
		}
		clearScheduledScrolls();
		for (const delay of [0, 80, 240, 600, 1200, 1800]) {
			const timeout = window.setTimeout(() => {
				const messageId = findLatestStudentMessageId();
				if (!messageId) {
					return;
				}
				if (scrollMessageToThreadTop(messageId)) {
					lastScrolledStudentMessageId = messageId;
				}
			}, delay);
			scheduledScrollTimeouts.push(timeout);
		}
	}

	function submitDraft(): void {
		const trimmed = draft.trim();
		if (!canSend || (trimmed.length === 0 && selectedFiles.length === 0)) {
			return;
		}
		const files = selectedFiles;
		void (async () => {
			const result = await onSubmit(trimmed, files);
			scheduleScrollToLatestStudentMessage();
			if (result !== false) {
				selectedFiles = [];
			}
		})();
	}

	onMount(() => {
		scheduleScrollToLatestStudentMessage();
		return () => {
			clearScheduledScrolls();
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		document.body.classList.add('close-gap-response-modal-is-open');
		return () => {
			document.body.classList.remove('close-gap-response-modal-is-open');
		};
	});

	$effect(() => {
		const messageCount = messages.length;
		const container = messagesElement;
		const messageId = (() => {
			for (let index = messageCount - 1; index >= 0; index -= 1) {
				const message = messages[index];
				if (message?.author === 'student') {
					return message.id;
				}
			}
			return null;
		})();
		if (!browser || !container || !messageId || messageId === lastScrolledStudentMessageId) {
			return;
		}
		const timeout = window.setTimeout(() => {
			requestAnimationFrame(() => {
				if (scrollMessageToThreadTop(messageId)) {
					lastScrolledStudentMessageId = messageId;
				}
			});
		}, 40);
		return () => {
			window.clearTimeout(timeout);
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} onresize={handleResize} />

<div class="close-gap-response-modal" role="presentation" onclick={handleBackdropClick}>
	<div
		class="close-gap-response-modal__dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="close-gap-response-title"
	>
		<header class="close-gap-response-modal__header">
			<div>
				<p>{questionLabel}</p>
				<h2 id="close-gap-response-title">Close the gap</h2>
				<span>Work through this problem before changing your final answer.</span>
			</div>
			<button type="button" class="close-gap-response-modal__close" aria-label="Close response" onclick={onClose}>
				<XIcon size={20} />
			</button>
		</header>

		<div class="close-gap-response-modal__body">
			<aside class="close-gap-response-modal__context" aria-label="Problem context">
				<section>
					<h3>Problem</h3>
					<MarkdownContent markdown={questionPrompt} class="close-gap-response-modal__markdown" />
				</section>
				<section>
					<h3>Your answer</h3>
					<MarkdownContent markdown={studentAnswer} class="close-gap-response-modal__markdown" />
				</section>
			</aside>

			<section class="close-gap-response-modal__chat" aria-label="Response chat">
				<div class={`agent-thread ${shouldUseThreadPadding ? 'has-thread-padding' : ''}`} bind:this={messagesElement}>
					<div class={`agent-messages ${shouldUseThreadPadding ? 'has-thread-padding' : ''}`}>
						<div class="agent-message is-agent" data-message-id="review-note">
							<span class="sr-only">Spark review note</span>
							<div class="message-bubble">
								<p class="message-kicker">Review note</p>
								<MarkdownContent markdown={reviewNote} class="message-markdown markdown" />
							</div>
						</div>

						{#each messages as message (message.id)}
							<div
								class={`agent-message ${message.author === 'student' ? 'is-user' : 'is-agent'}`}
								data-message-id={message.id}
							>
								<span class="sr-only">{message.author === 'student' ? 'You' : 'Spark tutor'}</span>
								{#if message.attachments && message.attachments.length > 0}
									<div
										class={`message-attachments ${message.author === 'student' ? 'is-user' : 'is-agent'}`}
										aria-label="Attachments"
									>
										{#each message.attachments as attachment (attachment.id)}
											<div class="message-attachment is-file">
												<div class="message-attachment__doc">
													<span class="message-attachment__icon">
														{resolveSparkAttachmentBadge({
															filename: attachment.filename,
															contentType: attachment.contentType
														})}
													</span>
													<span class="message-attachment__name">{attachment.filename}</span>
												</div>
											</div>
										{/each}
									</div>
								{/if}
								{#if message.markdown.trim().length > 0}
									<div class="message-bubble">
										{#if message.author === 'assistant'}
											<MarkdownContent markdown={message.markdown} class="message-markdown markdown" />
										{:else}
											<p class="message-plain">{message.markdown}</p>
										{/if}
									</div>
								{/if}
							</div>
						{/each}

						{#if thinkingText}
							<div class="agent-message is-agent" data-message-id="thinking">
								<span class="sr-only">Spark tutor thinking</span>
								<div class="message-bubble">
									<div class="message-thinking">
										<p class="message-thinking__label">Thinking...</p>
										<MarkdownContent
											markdown={thinkingText}
											class="message-thinking__body message-markdown markdown"
										/>
									</div>
								</div>
							</div>
						{/if}

						{#if assistantDraftText}
							<div class="agent-message is-agent" data-message-id="assistant-draft">
								<span class="sr-only">Spark tutor response</span>
								<div class="message-bubble">
									<MarkdownContent markdown={assistantDraftText} class="message-markdown markdown" />
								</div>
							</div>
						{:else if statusLabel}
							<div class="agent-message is-agent" data-message-id="runtime-status">
								<span class="sr-only">Spark tutor status</span>
								<div class="message-bubble">
									<p class="message-placeholder message-status">
										<span class="message-status__spinner" aria-hidden="true"></span>
										{statusLabel}
									</p>
								</div>
							</div>
						{/if}
					</div>
				</div>

				<div class="close-gap-response-modal__composer">
					{#if resolved}
						<p class="close-gap-response-modal__resolved">This gap is closed.</p>
					{:else}
						<input
							bind:this={attachmentInputElement}
							class="close-gap-response-modal__file-input"
							type="file"
							multiple
							accept={SPARK_ATTACHMENT_FILE_INPUT_ACCEPT}
							onchange={handleAttachmentChange}
						/>
						{#if selectedFiles.length > 0}
							<div class="composer-attachments" role="list" aria-label="Selected files">
								{#each selectedFiles as file (file.name + file.size.toString() + file.lastModified.toString())}
									<div class="attachment-card-wrap">
										<div class="attachment-card is-file" role="listitem">
											<div class="attachment-doc">
												<span class="attachment-doc__icon">
													{resolveSparkAttachmentBadge({ filename: file.name, contentType: file.type })}
												</span>
												<span class="attachment-doc__name">{file.name}</span>
											</div>
											<button type="button" class="attachment-remove" aria-label={`Remove ${file.name}`} onclick={() => removeSelectedFile(file)}>
												<span class="attachment-remove__glyph" aria-hidden="true">×</span>
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
						{#if attachmentError}
							<div class="composer-attachment-error" role="status">
								{attachmentError}
							</div>
						{/if}
						<ChatComposer
							bind:value={draft}
							{placeholder}
							ariaLabel="Reply about this problem"
							sendAriaLabel="Send response"
							maxLines={10}
							maxChars={4000}
							disabled={isRuntimeLocked}
							submitMode="enter"
							showAttach={true}
							submitReady={canSend}
							showSubmitSpinner={isRuntimeLocked}
							compactSubmitSpinner={isRuntimeLocked}
							onAttachSelect={openAttachmentPicker}
							onSubmit={() => {
								submitDraft();
							}}
						/>
					{/if}
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	.close-gap-response-modal {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: grid;
		place-items: center;
		padding: 4rem 1.25rem;
		background: color-mix(in srgb, var(--background) 34%, rgba(15, 23, 42, 0.68));
		backdrop-filter: blur(16px);
		color: var(--foreground);
		--chat-surface: color-mix(in srgb, var(--card) 82%, transparent);
		--chat-border: color-mix(in srgb, var(--border) 75%, transparent);
		--chat-user-bg: color-mix(in srgb, var(--card) 70%, color-mix(in srgb, var(--foreground) 6%, transparent));
		--chat-user-border: color-mix(in srgb, var(--border) 70%, transparent);
		--chat-send-bg: var(--foreground);
		--chat-send-fg: var(--background);
	}

	.close-gap-response-modal__dialog {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		width: min(78rem, 100%);
		height: calc(100dvh - 8rem);
		max-height: calc(100dvh - 8rem);
		min-height: min(42rem, calc(100dvh - 2rem));
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 1.5rem;
		background: var(--background);
		box-shadow: 0 28px 80px -44px rgba(0, 0, 0, 0.7);
	}

	.close-gap-response-modal__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--border);
		padding: 1rem 1.15rem;
		background: color-mix(in srgb, var(--muted) 54%, var(--background));
	}

	.close-gap-response-modal__header p,
	.close-gap-response-modal__header h2,
	.close-gap-response-modal__header span {
		margin: 0;
	}

	.close-gap-response-modal__header p {
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--muted-foreground);
	}

	.close-gap-response-modal__header h2 {
		margin-top: 0.16rem;
		font-size: 1.35rem;
		line-height: 1.15;
		font-weight: 820;
	}

	.close-gap-response-modal__header span {
		display: block;
		margin-top: 0.3rem;
		color: var(--muted-foreground);
		font-size: 0.94rem;
		line-height: 1.35;
	}

	.close-gap-response-modal__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 2.2rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--background);
		color: var(--foreground);
		cursor: pointer;
	}

	.close-gap-response-modal__body {
		display: grid;
		grid-template-columns: minmax(18rem, 0.78fr) minmax(0, 1fr);
		gap: 1rem;
		min-height: 0;
		padding: 1rem;
		background: var(--background);
	}

	.close-gap-response-modal__context,
	.close-gap-response-modal__chat {
		min-width: 0;
		min-height: 0;
		border: 1px solid var(--border);
		border-radius: 1.5rem;
		background: var(--card);
	}

	.close-gap-response-modal__context {
		overflow: auto;
		padding: 1rem;
	}

	.close-gap-response-modal__context section + section {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.close-gap-response-modal__context h3,
	.close-gap-message__label {
		margin: 0 0 0.45rem;
		font-size: 0.72rem;
		font-weight: 820;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}

	.close-gap-response-modal__markdown {
		font-size: 0.96rem;
		line-height: 1.6;
	}

	.close-gap-response-modal__chat {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		overflow: hidden;
	}

	.agent-thread {
		min-height: 0;
		overflow-y: auto;
		padding: 1rem 1rem 1.15rem;
	}

	.agent-thread.has-thread-padding {
		min-height: calc(100dvh - 8rem - 10rem);
	}

	.agent-messages {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
	}

	.agent-messages.has-thread-padding > .agent-message.is-agent:last-child .message-bubble {
		min-height: max(12rem, calc(100dvh - 8rem - 16rem));
	}

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
		color: var(--foreground);
	}

	.agent-message.is-user .message-bubble {
		padding: 0.65rem 1rem;
		border: 1px solid var(--chat-user-border);
		border-radius: 1.5rem 1.5rem 0.5rem 1.5rem;
		background: var(--chat-user-bg);
		width: auto;
		max-width: min(46rem, 100%);
		text-align: left;
		box-shadow: 0 10px 30px -26px rgba(15, 23, 42, 0.3);
	}

	.message-kicker,
	.message-thinking__label {
		margin: 0 0 0.45rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}

	.message-plain {
		margin: 0;
		white-space: pre-wrap;
	}

	.message-markdown {
		font-size: 0.98rem;
		line-height: 1.65;
	}

	:global(.message-markdown > * + *) {
		margin-top: 0.75rem;
	}

	:global(.message-markdown p) {
		margin: 0;
	}

	.message-thinking {
		border: 1px solid color-mix(in srgb, var(--chat-border) 70%, transparent);
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--chat-surface) 70%, transparent);
		padding: 0.6rem 0.75rem;
	}

	.message-thinking__body {
		margin-top: 0.35rem;
		max-height: 6.5rem;
		overflow: hidden;
		color: var(--muted-foreground);
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.message-placeholder {
		margin: 0;
		opacity: 0.7;
	}

	.message-status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.message-status__spinner {
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--chat-border) 75%, transparent);
		border-top-color: color-mix(in srgb, var(--foreground) 55%, transparent);
		animation: message-status-spin 1s linear infinite;
	}

	@keyframes message-status-spin {
		to {
			transform: rotate(360deg);
		}
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
		display: flex;
		align-items: center;
		justify-content: center;
		width: 110px;
		height: 140px;
		overflow: hidden;
		border: 1px solid var(--chat-border);
		border-radius: 1rem;
		background: var(--chat-surface);
		padding: 0.4rem;
	}

	.message-attachment__doc {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-align: center;
		font-size: 0.75rem;
	}

	.message-attachment__icon {
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		color: var(--foreground);
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.25rem 0.5rem;
	}

	.message-attachment__name {
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted-foreground);
	}

	.close-gap-response-modal__composer {
		border-top: 1px solid var(--border);
		padding: 0.75rem;
		background: color-mix(in srgb, var(--muted) 34%, var(--card));
		--chat-composer-surface: var(--chat-surface);
		--chat-composer-border: var(--chat-border);
		--chat-composer-radius: 1.75rem;
		--chat-composer-font-size: 1rem;
		--chat-composer-send-bg: var(--chat-send-bg);
		--chat-composer-send-fg: var(--chat-send-fg);
		--chat-composer-button-size: 2.25rem;
	}

	.close-gap-response-modal__file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.composer-attachments {
		display: flex;
		gap: 0.6rem;
		overflow-x: auto;
		padding: 0.2rem 0.1rem 0.4rem;
		scrollbar-width: thin;
	}

	.attachment-card-wrap {
		display: inline-flex;
		flex: 0 0 auto;
	}

	.attachment-card {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 96px;
		overflow: hidden;
		border: 1px solid var(--chat-border);
		border-radius: 0.9rem;
		background: var(--chat-surface);
		padding: 0.35rem;
	}

	.attachment-doc {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		text-align: center;
		color: var(--muted-foreground);
		font-size: 0.65rem;
	}

	.attachment-doc__icon {
		border-radius: 0.4rem;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		color: var(--foreground);
		font-size: 0.6rem;
		font-weight: 700;
		padding: 0.2rem 0.4rem;
	}

	.attachment-doc__name {
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attachment-remove {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		display: grid;
		place-items: center;
		width: 1.35rem;
		height: 1.35rem;
		border: none;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 16%, transparent);
		color: var(--foreground);
		cursor: pointer;
	}

	.attachment-remove__glyph {
		display: block;
		font-size: 0.95rem;
		line-height: 1;
		transform: translateY(-0.5px);
	}

	.composer-attachment-error {
		margin-bottom: 0.55rem;
		border: 1px solid rgba(239, 68, 68, 0.28);
		border-radius: 0.75rem;
		background: rgba(239, 68, 68, 0.08);
		color: rgba(185, 28, 28, 0.9);
		font-size: 0.85rem;
		padding: 0.5rem 0.75rem;
	}

	.close-gap-response-modal__resolved {
		margin: 0;
		color: var(--muted-foreground);
		font-weight: 700;
	}

	:global(body.close-gap-response-modal-is-open) {
		overflow: hidden;
	}

	@keyframes close-gap-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 820px) {
		.close-gap-response-modal {
			padding: 0;
		}

		.close-gap-response-modal__dialog {
			width: 100%;
			height: 100dvh;
			max-height: 100dvh;
			min-height: 100dvh;
			border: 0;
			border-radius: 0;
		}

		.close-gap-response-modal__body {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
			gap: 0.75rem;
			overflow: hidden;
			padding: 0.75rem;
		}

		.close-gap-response-modal__context {
			max-height: min(16rem, 28dvh);
			min-height: 0;
			overflow: auto;
		}

		.close-gap-response-modal__chat {
			min-height: 0;
		}

		.agent-thread.has-thread-padding {
			min-height: 0;
		}

		.agent-messages.has-thread-padding > .agent-message.is-agent:last-child .message-bubble {
			min-height: max(16rem, calc(100dvh - 18rem));
		}
	}
</style>
