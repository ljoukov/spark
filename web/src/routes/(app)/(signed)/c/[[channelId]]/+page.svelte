<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import {
		addDoc,
		collection,
		doc,
		getDoc,
		getFirestore,
		onSnapshot,
		orderBy,
		query,
		setDoc,
		serverTimestamp,
		Timestamp,
		type Firestore
	} from 'firebase/firestore';
	import { z } from 'zod';
	import type { PageData } from './$types';

	type UserSnapshot = {
		uid: string;
		name?: string | null;
		email?: string | null;
		photoUrl?: string | null;
	} | null;

	let { data }: { data: PageData } = $props();

	const userStore = getContext<Readable<UserSnapshot> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const fallbackUser = $derived<UserSnapshot>(data.user ?? null);
	const user = $derived(userSnapshot?.current ?? fallbackUser);

	const routeChannelId = $derived(data.channelId ?? null);
	const DEFAULT_CHANNEL_ID = 'home';
	const DEFAULT_CHANNEL_TITLE = 'New chat';
	const activeChannelId = $derived(routeChannelId ?? DEFAULT_CHANNEL_ID);

	type ChannelScope = 'private';
	type ChannelView = {
		id: string;
		title: string;
		scope: ChannelScope;
		createdAt: Date | null;
		updatedAt: Date | null;
		lastMessageAt: Date | null;
	};

	type MessageRole = 'user' | 'assistant';
	type MessageView = {
		id: string;
		text: string;
		authorId: string;
		authorName: string | null;
		createdAt: Date | null;
		role: MessageRole;
	};

	const timestampSchema = z.custom<Timestamp>((value) => value instanceof Timestamp, {
		message: 'Invalid timestamp'
	});

	const channelDocSchema = z
		.object({
			title: z.string().trim().min(1).max(80),
			scope: z.enum(['private']).default('private'),
			createdAt: timestampSchema.optional().nullable(),
			updatedAt: timestampSchema.optional().nullable(),
			lastMessageAt: timestampSchema.optional().nullable()
		})
		.passthrough();

	const messageDocSchema = z
		.object({
			text: z.string().trim().min(1).max(4000),
			authorId: z.string().trim().min(1),
			authorName: z.string().trim().min(1).nullable().optional(),
			createdAt: timestampSchema.optional().nullable(),
			role: z.enum(['user', 'assistant']).optional()
		})
		.passthrough();

	let channels = $state<ChannelView[]>([]);
	let messages = $state<MessageView[]>([]);
	let composerText = $state('');
	let isSending = $state(false);
	let isCreatingChannel = $state(false);
	let lastError = $state<string | null>(null);
	let scrollAnchor = $state<HTMLDivElement | null>(null);

	const activeChannel = $derived(
		channels.find((channel) => channel.id === activeChannelId) ?? null
	);
	const activeChannelTitle = $derived(
		activeChannel?.title ??
			(activeChannelId === DEFAULT_CHANNEL_ID ? DEFAULT_CHANNEL_TITLE : 'Chat')
	);
	const isEmpty = $derived(messages.length === 0);
	const canSend = $derived(composerText.trim().length > 0 && !isSending);

	function buildChannelItems(source: ChannelView[]): ChannelView[] {
		const items: ChannelView[] = [];
		let hasDefault = false;
		for (const channel of source) {
			if (channel.id === DEFAULT_CHANNEL_ID) {
				hasDefault = true;
			}
			items.push(channel);
		}
		if (!hasDefault) {
			items.unshift({
				id: DEFAULT_CHANNEL_ID,
				title: DEFAULT_CHANNEL_TITLE,
				scope: 'private',
				createdAt: null,
				updatedAt: null,
				lastMessageAt: null
			});
		}
		return items;
	}

	const channelItems = $derived(buildChannelItems(channels));

	function toDate(value: Timestamp | null | undefined): Date | null {
		return value ? value.toDate() : null;
	}

	function parseChannel(raw: unknown, id: string): ChannelView | null {
		const parsed = channelDocSchema.safeParse(raw);
		if (!parsed.success) {
			return null;
		}
		const data = parsed.data;
		return {
			id,
			title: data.title,
			scope: data.scope,
			createdAt: toDate(data.createdAt),
			updatedAt: toDate(data.updatedAt),
			lastMessageAt: toDate(data.lastMessageAt)
		};
	}

	function parseMessage(raw: unknown, id: string): MessageView | null {
		const parsed = messageDocSchema.safeParse(raw);
		if (!parsed.success) {
			return null;
		}
		const data = parsed.data;
		return {
			id,
			text: data.text,
			authorId: data.authorId,
			authorName: data.authorName ?? null,
			createdAt: toDate(data.createdAt),
			role: data.role ?? 'user'
		};
	}

	function displayName(currentUser: UserSnapshot): string {
		if (!currentUser) {
			return 'Spark guest';
		}
		const name = currentUser.name?.trim();
		if (name && name.length > 0) {
			return name.split(/\s+/)[0] ?? 'Spark friend';
		}
		const handle = currentUser.email?.split('@')[0]?.trim();
		if (handle && handle.length > 0) {
			return handle;
		}
		return 'Spark friend';
	}

	function channelHref(channelId: string): string {
		return channelId === DEFAULT_CHANNEL_ID ? '/c' : `/c/${channelId}`;
	}

	async function ensureChannelDocument(
		db: Firestore,
		uid: string,
		channelId: string
	): Promise<void> {
		const channelRef = doc(db, 'spark', uid, 'channels', channelId);
		const snap = await getDoc(channelRef);
		if (snap.exists()) {
			return;
		}
		await setDoc(channelRef, {
			title: channelId === DEFAULT_CHANNEL_ID ? DEFAULT_CHANNEL_TITLE : 'New chat',
			scope: 'private',
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
			lastMessageAt: null
		});
	}

	async function handleSelectChannel(channelId: string): Promise<void> {
		if (channelId === activeChannelId) {
			return;
		}
		await goto(channelHref(channelId));
	}

	async function handleNewChannel(): Promise<void> {
		if (isCreatingChannel) {
			return;
		}
		if (!user?.uid) {
			lastError = 'Sign in to start a new chat.';
			return;
		}
		isCreatingChannel = true;
		lastError = null;
		try {
			const db = getFirestore(getFirebaseApp());
			const channelsRef = collection(db, 'spark', user.uid, 'channels');
			const createdAt = serverTimestamp();
			const docRef = await addDoc(channelsRef, {
				title: 'New chat',
				scope: 'private',
				createdAt,
				updatedAt: createdAt,
				lastMessageAt: null
			});
			await goto(`/c/${docRef.id}`);
		} catch (error) {
			console.error('Failed to create chat channel', error);
			lastError = 'Unable to start a new chat. Please try again.';
		} finally {
			isCreatingChannel = false;
		}
	}

	async function handleSendMessage(): Promise<void> {
		if (!canSend) {
			return;
		}
		const trimmed = composerText.trim();
		if (!trimmed || !user?.uid) {
			return;
		}
		isSending = true;
		lastError = null;
		try {
			const db = getFirestore(getFirebaseApp());
			const channelRef = doc(db, 'spark', user.uid, 'channels', activeChannelId);
			const messagesRef = collection(channelRef, 'messages');
			await addDoc(messagesRef, {
				text: trimmed,
				authorId: user.uid,
				authorName: displayName(user),
				role: 'user',
				createdAt: serverTimestamp()
			});
			await setDoc(
				channelRef,
				{
					updatedAt: serverTimestamp(),
					lastMessageAt: serverTimestamp()
				},
				{ merge: true }
			);
			composerText = '';
		} catch (error) {
			console.error('Failed to send chat message', error);
			lastError = 'Message failed to send. Please try again.';
		} finally {
			isSending = false;
		}
	}

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void handleSendMessage();
		}
	}

	$effect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const currentUser = user;
		if (!currentUser?.uid) {
			channels = [];
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const channelsRef = collection(db, 'spark', currentUser.uid, 'channels');
		const channelsQuery = query(channelsRef, orderBy('updatedAt', 'desc'));
		const unsubscribe = onSnapshot(channelsQuery, (snapshot) => {
			const next: ChannelView[] = [];
			for (const docSnap of snapshot.docs) {
				const view = parseChannel(docSnap.data(), docSnap.id);
				if (view) {
					next.push(view);
				}
			}
			channels = next;
		});

		return () => {
			unsubscribe();
		};
	});

	$effect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const currentUser = user;
		const channelId = activeChannelId;
		if (!currentUser?.uid || !channelId) {
			messages = [];
			return;
		}
		const db = getFirestore(getFirebaseApp());
		void ensureChannelDocument(db, currentUser.uid, channelId);
		const messagesRef = collection(db, 'spark', currentUser.uid, 'channels', channelId, 'messages');
		const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
		const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
			const next: MessageView[] = [];
			for (const docSnap of snapshot.docs) {
				const view = parseMessage(docSnap.data(), docSnap.id);
				if (view) {
					next.push(view);
				}
			}
			messages = next;
		});

		return () => {
			unsubscribe();
		};
	});

	$effect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		if (messages.length === 0) {
			return;
		}
		requestAnimationFrame(() => {
			scrollAnchor?.scrollIntoView({ behavior: 'smooth', block: 'end' });
		});
	});
