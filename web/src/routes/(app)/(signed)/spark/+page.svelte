<script lang="ts">
	import { browser } from '$app/environment';
	import { getContext, onMount } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import { getFirestore, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Mic from '@lucide/svelte/icons/mic';
	import Plus from '@lucide/svelte/icons/plus';
	import type { PageData } from './$types';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { ChatInput } from '$lib/components/chat/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { streamSse } from '$lib/client/sse';
	import {
		SparkAgentConversationSchema,
		type SparkAgentConversation,
		type SparkAgentMessage
	} from '@spark/schemas';

	type ClientUser = NonNullable<PageData['user']> | null;

	let { data }: { data: PageData } = $props();

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);

	let conversationId = $state<string | null>(null);
	let conversation = $state<SparkAgentConversation | null>(null);
	let draft = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let streamingByMessageId = $state<Record<string, string>>({});
	let authReady = $state(false);
	let composerExpanded = $state(false);
	let composerRef = $state<HTMLDivElement | null>(null);
	let streamAbort = $state<AbortController | null>(null);
	let pendingScrollText = $state<string | null>(null);
	let lastScrollMessageId = $state<string | null>(null);

	const isComposerExpanded = $derived(composerExpanded);

	function resolveConversationStorageKey(uid: string): string {
		return `spark:agent:conversation:${uid}`;
	}

	function createConversationId(): string {
		if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
			return crypto.randomUUID();
		}
		return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function extractTextParts(message: SparkAgentMessage): string {
		const chunks: string[] = [];
		for (const part of message.content) {
			if (part.type === 'text') {
				chunks.push(part.text);
			}
		}
		return chunks.join('\n').trim();
	}

	function resolveMessageText(message: SparkAgentMessage): string {
		const base = extractTextParts(message);
		const streaming = streamingByMessageId[message.id];
		if (streaming && streaming.length >= base.length) {
			return streaming;
		}
		return base;
	}

	function reconcileStreaming(nextConversation: SparkAgentConversation): void {
		const next: Record<string, string> = {};
		const messageMap = new Map<string, SparkAgentMessage>();
		for (const message of nextConversation.messages) {
			messageMap.set(message.id, message);
		}
		for (const [id, value] of Object.entries(streamingByMessageId)) {
			const message = messageMap.get(id);
			if (!message) {
				continue;
			}
			const text = extractTextParts(message);
			if (text.length < value.length) {
				next[id] = value;
			}
		}
		streamingByMessageId = next;
	}

	const messages = $derived(conversation?.messages ?? []);

	function setConversationId(nextId: string | null): void {
		conversationId = nextId;
		if (!browser) {
			return;
		}
		if (!userId) {
			return;
		}
		const key = resolveConversationStorageKey(userId);
		if (!nextId) {
			window.localStorage.removeItem(key);
			return;
		}
		window.localStorage.setItem(key, nextId);
	}

	function resetConversation(): void {
		setConversationId(null);
		conversation = null;
		streamingByMessageId = {};
		error = null;
		draft = '';
		pendingScrollText = null;
		lastScrollMessageId = null;
	}

	async function sendMessage(): Promise<void> {
		const trimmed = draft.trim();
		if (!trimmed || sending) {
			return;
		}
		if (!userId) {
			error = 'Unable to send right now. Please refresh and try again.';
			return;
		}

		sending = true;
		error = null;
		pendingScrollText = trimmed;
		draft = '';

		let nextConversationId = conversationId;
		if (!nextConversationId) {
			nextConversationId = createConversationId();
			setConversationId(nextConversationId);
		}

		const abortController = new AbortController();
		streamAbort = abortController;
		let activeAssistantId: string | null = null;

		try {
			await streamSse(
				'/api/spark/agent/messages',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					signal: abortController.signal,
					body: JSON.stringify({
						conversationId: nextConversationId,
						text: trimmed
					})
				},
				{
					onEvent: (event) => {
						if (event.event === 'meta') {
							try {
								const payload = JSON.parse(event.data) as {
									conversationId: string;
									assistantMessageId?: string;
								};
								if (payload.conversationId) {
									setConversationId(payload.conversationId);
								}
								if (payload.assistantMessageId) {
									activeAssistantId = payload.assistantMessageId;
									streamingByMessageId = {
										...streamingByMessageId,
										[payload.assistantMessageId]: ''
									};
								}
							} catch {
								// ignore
							}
							return;
						}
						if (event.event === 'text') {
							if (!activeAssistantId) {
								return;
							}
							const existing = streamingByMessageId[activeAssistantId] ?? '';
							const nextText = `${existing}${event.data}`;
							streamingByMessageId = {
								...streamingByMessageId,
								[activeAssistantId]: nextText
							};
							return;
						}
						if (event.event === 'error') {
							try {
								const payload = JSON.parse(event.data) as { message?: string };
								error = payload.message ?? 'Spark AI Agent ran into a problem.';
							} catch {
								error = 'Spark AI Agent ran into a problem.';
							}
							return;
						}
						if (event.event === 'done') {
							return;
						}
					},
					onOpen: () => {
						// no-op
					}
				}
			);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				// stream stopped by user
			} else {
				console.error('Spark AI Agent request failed', err);
				error = err instanceof Error ? err.message : 'Unable to reach Spark AI Agent.';
			}
		} finally {
			sending = false;
			streamAbort = null;
			composerExpanded = false;
		}
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		const auth = getAuth(getFirebaseApp());
		if (auth.currentUser) {
			authReady = true;
		} else {
			const stopAuth = onIdTokenChanged(auth, (firebaseUser) => {
				if (!firebaseUser) {
					return;
				}
				authReady = true;
				stopAuth();
			});
		}
		if (!userId) {
			return;
		}
		const stored = window.localStorage.getItem(resolveConversationStorageKey(userId));
		if (stored && stored.trim().length > 0) {
			conversationId = stored.trim();
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !conversationId || !authReady) {
			conversation = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const ref = doc(db, userId, 'client', 'conversations', conversationId);
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			ref,
			(snap) => {
				if (!snap.exists()) {
					conversation = null;
					return;
				}
				const parsed = SparkAgentConversationSchema.safeParse(snap.data());
				if (!parsed.success) {
					console.warn('Invalid Spark AI Agent conversation payload', parsed.error.flatten());
					return;
				}
				conversation = parsed.data;
				reconcileStreaming(parsed.data);
			},
			(snapError) => {
				console.warn('Firestore subscription failed', snapError);
				error = 'Spark AI Agent could not load this conversation right now.';
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		if (!draft) {
			composerExpanded = false;
		}
	});

	$effect(() => {
		if (!browser || !composerRef) {
			return;
		}
		const shell = composerRef.closest('.agent-shell') as HTMLElement | null;
		const target = shell ?? document.documentElement;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const height = entry ? entry.contentRect.height : 0;
			target.style.setProperty('--spark-composer-offset', `${height + 16}px`);
		});
		observer.observe(composerRef);
		return () => {
			observer.disconnect();
			target.style.removeProperty('--spark-composer-offset');
		};
	});

	$effect(() => {
		if (!browser || !conversation || !pendingScrollText) {
			return;
		}
		const messages = conversation.messages;
		let target: SparkAgentMessage | null = null;
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const message = messages[i];
			if (message.role !== 'user') {
				continue;
			}
			if (extractTextParts(message).trim() === pendingScrollText) {
				target = message;
				break;
			}
		}
		if (!target || target.id === lastScrollMessageId) {
			return;
		}
		lastScrollMessageId = target.id;
		pendingScrollText = null;
		requestAnimationFrame(() => {
			const node = document.querySelector(`[data-message-id="${target?.id}"]`);
			const container = document.querySelector('.app-main');
			if (!(node instanceof HTMLElement) || !(container instanceof HTMLElement)) {
				return;
			}
			const appPage = document.querySelector('.app-page');
			if (appPage instanceof HTMLElement && appPage.scrollTop !== 0) {
				appPage.scrollTop = 0;
			}
			const nodeRect = node.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const offset = nodeRect.top - containerRect.top;
			const padding = 16;
			const targetTop = container.scrollTop + offset - padding;
			container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
		});
	});
