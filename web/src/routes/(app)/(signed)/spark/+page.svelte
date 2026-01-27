<script lang="ts">
	import { browser } from '$app/environment';
	import { getContext, onMount } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import { getFirestore, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
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
	const displayName = $derived(
		user?.name?.trim() || user?.email?.split('@')[0]?.trim() || 'there'
	);

	let conversationId = $state<string | null>(null);
	let conversation = $state<SparkAgentConversation | null>(null);
	let draft = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let streamingByMessageId = $state<Record<string, string>>({});
	let authReady = $state(false);

	const VISIBLE_SECTION_COUNT = 4;

	type Section = {
		id: string;
		title: string;
		messages: SparkAgentMessage[];
		collapsed: boolean;
	};

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


	function shorten(text: string, limit: number): string {
		const trimmed = text.trim().replace(/\s+/gu, ' ');
		if (trimmed.length <= limit) {
			return trimmed;
		}
		return `${trimmed.slice(0, Math.max(0, limit - 1))}…`;
	}

	function resolveSectionTitle(message: SparkAgentMessage): string {
		const base = extractTextParts(message);
		if (base.length > 0) {
			return shorten(base, 52);
		}
		return message.role === 'assistant' ? 'Spark AI Agent update' : 'New message';
	}

	function buildSections(messages: SparkAgentMessage[]): Section[] {
		const output: Section[] = [];
		let current: Section | null = null;

		for (const message of messages) {
			if (!current || message.role === 'user') {
				if (current) {
					output.push(current);
				}
				current = {
					id: message.id,
					title: resolveSectionTitle(message),
					messages: [message],
					collapsed: false
				};
				continue;
			}
			current.messages = [...current.messages, message];
		}

		if (current) {
			output.push(current);
		}

		const cutoff = Math.max(0, output.length - VISIBLE_SECTION_COUNT);
		return output.map((section, index) => ({
			...section,
			collapsed: index < cutoff
		}));
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

	const sections = $derived(buildSections(conversation?.messages ?? []));
	const tocItems = $derived(
		sections.map((section, index) => ({
			id: section.id,
			title: section.title,
			index
		}))
	);

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

		let nextConversationId = conversationId;
		if (!nextConversationId) {
			nextConversationId = createConversationId();
			setConversationId(nextConversationId);
		}

		let activeAssistantId: string | null = null;

		try {
			await streamSse(
				'/api/spark/agent/messages',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
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
			console.error('Spark AI Agent request failed', err);
			error = err instanceof Error ? err.message : 'Unable to reach Spark AI Agent.';
		} finally {
			sending = false;
			draft = '';
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
</script>

<svelte:head>
	<title>Spark AI Agent</title>
</svelte:head>

<section class="agent-shell">
	<header class="agent-hero">
		<div>
			<p class="agent-eyebrow">Spark AI Agent</p>
			<h1>Hi {displayName}, ready to build your next study win?</h1>
			<p class="agent-subtitle">
				Ask Spark AI Agent to plan lessons, review work, or organise your learning tasks.
			</p>
		</div>
		<div class="agent-actions">
			<Button variant="outline" size="sm" onclick={resetConversation} disabled={sending}>
				New chat
			</Button>
		</div>
	</header>

	<div class="agent-layout">
		<div class="agent-stream">
			{#if error}
				<div class="agent-error" role="alert">
					{error}
				</div>
			{/if}

			{#if sections.length === 0}
				<div class="agent-empty">
					<h2>Start a new conversation</h2>
					<p>
						Spark AI Agent can map out lessons, generate practice prompts, and review
						your uploads.
					</p>
					<div class="agent-empty__examples">
						<span>“Plan a 3-day GCSE Biology revision sprint.”</span>
						<span>“Help me break down this algorithm into steps.”</span>
						<span>“Summarise what I should study next.”</span>
					</div>
				</div>
			{:else}
				<div class="agent-sections">
					{#each sections as section (section.id)}
						<details
							class={`agent-section ${section.collapsed ? 'is-collapsed' : 'is-open'}`}
							id={`section-${section.id}`}
							open={!section.collapsed}
						>
							<summary>
								<div class="section-summary">
									<span class="section-title">{section.title}</span>
									<span class="section-meta">{section.messages.length} message{section.messages.length === 1 ? '' : 's'}</span>
								</div>
							</summary>
							<div class="section-body">
								{#each section.messages as message (message.id)}
									<div
										class={`agent-message ${
											message.role === 'user' ? 'is-user' : 'is-agent'
										}`}
									>
										<div class="message-label">
											{message.role === 'user' ? 'You' : 'Spark AI Agent'}
										</div>
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
						</details>
					{/each}
				</div>
			{/if}

			<div class="agent-composer">
				<div class="composer-card">
					<ChatInput
						bind:value={draft}
						placeholder="Message Spark AI Agent…"
						ariaLabel="Message Spark AI Agent"
						maxLines={6}
						maxChars={1200}
						disabled={sending}
						onSubmit={() => void sendMessage()}
					/>
					<div class="composer-actions">
						<span class="composer-hint">Ctrl/Cmd + Enter to send</span>
						<Button size="lg" onclick={() => void sendMessage()} disabled={sending || !draft.trim()}>
							{sending ? 'Sending…' : 'Send'}
						</Button>
					</div>
				</div>
			</div>
		</div>

		<aside class="agent-toc">
			<div class="toc-card">
				<p class="toc-title">Sections</p>
				{#if tocItems.length === 0}
					<p class="toc-empty">Your conversation will appear here.</p>
				{:else}
					<ol>
						{#each tocItems as item}
							<li>
								<a href={`#section-${item.id}`}>{item.title}</a>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		</aside>
	</div>
</section>

<style>
	.agent-shell {
		width: min(1200px, 92vw);
		margin: 0 auto;
		padding: clamp(1.5rem, 3vw, 2.5rem) 0 clamp(2rem, 4vw, 3.5rem);
		display: flex;
		flex-direction: column;
		gap: clamp(1.5rem, 3vw, 2.4rem);
	}

	.agent-hero {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		padding: clamp(1.5rem, 3vw, 2.4rem);
		border-radius: 1.75rem;
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 80%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.25);
		box-shadow: 0 28px 80px -50px rgba(15, 23, 42, 0.4);
	}

	.agent-hero h1 {
		margin: 0;
		font-size: clamp(2rem, 3.4vw, 2.8rem);
		letter-spacing: -0.02em;
	}

	.agent-eyebrow {
		margin: 0 0 0.4rem 0;
		font-size: 0.75rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: rgba(59, 130, 246, 0.75);
		font-weight: 600;
	}

	.agent-subtitle {
		margin: 0;
		max-width: 40rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.72));
		line-height: 1.6;
	}

	.agent-actions {
		display: flex;
		gap: 0.75rem;
	}

	.agent-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: clamp(1.5rem, 3vw, 2.5rem);
	}

	.agent-stream {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-height: 0;
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
		border: 1px dashed rgba(148, 163, 184, 0.4);
		background: rgba(148, 163, 184, 0.08);
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.agent-empty h2 {
		margin: 0;
		font-size: 1.4rem;
	}

	.agent-empty p {
		margin: 0;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.agent-empty__examples {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.95rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.agent-sections {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.agent-section {
		border-radius: 1.5rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 75%, transparent);
		box-shadow: 0 18px 50px -38px rgba(15, 23, 42, 0.35);
		overflow: hidden;
	}

	.agent-section summary {
		cursor: pointer;
		list-style: none;
		padding: 1rem 1.2rem;
		background: rgba(15, 23, 42, 0.04);
	}

	.agent-section summary::-webkit-details-marker {
		display: none;
	}

	.section-summary {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.section-title {
		font-weight: 600;
		color: var(--text-primary, var(--foreground));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.section-meta {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--text-secondary, rgba(30, 41, 59, 0.6));
	}

	.section-body {
		padding: 1rem 1.2rem 1.4rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.agent-message {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.agent-message.is-user .message-bubble {
		align-self: flex-end;
		background: rgba(59, 130, 246, 0.12);
		border-color: rgba(59, 130, 246, 0.25);
	}

	.agent-message.is-agent .message-bubble {
		background: rgba(15, 23, 42, 0.04);
		border-color: rgba(148, 163, 184, 0.25);
	}

	.message-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: var(--text-secondary, rgba(30, 41, 59, 0.6));
	}

	.message-bubble {
		padding: 0.85rem 1rem;
		border-radius: 1.2rem;
		border: 1px solid transparent;
		max-width: 36rem;
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.message-bubble p {
		margin: 0;
	}

	.message-placeholder {
		opacity: 0.6;
	}

	.agent-composer {
		position: sticky;
		bottom: 1rem;
		z-index: 2;
	}

	.composer-card {
		padding: 1rem;
		border-radius: 1.5rem;
		border: 1px solid rgba(148, 163, 184, 0.3);
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 90%, transparent);
		backdrop-filter: blur(16px);
		box-shadow: 0 20px 60px -40px rgba(15, 23, 42, 0.35);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.composer-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.composer-hint {
		font-size: 0.75rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.65));
	}

	.agent-toc {
		display: none;
	}

	.toc-card {
		position: sticky;
		top: 1rem;
		padding: 1.2rem 1.3rem;
		border-radius: 1.4rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 85%, transparent);
		box-shadow: 0 20px 60px -40px rgba(15, 23, 42, 0.3);
	}

	.toc-title {
		margin: 0 0 0.75rem 0;
		font-size: 0.75rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--text-secondary, rgba(30, 41, 59, 0.65));
		font-weight: 600;
	}

	.toc-card ol {
		margin: 0;
		padding-left: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.toc-card a {
		color: inherit;
		text-decoration: none;
	}

	.toc-card a:hover {
		color: rgba(59, 130, 246, 0.9);
	}

	.toc-empty {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.65));
	}

	@media (min-width: 960px) {
		.agent-hero {
			flex-direction: row;
			align-items: center;
		}

		.agent-layout {
			grid-template-columns: minmax(0, 1fr) 260px;
		}

		.agent-toc {
			display: block;
		}
	}
</style>