</script>

<svelte:head>
	<title>Spark Chat</title>
</svelte:head>

<div class="chat-shell">
	<aside class="chat-sidebar">
		<header class="chat-sidebar__header">
			<div>
				<p class="chat-sidebar__eyebrow">Spark</p>
				<h2 class="chat-sidebar__title">Chats</h2>
			</div>
			<button class="chat-sidebar__new" onclick={handleNewChannel} disabled={isCreatingChannel}>
				New chat
			</button>
		</header>
		<nav class="chat-sidebar__list" aria-label="Channels">
			{#each channelItems as channel}
				<button
					type="button"
					class={channel.id === activeChannelId
						? 'chat-channel chat-channel--active'
						: 'chat-channel'}
					onclick={() => {
						void handleSelectChannel(channel.id);
					}}
				>
					<span class="chat-channel__title">{channel.title}</span>
					<span class="chat-channel__meta">Private</span>
				</button>
			{/each}
		</nav>
		{#if lastError}
			<p class="chat-sidebar__error" role="alert">{lastError}</p>
		{/if}
	</aside>

	<section class="chat-panel">
		<header class="chat-panel__header">
			<div>
				<p class="chat-panel__eyebrow">Channel</p>
				<h1 class="chat-panel__title">{activeChannelTitle}</h1>
			</div>
			<div class="chat-panel__meta">Private</div>
		</header>

		<div class="chat-panel__body">
			{#if isEmpty}
				<div class="chat-empty">
					<div class="chat-empty__copy">
						<h2>Start a new chat</h2>
						<p>
							Ask Spark anything. This space will soon show suggested cards and your recent
							activity.
						</p>
					</div>
					<div class="chat-empty__cards">
						<a class="chat-card" href="/code">
							<span class="chat-card__title">Spark Code</span>
							<span class="chat-card__body">Continue coding lessons and practice BIO problems.</span
							>
						</a>
						<a class="chat-card" href="/spark">
							<span class="chat-card__title">Spark Quiz</span>
							<span class="chat-card__body">Turn notes into quizzes and track your progress.</span>
						</a>
					</div>
				</div>
			{:else}
				<div class="chat-messages" aria-live="polite">
					{#each messages as message}
						<article
							class={message.role === 'assistant'
								? 'chat-message chat-message--assistant'
								: 'chat-message chat-message--user'}
						>
							<header>
								<span class="chat-message__author">
									{message.role === 'assistant' ? 'Spark Assistant' : (message.authorName ?? 'You')}
								</span>
								{#if message.createdAt}
									<time class="chat-message__time"
										>{message.createdAt.toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit'
										})}</time
									>
								{/if}
							</header>
							<p class="chat-message__text">{message.text}</p>
						</article>
					{/each}
					<div bind:this={scrollAnchor}></div>
				</div>
			{/if}
		</div>

		<form
			class="chat-composer"
			onsubmit={(event) => {
				event.preventDefault();
				void handleSendMessage();
			}}
		>
			<textarea
				rows="1"
				placeholder="Ask Spark anything…"
				bind:value={composerText}
				onkeydown={handleComposerKeydown}
			></textarea>
			<button type="submit" disabled={!canSend}>Send</button>
		</form>
	</section>
</div>

<style>
	.chat-shell {
		display: grid;
		grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr);
		gap: 1.5rem;
		padding: clamp(1.5rem, 2.5vw, 2.5rem);
		min-height: 100%;
	}

	@media (max-width: 900px) {
		.chat-shell {
			grid-template-columns: 1fr;
		}
	}

	.chat-sidebar {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.25rem;
		border-radius: 1.5rem;
		background: color-mix(in srgb, var(--app-content-bg) 92%, transparent);
		border: 1px solid var(--app-content-border, rgba(255, 255, 255, 0.55));
		box-shadow: var(--app-content-shadow-secondary);
		min-height: 20rem;
	}

	.chat-sidebar__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.chat-sidebar__eyebrow {
		margin: 0;
		font-size: 0.7rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--app-subtitle-color);
		font-weight: 600;
	}

	.chat-sidebar__title {
		margin: 0.35rem 0 0;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.chat-sidebar__new {
		border-radius: 999px;
		padding: 0.45rem 0.9rem;
		border: none;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 0.2s ease,
			opacity 0.2s ease;
	}

	.chat-sidebar__new:disabled {
		cursor: not-allowed;
		opacity: 0.65;
	}

	.chat-sidebar__new:not(:disabled):hover {
		transform: translateY(-1px);
	}

	.chat-sidebar__list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.chat-channel {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		border-radius: 0.9rem;
		padding: 0.6rem 0.75rem;
		background: transparent;
		border: 1px solid transparent;
		text-align: left;
		cursor: pointer;
		transition:
			background 0.2s ease,
			border 0.2s ease;
	}

	.chat-channel--active {
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		border-color: color-mix(in srgb, var(--primary) 35%, transparent);
	}

	.chat-channel__title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--foreground);
	}

	.chat-channel__meta {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--app-subtitle-color);
	}

	.chat-sidebar__error {
		margin: 0;
		padding: 0.65rem 0.75rem;
		border-radius: 0.75rem;
		background: rgba(239, 68, 68, 0.12);
		color: rgb(190, 18, 60);
		font-size: 0.85rem;
	}

	.chat-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border-radius: 1.75rem;
		background: color-mix(in srgb, var(--app-content-bg) 94%, transparent);
		border: 1px solid var(--app-content-border, rgba(255, 255, 255, 0.55));
		box-shadow: var(--app-content-shadow-primary);
		min-height: 24rem;
	}

	.chat-panel__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--app-content-border) 80%, transparent);
		padding-bottom: 0.75rem;
	}

	.chat-panel__eyebrow {
		margin: 0;
		font-size: 0.7rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--app-subtitle-color);
		font-weight: 600;
	}

	.chat-panel__title {
		margin: 0.35rem 0 0;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.chat-panel__meta {
		font-size: 0.75rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--app-subtitle-color);
	}

	.chat-panel__body {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.chat-empty {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		justify-content: center;
		align-items: flex-start;
		padding: clamp(1rem, 3vw, 2rem);
		flex: 1 1 auto;
	}

	.chat-empty__copy h2 {
		margin: 0 0 0.6rem;
		font-size: 1.4rem;
	}

	.chat-empty__copy p {
		margin: 0;
		max-width: 28rem;
		color: var(--app-subtitle-color);
	}

	.chat-empty__cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 1rem;
		width: 100%;
	}

	.chat-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem 1.1rem;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		text-decoration: none;
		color: inherit;
		transition:
			transform 0.2s ease,
			border 0.2s ease;
	}

	.chat-card:hover {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--primary) 40%, transparent);
	}

	.chat-card__title {
		font-weight: 600;
		font-size: 1rem;
	}

	.chat-card__body {
		font-size: 0.9rem;
		color: var(--app-subtitle-color);
	}

	.chat-messages {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
		padding-right: 0.5rem;
		flex: 1 1 auto;
	}

	.chat-message {
		border-radius: 1rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--app-content-bg) 86%, transparent);
		border: 1px solid color-mix(in srgb, var(--app-content-border) 80%, transparent);
	}

	.chat-message--assistant {
		background: color-mix(in srgb, rgba(59, 130, 246, 0.15) 45%, transparent);
		border-color: color-mix(in srgb, rgba(59, 130, 246, 0.25) 70%, transparent);
	}

	.chat-message__author {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.chat-message header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.chat-message__time {
		font-size: 0.75rem;
		color: var(--app-subtitle-color);
	}

	.chat-message__text {
		margin: 0;
		white-space: pre-wrap;
	}

	.chat-composer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		align-items: end;
		padding-top: 0.5rem;
		border-top: 1px solid color-mix(in srgb, var(--app-content-border) 80%, transparent);
	}

	.chat-composer textarea {
		resize: none;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--app-content-border) 80%, transparent);
		padding: 0.75rem 0.9rem;
		font-size: 0.95rem;
		background: color-mix(in srgb, var(--app-content-bg) 88%, transparent);
		color: inherit;
		min-height: 2.75rem;
		line-height: 1.4;
	}

	.chat-composer textarea:focus {
		outline: 2px solid color-mix(in srgb, var(--primary) 60%, transparent);
		outline-offset: 2px;
	}

	.chat-composer button {
		border-radius: 999px;
		border: none;
		padding: 0.6rem 1.25rem;
		font-weight: 600;
		background: var(--primary);
		color: var(--primary-foreground);
		cursor: pointer;
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}

	.chat-composer button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.chat-composer button:not(:disabled):hover {
		transform: translateY(-1px);
	}

	@media (max-width: 700px) {
		.chat-panel {
			padding: 1.1rem;
		}

		.chat-panel__header {
			flex-direction: column;
			align-items: flex-start;
		}

		.chat-composer {
			grid-template-columns: 1fr;
		}

		.chat-composer button {
			width: 100%;
		}
	}
</style>
