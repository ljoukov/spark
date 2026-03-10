<script lang="ts">
	import { browser } from '$app/environment';
	import { getContext } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import {
		SparkAgentConversationSchema,
		type SparkAgentConversation,
		type SparkAgentMessage
	} from '@spark/schemas';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import type { PageData } from './$types';

	type ClientUser = NonNullable<PageData['user']> | null;
	type ChatKind = 'general' | 'grading' | 'quiz' | 'lesson';
	type ChatFilter = 'All' | 'Chat' | 'Sheets' | 'Quiz' | 'Lesson';
	type ChatSectionKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';
	type ChatTaskState = 'pending' | 'in_progress' | 'done' | 'failed';
	type ChatTask = {
		state: ChatTaskState;
		label: string;
		score?: string | null;
	};
	type GraderRunSummary = PageData['graderRuns'][number];
	type ChatListItem = {
		id: string;
		title: string;
		preview: string;
		kind: ChatKind;
		task: ChatTask | null;
		createdAt: string | null;
		lastMessageAt: string | null;
		messageCount: number;
		attachmentCount: number;
	};
	type ConversationToolContext = {
		toolNames: Set<string>;
		lessonStarted: boolean;
		graderStarted: boolean;
	};

	const CHAT_LIST_LIMIT = 50;
	const FILTERS: ChatFilter[] = ['All', 'Chat', 'Sheets', 'Quiz', 'Lesson'];
	const SECTION_ORDER: Array<{ key: ChatSectionKey; label: string }> = [
		{ key: 'today', label: 'Today' },
		{ key: 'yesterday', label: 'Yesterday' },
		{ key: 'last7Days', label: 'Last 7 days' },
		{ key: 'last30Days', label: 'Last 30 days' },
		{ key: 'older', label: 'Older' }
	];
	const TYPE_LABEL: Record<ChatKind, ChatFilter> = {
		general: 'Chat',
		grading: 'Sheets',
		quiz: 'Quiz',
		lesson: 'Lesson'
	};

	let { data }: { data: PageData } = $props();

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);

	const graderRunByConversation = $derived.by(() => {
		const runByConversation = new Map<string, GraderRunSummary>();
		for (const run of data.graderRuns) {
			if (!runByConversation.has(run.conversationId)) {
				runByConversation.set(run.conversationId, run);
			}
		}
		return runByConversation;
	});

	let chats = $state<ChatListItem[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let filter = $state<ChatFilter>('All');
	let search = $state('');
	let selectedConversationId = $state<string | null>(null);

	function resolveConversationStorageKey(uid: string): string {
		return `spark:agent:conversation:${uid}`;
	}

	function extractFirstLine(text: string): string {
		for (const line of text.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				return trimmed;
			}
		}
		return '';
	}

	function extractMessageText(message: SparkAgentMessage): string {
		for (const part of message.content) {
			if (part.type !== 'text') {
				continue;
			}
			const firstLine = extractFirstLine(part.text);
			if (firstLine.length > 0) {
				return firstLine;
			}
		}
		return '';
	}

	function resolveConversationTitle(conversation: SparkAgentConversation): string {
		for (const message of conversation.messages) {
			if (message.role !== 'user') {
				continue;
			}
			const text = extractMessageText(message);
			if (text.length > 0) {
				return text;
			}
		}
		for (const message of conversation.messages) {
			const text = extractMessageText(message);
			if (text.length > 0) {
				return text;
			}
		}
		return 'New chat';
	}

	function resolveConversationPreview(conversation: SparkAgentConversation): string {
		for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
			const message = conversation.messages[index];
			if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
				continue;
			}
			const text = extractMessageText(message);
			if (text.length > 0) {
				return text;
			}
		}
		const attachmentCount = conversation.attachments?.length ?? 0;
		if (attachmentCount > 0) {
			return `${attachmentCount.toString()} attachment${attachmentCount === 1 ? '' : 's'}`;
		}
		return 'No preview available yet.';
	}

	function toIso(value: unknown): string | null {
		if (value instanceof Date) {
			if (Number.isNaN(value.getTime())) {
				return null;
			}
			return value.toISOString();
		}
		if (value && typeof value === 'object') {
			const record = value as { seconds?: unknown; nanoseconds?: unknown };
			if (typeof record.seconds === 'number' && typeof record.nanoseconds === 'number') {
				const millis = record.seconds * 1000 + Math.floor(record.nanoseconds / 1_000_000);
				const timestamp = new Date(millis);
				if (!Number.isNaN(timestamp.getTime())) {
					return timestamp.toISOString();
				}
			}
		}
		if (typeof value === 'string' || typeof value === 'number') {
			const timestamp = new Date(value);
			if (!Number.isNaN(timestamp.getTime())) {
				return timestamp.toISOString();
			}
		}
		return null;
	}

	function parseJsonRecord(value: string): Record<string, unknown> | null {
		try {
			const parsed = JSON.parse(value);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return null;
			}
			return parsed as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	function resolveConversationToolContext(conversation: SparkAgentConversation): ConversationToolContext {
		const toolCallNameById = new Map<string, string>();
		const toolNames = new Set<string>();
		let lessonStarted = false;
		let graderStarted = false;

		for (const message of conversation.messages) {
			for (const part of message.content) {
				if (part.type === 'tool_call') {
					toolCallNameById.set(part.toolCall.id, part.toolCall.name);
					toolNames.add(part.toolCall.name);
					continue;
				}
				if (part.type !== 'tool_result' || part.toolResult.status !== 'ok') {
					continue;
				}
				const toolName = toolCallNameById.get(part.toolResult.toolCallId);
				if (!toolName) {
					continue;
				}
				const output = parseJsonRecord(part.toolResult.outputJson);
				if (!output || output.status !== 'started') {
					continue;
				}
				if (toolName === 'create_lesson') {
					lessonStarted = true;
				}
				if (toolName === 'create_grader') {
					graderStarted = true;
				}
			}
		}

		return {
			toolNames,
			lessonStarted,
			graderStarted
		};
	}

	function resolveChatKind(
		title: string,
		preview: string,
		toolContext: ConversationToolContext,
		graderRun: GraderRunSummary | undefined
	): ChatKind {
		const haystack = `${title}\n${preview}`.toLowerCase();
		if (graderRun || toolContext.graderStarted || /\b(grade|grading|mark|grader|feedback)\b/.test(haystack)) {
			return 'grading';
		}
		if (toolContext.lessonStarted || toolContext.toolNames.has('create_lesson')) {
			if (/\bquiz\b/.test(haystack)) {
				return 'quiz';
			}
			return 'lesson';
		}
		if (/\bquiz\b/.test(haystack)) {
			return 'quiz';
		}
		if (/\blesson\b/.test(haystack)) {
			return 'lesson';
		}
		return 'general';
	}

	function resolveGraderTask(run: GraderRunSummary): ChatTask {
		if (run.status === 'done') {
			return {
				state: 'done',
				label: 'Sheet ready',
				score: run.score
			};
		}
		if (run.status === 'executing') {
			return {
				state: 'in_progress',
				label: 'Grading...'
			};
		}
		if (run.status === 'failed' || run.status === 'stopped') {
			return {
				state: 'failed',
				label: run.status === 'stopped' ? 'Sheet stopped' : 'Sheet failed'
			};
		}
		return {
			state: 'pending',
			label: 'Queued for grading'
		};
	}

	function resolveChatTask(
		kind: ChatKind,
		toolContext: ConversationToolContext,
		graderRun: GraderRunSummary | undefined
	): ChatTask | null {
		if (kind === 'grading') {
			if (graderRun) {
				return resolveGraderTask(graderRun);
			}
			if (toolContext.graderStarted) {
				return {
					state: 'pending',
					label: 'Queued for grading'
				};
			}
			return null;
		}
		if (!toolContext.lessonStarted) {
			return null;
		}
		if (kind === 'quiz') {
			return {
				state: 'in_progress',
				label: 'Generating quiz...'
			};
		}
		if (kind === 'lesson') {
			return {
				state: 'in_progress',
				label: 'Building lesson...'
			};
		}
		return null;
	}

	function parseChatListItem(documentId: string, value: unknown): ChatListItem {
		const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
		const parsed = SparkAgentConversationSchema.safeParse({ id: documentId, ...record });
		if (!parsed.success) {
			const messages = Array.isArray(record.messages) ? record.messages : [];
			const attachments = Array.isArray(record.attachments) ? record.attachments : [];
			return {
				id: documentId,
				title: 'New chat',
				preview:
					attachments.length > 0
						? `${attachments.length.toString()} attachment${attachments.length === 1 ? '' : 's'}`
						: 'No preview available yet.',
				kind: 'general',
				task: null,
				createdAt: toIso(record.createdAt),
				lastMessageAt: toIso(record.lastMessageAt),
				messageCount: messages.length,
				attachmentCount: attachments.length
			};
		}

		const title = resolveConversationTitle(parsed.data);
		const preview = resolveConversationPreview(parsed.data);
		const graderRun = graderRunByConversation.get(parsed.data.id);
		const toolContext = resolveConversationToolContext(parsed.data);
		const kind = resolveChatKind(title, preview, toolContext, graderRun);

		return {
			id: parsed.data.id,
			title,
			preview,
			kind,
			task: resolveChatTask(kind, toolContext, graderRun),
			createdAt: parsed.data.createdAt.toISOString(),
			lastMessageAt: parsed.data.lastMessageAt.toISOString(),
			messageCount: parsed.data.messages.length,
			attachmentCount: parsed.data.attachments?.length ?? 0
		};
	}

	function resolveSortInstant(chat: ChatListItem): Date | null {
		const raw = chat.lastMessageAt ?? chat.createdAt;
		if (!raw) {
			return null;
		}
		const timestamp = new Date(raw);
		if (Number.isNaN(timestamp.getTime())) {
			return null;
		}
		return timestamp;
	}

	function resolveSectionKey(chat: ChatListItem): ChatSectionKey {
		const timestamp = resolveSortInstant(chat);
		if (!timestamp) {
			return 'older';
		}

		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);
		const startOfYesterday = new Date(startOfToday);
		startOfYesterday.setDate(startOfYesterday.getDate() - 1);
		const startOfLast7Days = new Date(startOfToday);
		startOfLast7Days.setDate(startOfLast7Days.getDate() - 7);
		const startOfLast30Days = new Date(startOfToday);
		startOfLast30Days.setDate(startOfLast30Days.getDate() - 30);

		if (timestamp >= startOfToday) {
			return 'today';
		}
		if (timestamp >= startOfYesterday) {
			return 'yesterday';
		}
		if (timestamp >= startOfLast7Days) {
			return 'last7Days';
		}
		if (timestamp >= startOfLast30Days) {
			return 'last30Days';
		}
		return 'older';
	}

	function formatRelativeDate(value: string | null): string {
		if (!value) {
			return 'Unknown time';
		}
		const timestamp = new Date(value);
		if (Number.isNaN(timestamp.getTime())) {
			return value;
		}
		const diff = Date.now() - timestamp.getTime();
		const minutes = Math.floor(diff / 60_000);
		const hours = Math.floor(diff / 3_600_000);

		if (minutes < 1) {
			return 'just now';
		}
		if (minutes < 60) {
			return `${minutes.toString()}m ago`;
		}
		if (hours < 24) {
			return `${hours.toString()}h ago`;
		}
		if (hours < 48) {
			return 'Yesterday';
		}
		return timestamp.toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short'
		});
	}

	function formatChatMeta(chat: ChatListItem): string {
		const parts = [`${chat.messageCount.toString()} message${chat.messageCount === 1 ? '' : 's'}`];
		if (chat.attachmentCount > 0) {
			parts.push(
				`${chat.attachmentCount.toString()} attachment${chat.attachmentCount === 1 ? '' : 's'}`
			);
		}
		return parts.join(' · ');
	}

	function resolveChatHref(conversationId: string): string {
		const params = new URLSearchParams({ conversationId });
		return `/spark?${params.toString()}`;
	}

	const visibleChats = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		return chats.filter((chat) => {
			if (filter !== 'All' && TYPE_LABEL[chat.kind] !== filter) {
				return false;
			}
			if (needle.length === 0) {
				return true;
			}
			return (
				chat.title.toLowerCase().includes(needle) || chat.preview.toLowerCase().includes(needle)
			);
		});
	});

	const sections = $derived.by(() => {
		const grouped = new Map<ChatSectionKey, ChatListItem[]>();
		for (const section of SECTION_ORDER) {
			grouped.set(section.key, []);
		}
		for (const chat of visibleChats) {
			grouped.get(resolveSectionKey(chat))?.push(chat);
		}
		return SECTION_ORDER.map((section) => ({
			...section,
			items: grouped.get(section.key) ?? []
		})).filter((section) => section.items.length > 0);
	});

	$effect(() => {
		if (!browser || !userId) {
			selectedConversationId = null;
			return;
		}
		const stored = window.localStorage.getItem(resolveConversationStorageKey(userId));
		selectedConversationId = stored && stored.trim().length > 0 ? stored.trim() : null;
	});

	$effect(() => {
		if (!browser || !userId) {
			chats = [];
			loading = false;
			error = null;
			return;
		}

		loading = true;
		error = null;

		let stop: (() => void) | null = null;
		let cancelled = false;
		void import('firebase/firestore')
			.then(({ collection, getFirestore, limit: queryLimit, onSnapshot, orderBy, query }) => {
				if (cancelled) {
					return;
				}
				const db = getFirestore(getFirebaseApp());
				const conversationsQuery = query(
					collection(db, userId, 'client', 'conversations'),
					orderBy('lastMessageAt', 'desc'),
					queryLimit(CHAT_LIST_LIMIT)
				);
				stop = onSnapshot(
					conversationsQuery,
					(snapshot) => {
						chats = snapshot.docs.map((document) =>
							parseChatListItem(document.id, document.data())
						);
						loading = false;
					},
					(snapshotError) => {
						console.warn('Failed to load Spark chats', snapshotError);
						error = 'Spark could not load your chats right now.';
						loading = false;
					}
				);
			})
			.catch((snapshotError) => {
				if (cancelled) {
					return;
				}
				console.warn('Failed to load Spark chats', snapshotError);
				error = 'Spark could not load your chats right now.';
				loading = false;
			});

		return () => {
			cancelled = true;
			stop?.();
		};
	});