</script>

<svelte:head>
	<title>Spark AI Agent</title>
</svelte:head>

<section class="agent-shell">
	<div class="agent-layout">
		<div class="agent-toolbar">
			<Button variant="outline" size="sm" onclick={resetConversation} disabled={sending}>
				New chat
			</Button>
		</div>

		<div class="agent-stream">
			{#if error}
				<div class="agent-error" role="alert">
					{error}
				</div>
			{/if}

			{#if messages.length === 0}
				<div class="agent-empty">
					<h2>Start a new conversation</h2>
					<p>
						Spark AI Agent can map out lessons, generate practice prompts, and review your uploads.
					</p>
					<div class="agent-empty__examples">
						<span>“Plan a 3-day GCSE Biology revision sprint.”</span>
						<span>“Help me break down this algorithm into steps.”</span>
						<span>“Summarise what I should study next.”</span>
					</div>
				</div>
			{:else}
				<div class="agent-thread">
					<div class="agent-messages">
						{#each messages as message (message.id)}
							<div
								class={`agent-message ${message.role === 'user' ? 'is-user' : 'is-agent'}`}
								data-message-id={message.id}
							>
								<span class="sr-only">
									{message.role === 'user' ? 'You' : 'Spark AI Agent'}
								</span>
								<div class="message-bubble">
									{#if resolveMessageText(message)}
										<p>{resolveMessageText(message)}</p>
									{:else}
										<p class="message-placeholder">…</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="agent-composer" bind:this={composerRef}>
				<div class="composer-stack">
					<div class="composer-card">
						<div class={`composer-field ${isComposerExpanded ? 'is-expanded' : ''}`}>
							<button
								class="composer-btn composer-attach composer-leading"
								type="button"
								aria-label="Attach"
								disabled={sending}
							>
								<Plus class="composer-icon" />
							</button>
							<div class="composer-input">
								<ChatInput
									bind:value={draft}
									placeholder="Ask anything"
									ariaLabel="Message Spark AI Agent"
									maxLines={6}
									maxChars={1200}
									disabled={sending}
									variant="chat"
									inputClass="composer-textarea"
									submitMode="enter"
									onInput={({ value, isExpanded }) => {
										composerExpanded = isExpanded ?? value.includes('\n');
									}}
									onSubmit={() => void sendMessage()}
								/>
							</div>
							<div class="composer-trailing">
								<button
									class="composer-btn composer-mic"
									type="button"
									aria-label="Voice input"
									disabled={sending}
								>
									<Mic class="composer-icon" />
								</button>
								<button
									class="composer-btn composer-send"
									type="button"
									aria-label="Send message"
									onclick={() => void sendMessage()}
									disabled={sending || !draft.trim()}
								>
									<ArrowUp class="composer-icon" />
								</button>
							</div>
							<div class="composer-spacer" aria-hidden="true"></div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.agent-shell {
		width: min(780px, 92vw);
		margin: 0 auto;
		padding: clamp(1.5rem, 3vw, 2.5rem) 0 1rem;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: clamp(1.5rem, 3vw, 2.4rem);
		--spark-composer-offset: 6rem;
		--chat-surface: color-mix(in srgb, var(--app-content-bg, #ffffff) 82%, transparent);
		--chat-border: color-mix(
			in srgb,
			var(--app-content-border, rgba(148, 163, 184, 0.3)) 75%,
			transparent
		);
		--chat-user-bg: color-mix(in srgb, var(--app-content-bg, #ffffff) 70%, rgba(15, 23, 42, 0.06));
		--chat-user-border: color-mix(
			in srgb,
			var(--app-content-border, rgba(148, 163, 184, 0.35)) 70%,
			transparent
		);
		--chat-send-bg: var(--foreground);
		--chat-send-fg: var(--background);
	}

	:global(:root:not([data-theme='light']) .agent-shell),
	:global([data-theme='dark'] .agent-shell),
	:global(.dark .agent-shell) {
		--chat-surface: color-mix(in srgb, rgba(15, 23, 42, 0.92) 75%, transparent);
		--chat-border: rgba(148, 163, 184, 0.3);
		--chat-user-bg: rgba(30, 41, 59, 0.45);
		--chat-user-border: rgba(148, 163, 184, 0.3);
		--chat-send-bg: rgba(248, 250, 252, 0.92);
		--chat-send-fg: rgba(15, 23, 42, 0.92);
	}

	.agent-layout {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: clamp(1.5rem, 3vw, 2.2rem);
	}

	.agent-toolbar {
		display: flex;
		justify-content: flex-end;
	}

	.agent-stream {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: 2rem;
	}

	.agent-error {
		padding: 0.9rem 1.1rem;
		border-radius: 1rem;
		border: 1px solid rgba(239, 68, 68, 0.3);
		background: rgba(239, 68, 68, 0.08);
		color: rgba(185, 28, 28, 0.9);
		font-size: 0.9rem;
	}

	.agent-empty {
		padding: clamp(1.6rem, 3vw, 2.4rem);
		border-radius: 1.5rem;
		border: 1px dashed rgba(148, 163, 184, 0.3);
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 65%, transparent);
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		text-align: center;
	}

	.agent-empty h2 {
		margin: 0;
		font-size: 1.35rem;
	}

	.agent-empty p {
		margin: 0;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.agent-empty__examples {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.agent-empty__examples span {
		padding: 0.4rem 0.8rem;
		border-radius: 1.75rem;
		border: 1px solid var(--chat-border);
		background: var(--chat-surface);
	}

	.agent-thread {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: 1.75rem;
		padding-bottom: calc(var(--spark-composer-offset, 6rem) + env(safe-area-inset-bottom, 0px));
	}

	.agent-messages {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
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
	}

	.message-bubble {
		padding: 0;
		border-radius: 0;
		border: none;
		background: transparent;
		max-width: min(46rem, 100%);
		width: 100%;
		white-space: pre-wrap;
		line-height: 1.7;
		font-size: 1rem;
		color: var(--text-primary, var(--foreground));
	}

	.message-bubble p {
		margin: 0;
	}

	.agent-message.is-user .message-bubble {
		padding: 0.65rem 1rem;
		border-radius: 1.5rem 1.5rem 0.5rem 1.5rem;
		border: 1px solid var(--chat-user-border);
		background: var(--chat-user-bg);
		width: auto;
		max-width: min(28rem, 100%);
		box-shadow: 0 10px 30px -26px rgba(15, 23, 42, 0.3);
	}

	.message-placeholder {
		opacity: 0.6;
	}

	.agent-composer {
		position: sticky;
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		z-index: 2;
		margin-top: auto;
	}

	.composer-stack {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.composer-card {
		padding: 0.625rem;
		border-radius: 1.75rem;
		border: 1px solid var(--chat-border);
		background: var(--chat-surface);
		backdrop-filter: blur(16px);
		box-shadow:
			0 18px 45px -32px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.55);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow: clip;
		background-clip: padding-box;
	}

	.composer-card:focus-within {
		border-color: color-mix(in srgb, var(--text-secondary, rgba(30, 41, 59, 0.6)) 40%, transparent);
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--ring) 35%, transparent),
			0 18px 45px -32px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.55);
	}

	.composer-field {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas: 'leading input trailing';
		align-items: center;
		gap: 0.6rem;
	}

	.composer-input {
		grid-area: input;
		min-width: 0;
		display: flex;
		align-items: stretch;
	}

	:global(.composer-textarea) {
		padding: 0.15rem 0.2rem 0.25rem;
		width: 100%;
	}

	.composer-leading {
		grid-area: leading;
	}

	.composer-trailing {
		grid-area: trailing;
		display: flex;
		align-items: center;
		gap: 0.4rem;
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
		height: 2.25rem;
		width: 2.25rem;
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-secondary, rgba(30, 41, 59, 0.6));
		transition:
			transform 0.2s ease,
			background 0.2s ease,
			color 0.2s ease;
	}

	.composer-field.is-expanded .composer-btn {
		align-self: end;
	}

	.composer-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.composer-btn:not(.composer-send):not(:disabled):hover {
		background: rgba(148, 163, 184, 0.18);
		color: var(--text-primary, var(--foreground));
		transform: translateY(-1px);
	}

	.composer-send {
		background: var(--chat-send-bg);
		color: var(--chat-send-fg);
		box-shadow: 0 12px 30px -18px rgba(15, 23, 42, 0.35);
	}

	.composer-send:not(:disabled):hover {
		background: color-mix(in srgb, var(--chat-send-bg) 88%, transparent);
		color: var(--chat-send-fg);
		transform: translateY(-1px) scale(1.02);
	}

	.composer-send:disabled {
		background: color-mix(in srgb, var(--chat-send-bg) 60%, transparent);
		color: color-mix(in srgb, var(--chat-send-fg) 70%, transparent);
	}

	.composer-icon {
		height: 1.05rem;
		width: 1.05rem;
	}
</style>