</script>

<svelte:head>
	<title>Spark · Chats</title>
</svelte:head>

<section class="chats-page">
	<div class="toolbar">
		<label class="search-field">
			<svg class="search-field__icon" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="11" cy="11" r="7"></circle>
				<path d="M20 20L16.65 16.65"></path>
			</svg>
			<input
				type="search"
				value={search}
				placeholder="Search conversations..."
				aria-label="Search conversations"
				oninput={(event) => {
					search = (event.currentTarget as HTMLInputElement).value;
				}}
			/>
		</label>

		<div class="filters" role="tablist" aria-label="Conversation types">
			{#each FILTERS as option}
				<button
					type="button"
					class="filter-pill"
					data-active={filter === option}
					onclick={() => {
						filter = option;
					}}
				>
					{option}
				</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<div class="state-card">
			<h2>Loading chats...</h2>
			<p>Pulling your latest conversation history from Firestore.</p>
		</div>
	{:else if error}
		<div class="state-card state-card--error" role="alert">
			<h2>Couldn&apos;t load chats</h2>
			<p>{error}</p>
		</div>
	{:else if visibleChats.length === 0}
		<div class="state-card">
			<h2>No chats found</h2>
			<p>Try another search or filter, or start a fresh conversation.</p>
		</div>
	{:else}
		<div class="sections">
			{#each sections as section (section.key)}
				<section class="chat-section" aria-labelledby={`chat-section-${section.key}`}>
					<header class="chat-section__header">
						<span id={`chat-section-${section.key}`}>{section.label}</span>
						<div class="chat-section__rule" aria-hidden="true"></div>
						<span>{section.items.length} chat{section.items.length === 1 ? '' : 's'}</span>
					</header>

					<div class="chat-group">
						{#each section.items as chat, index (chat.id)}
							<a
								class="chat-row"
								href={resolveChatHref(chat.id)}
								data-selected={chat.id === selectedConversationId}
								data-kind={chat.kind}
							>
								<div class="chat-row__icon" data-kind={chat.kind} aria-hidden="true">
									{#if chat.kind === 'grading'}
										<svg viewBox="0 0 24 24">
											<path d="M9 11L12 14L22 4"></path>
											<path d="M21 12V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H14"></path>
										</svg>
									{:else if chat.kind === 'quiz'}
										<svg viewBox="0 0 24 24">
											<circle cx="12" cy="12" r="9"></circle>
											<path d="M9.25 9.5C9.75 8.3 10.8 7.5 12.2 7.5C14 7.5 15.25 8.7 15.25 10.35C15.25 12.5 12.5 13 12.5 14.75"></path>
											<circle cx="12.5" cy="17.5" r="0.75" fill="currentColor" stroke="none"></circle>
										</svg>
									{:else if chat.kind === 'lesson'}
										<svg viewBox="0 0 24 24">
											<path d="M3 5.5H9C11.2091 5.5 13 7.29086 13 9.5V20C12.2 18.9 10.9 18.25 9.5 18.25H3V5.5Z"></path>
											<path d="M21 5.5H15C12.7909 5.5 11 7.29086 11 9.5V20C11.8 18.9 13.1 18.25 14.5 18.25H21V5.5Z"></path>
										</svg>
									{:else}
										<svg viewBox="0 0 24 24">
											<path d="M21 15A2 2 0 0 1 19 17H7L3 21V5A2 2 0 0 1 5 3H19A2 2 0 0 1 21 5Z"></path>
										</svg>
									{/if}
								</div>

								<div class="chat-row__body">
									<div class="chat-row__topline">
										<div class="chat-row__titlewrap">
											<h2>{chat.title}</h2>
											<span class="chat-type-pill" data-kind={chat.kind}>{TYPE_LABEL[chat.kind]}</span>
										</div>
										<span class="chat-row__date">{formatRelativeDate(chat.lastMessageAt ?? chat.createdAt)}</span>
									</div>

									<p class="chat-row__preview">{chat.preview}</p>

									{#if chat.task}
										<div class="task-pill" data-state={chat.task.state}>
											<span class="task-pill__dot" aria-hidden="true"></span>
											<span>{chat.task.label}</span>
											{#if chat.task.score}
												<span class="task-pill__score">· {chat.task.score}</span>
											{/if}
										</div>
									{/if}

									<p class="chat-row__meta">{formatChatMeta(chat)}</p>
								</div>
							</a>

							{#if index < section.items.length - 1}
								<div class="chat-row__divider" aria-hidden="true"></div>
							{/if}
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</section>

<style lang="postcss">
	.chats-page {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		width: min(46rem, 92vw);
		margin: 0 auto clamp(2.5rem, 5vw, 4rem);
		padding-top: clamp(1.8rem, 3vw, 2.75rem);
	}

	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.search-field {
		position: relative;
		display: block;
	}

	.search-field__icon {
		position: absolute;
		left: 1rem;
		top: 50%;
		width: 1rem;
		height: 1rem;
		transform: translateY(-50%);
		fill: none;
		stroke: color-mix(in srgb, var(--foreground) 36%, transparent);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.search-field input {
		width: 100%;
		padding: 0.95rem 1rem 0.95rem 2.85rem;
		border-radius: 1rem;
		border: 1.5px solid color-mix(in srgb, var(--border) 88%, transparent);
		background: color-mix(in srgb, var(--card) 78%, rgba(255, 255, 255, 0.56));
		backdrop-filter: blur(12px);
		font-size: 0.96rem;
		color: var(--foreground);
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease,
			background-color 140ms ease;
	}

	.search-field input::placeholder {
		color: color-mix(in srgb, var(--foreground) 36%, transparent);
	}

	.search-field input:focus {
		outline: none;
		border-color: color-mix(in srgb, #d97706 76%, var(--border));
		box-shadow: 0 0 0 4px rgba(217, 119, 6, 0.12);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.filter-pill {
		padding: 0.55rem 1rem;
		border-radius: 999px;
		border: 1.5px solid color-mix(in srgb, var(--border) 90%, transparent);
		background: color-mix(in srgb, var(--card) 74%, rgba(255, 255, 255, 0.46));
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
		font-size: 0.92rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background-color 120ms ease,
			color 120ms ease;
	}

	.filter-pill:hover {
		background: color-mix(in srgb, var(--card) 84%, rgba(255, 255, 255, 0.6));
	}

	.filter-pill[data-active='true'] {
		border-color: color-mix(in srgb, #d97706 70%, transparent);
		background: rgba(254, 243, 199, 0.7);
		color: color-mix(in srgb, #b45309 92%, black 6%);
		font-weight: 700;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 1.7rem;
	}

	.chat-section {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.chat-section__header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.9rem;
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--foreground) 30%, transparent);
	}

	.chat-section__rule {
		height: 1px;
		background: color-mix(in srgb, var(--border) 84%, transparent);
	}

	.chat-group,
	.state-card {
		border-radius: 1.5rem;
		border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
		background: color-mix(in srgb, var(--card) 82%, rgba(255, 255, 255, 0.56));
		backdrop-filter: blur(14px);
		overflow: hidden;
	}

	.state-card {
		padding: 1.25rem 1.35rem;
	}

	.state-card h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.state-card p {
		margin: 0.45rem 0 0;
		color: color-mix(in srgb, var(--foreground) 56%, transparent);
	}

	.state-card--error {
		border-color: color-mix(in srgb, var(--destructive) 36%, var(--border));
		background: color-mix(in srgb, var(--destructive) 8%, var(--card));
	}

	.chat-row {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		padding: 1.05rem 1.15rem;
		text-decoration: none;
		color: inherit;
		transition:
			background-color 140ms ease,
			border-color 140ms ease;
	}

	.chat-row:hover {
		background: color-mix(in srgb, var(--foreground) 2%, transparent);
	}

	.chat-row[data-selected='true'] {
		background: rgba(220, 160, 80, 0.1);
	}

	.chat-row__icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		flex-shrink: 0;
		border-radius: 1rem;
		background: var(--kind-bg);
		color: var(--kind-fg);
		margin-top: 0.1rem;
	}

	.chat-row__icon svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.chat-row__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.chat-row__topline {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.chat-row__titlewrap {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.65rem;
		min-width: 0;
	}

	.chat-row__titlewrap h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 650;
		line-height: 1.25;
		word-break: break-word;
	}

	.chat-type-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.22rem 0.65rem;
		border-radius: 999px;
		background: var(--kind-bg);
		color: var(--kind-fg);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.chat-row__date {
		flex-shrink: 0;
		font-size: 0.86rem;
		color: color-mix(in srgb, var(--foreground) 38%, transparent);
	}

	.chat-row__preview {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.45;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
		display: -webkit-box;
		-webkit-line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.task-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		width: fit-content;
		margin-top: 0.18rem;
		padding: 0.32rem 0.8rem;
		border-radius: 999px;
		background: var(--task-bg);
		color: var(--task-fg);
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.task-pill__dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--task-dot);
		flex-shrink: 0;
	}

	.task-pill[data-state='in_progress'] .task-pill__dot {
		animation: task-pulse 1.5s ease-in-out infinite;
	}

	.task-pill__score {
		opacity: 0.72;
	}

	.chat-row__meta {
		margin: 0.15rem 0 0;
		font-size: 0.84rem;
		color: color-mix(in srgb, var(--foreground) 40%, transparent);
	}

	.chat-row__divider {
		height: 1px;
		margin: 0 1.15rem;
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
	}

	.chat-row[data-kind='general'] {
		--kind-fg: #6b7280;
		--kind-bg: rgba(107, 114, 128, 0.12);
	}

	.chat-row[data-kind='grading'] {
		--kind-fg: #b45309;
		--kind-bg: rgba(245, 158, 11, 0.18);
	}

	.chat-row[data-kind='quiz'] {
		--kind-fg: #6d28d9;
		--kind-bg: rgba(109, 40, 217, 0.14);
	}

	.chat-row[data-kind='lesson'] {
		--kind-fg: #065f46;
		--kind-bg: rgba(16, 185, 129, 0.16);
	}

	.task-pill[data-state='pending'] {
		--task-fg: #92400e;
		--task-bg: rgba(245, 158, 11, 0.18);
		--task-dot: #f59e0b;
	}

	.task-pill[data-state='in_progress'] {
		--task-fg: #1e40af;
		--task-bg: rgba(59, 130, 246, 0.16);
		--task-dot: #3b82f6;
	}

	.task-pill[data-state='done'] {
		--task-fg: #065f46;
		--task-bg: rgba(16, 185, 129, 0.18);
		--task-dot: #10b981;
	}

	.task-pill[data-state='failed'] {
		--task-fg: #991b1b;
		--task-bg: rgba(239, 68, 68, 0.16);
		--task-dot: #ef4444;
	}

	@keyframes task-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	:global(:root:not([data-theme='light']) .chats-page),
	:global([data-theme='dark'] .chats-page),
	:global(.dark .chats-page) {
		.search-field input,
		.chat-group,
		.state-card {
			background: color-mix(in srgb, var(--card) 86%, rgba(15, 23, 42, 0.46));
		}

		.chat-row:hover {
			background: color-mix(in srgb, white 3%, transparent);
		}

		.chat-row[data-selected='true'] {
			background: rgba(180, 83, 9, 0.18);
		}
	}

	@media (max-width: 760px) {
		.chat-row {
			padding: 1rem;
		}

		.chat-row__topline {
			flex-direction: column;
			align-items: flex-start;
		}

		.chat-row__date {
			font-size: 0.8rem;
		}
	}
</style>
