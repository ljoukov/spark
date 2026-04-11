<script lang="ts">
	import { browser } from '$app/environment';
	import { getContext, onMount } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import {
		collection,
		getFirestore,
		limit as queryLimit,
		onSnapshot,
		orderBy,
		query
	} from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { SparkAgentStateSchema, type SparkAgentState } from '@spark/schemas';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';

	type ClientUser = { uid: string } | null;
	type RunFilter = 'All' | 'Running' | 'Queued' | 'Done' | 'Failed' | 'Stopped';
	type RunSectionKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';
	type RunListItem = {
		id: string;
		prompt: string;
		preview: string;
		status: SparkAgentState['status'];
		createdAt: string;
		updatedAt: string;
		workspaceId: string;
		stopRequested: boolean;
	};

	const RUN_LIST_LIMIT = 50;
	const FILTERS: RunFilter[] = ['All', 'Running', 'Queued', 'Done', 'Failed', 'Stopped'];
	const SECTION_ORDER: Array<{ key: RunSectionKey; label: string }> = [
		{ key: 'today', label: 'Today' },
		{ key: 'yesterday', label: 'Yesterday' },
		{ key: 'last7Days', label: 'Last 7 days' },
		{ key: 'last30Days', label: 'Last 30 days' },
		{ key: 'older', label: 'Older' }
	];

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? null);
	const userId = $derived(user?.uid ?? null);

	let agentRuns = $state<RunListItem[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let filter = $state<RunFilter>('All');
	let search = $state('');
	let authReady = $state(false);

	function resolveRunPreview(run: SparkAgentState): string {
		if (run.error && run.error.trim().length > 0) {
			return run.error.trim();
		}
		if (run.resultSummary && run.resultSummary.trim().length > 0) {
			return run.resultSummary.trim();
		}
		if (run.status === 'created') {
			return `Queued in workspace ${run.workspaceId}.`;
		}
		if (run.status === 'executing') {
			return `Running in workspace ${run.workspaceId}.`;
		}
		if (run.status === 'done') {
			return `Completed in workspace ${run.workspaceId}.`;
		}
		if (run.status === 'stopped') {
			return 'Stopped by user.';
		}
		return `Failed in workspace ${run.workspaceId}.`;
	}

	function parseRunListItem(documentId: string, value: unknown): RunListItem | null {
		const record = value && typeof value === 'object' ? value : {};
		const parsed = SparkAgentStateSchema.safeParse({ id: documentId, ...record });
		if (!parsed.success) {
			return null;
		}
		return {
			id: parsed.data.id,
			prompt: parsed.data.prompt,
			preview: resolveRunPreview(parsed.data),
			status: parsed.data.status,
			createdAt: parsed.data.createdAt.toISOString(),
			updatedAt: parsed.data.updatedAt.toISOString(),
			workspaceId: parsed.data.workspaceId,
			stopRequested: parsed.data.stop_requested === true
		};
	}

	function resolveSortInstant(run: RunListItem): Date | null {
		const timestamp = new Date(run.updatedAt || run.createdAt);
		if (Number.isNaN(timestamp.getTime())) {
			return null;
		}
		return timestamp;
	}

	function resolveSectionKey(run: RunListItem): RunSectionKey {
		const timestamp = resolveSortInstant(run);
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

	function formatRelativeDate(value: string): string {
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

	function formatRunMeta(run: RunListItem): string {
		const parts = [`Workspace ${run.workspaceId}`, `Run ${run.id.slice(0, 8)}`];
		if (run.stopRequested && (run.status === 'created' || run.status === 'executing')) {
			parts.push('Stop requested');
		}
		return parts.join(' · ');
	}

	function matchesFilter(run: RunListItem, nextFilter: RunFilter): boolean {
		if (nextFilter === 'All') {
			return true;
		}
		if (nextFilter === 'Running') {
			return run.status === 'executing';
		}
		if (nextFilter === 'Queued') {
			return run.status === 'created';
		}
		if (nextFilter === 'Done') {
			return run.status === 'done';
		}
		if (nextFilter === 'Failed') {
			return run.status === 'failed';
		}
		return run.status === 'stopped';
	}

	function resolveRunHref(runId: string): string {
		return `/spark/agents/${encodeURIComponent(runId)}`;
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		try {
			const auth = getAuth(getFirebaseApp());
			if (auth.currentUser) {
				authReady = true;
				return;
			}
			const stopAuth = onIdTokenChanged(auth, (firebaseUser) => {
				if (!firebaseUser) {
					return;
				}
				authReady = true;
				stopAuth();
			});
		} catch (authError) {
			console.warn('Failed to initialize Spark Agents auth guard', authError);
		}
	});

	const visibleRuns = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		return agentRuns.filter((run) => {
			if (!matchesFilter(run, filter)) {
				return false;
			}
			if (needle.length === 0) {
				return true;
			}
			return (
				run.prompt.toLowerCase().includes(needle) ||
				run.preview.toLowerCase().includes(needle) ||
				run.workspaceId.toLowerCase().includes(needle) ||
				run.id.toLowerCase().includes(needle)
			);
		});
	});

	const sections = $derived.by(() => {
		const grouped = new Map<RunSectionKey, RunListItem[]>();
		for (const section of SECTION_ORDER) {
			grouped.set(section.key, []);
		}
		for (const run of visibleRuns) {
			grouped.get(resolveSectionKey(run))?.push(run);
		}
		return SECTION_ORDER.map((section) => ({
			...section,
			items: grouped.get(section.key) ?? []
		})).filter((section) => section.items.length > 0);
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId) {
			agentRuns = [];
			loading = false;
			error = null;
			return;
		}
		if (!authReady) {
			agentRuns = [];
			loading = true;
			error = null;
			return;
		}

		loading = true;
		error = null;

		const db = getFirestore(getFirebaseApp());
		const runsQuery = query(
			collection(db, 'users', userId, 'agents'),
			orderBy('updatedAt', 'desc'),
			queryLimit(RUN_LIST_LIMIT)
		);
		const stop = onSnapshot(
			runsQuery,
			(snapshot) => {
				const nextRuns: RunListItem[] = [];
				for (const document of snapshot.docs) {
					const nextRun = parseRunListItem(document.id, document.data());
					if (!nextRun) {
						continue;
					}
					nextRuns.push(nextRun);
				}
				agentRuns = nextRuns;
				loading = false;
			},
			(snapshotError) => {
				console.warn('Failed to load Spark agent runs', snapshotError);
				error = 'Spark could not load your agent runs right now.';
				loading = false;
			}
		);

		return () => {
			stop();
		};
	});
</script>

<svelte:head>
	<title>Spark · Agents</title>
</svelte:head>

<section class="agents-page">
	<div class="toolbar">
		<label class="search-field">
			<svg class="search-field__icon" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="11" cy="11" r="7"></circle>
				<path d="M20 20L16.65 16.65"></path>
			</svg>
			<input
				type="search"
				value={search}
				placeholder="Search agent runs..."
				aria-label="Search agent runs"
				oninput={(event) => {
					search = (event.currentTarget as HTMLInputElement).value;
				}}
			/>
		</label>

		<div class="filters" role="tablist" aria-label="Agent run status">
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
			<h2>Loading agent runs...</h2>
			<p>Pulling the latest run activity from Firestore.</p>
		</div>
	{:else if error}
		<div class="state-card state-card--error" role="alert">
			<h2>Couldn&apos;t load agent runs</h2>
			<p>{error}</p>
		</div>
	{:else if visibleRuns.length === 0}
		<div class="state-card">
			<h2>{agentRuns.length === 0 ? 'No agent runs yet' : 'No agent runs found'}</h2>
			<p>
				{agentRuns.length === 0
					? 'Runs launched from Spark will appear here once they start syncing.'
					: 'Try another search or filter to narrow the list.'}
			</p>
		</div>
	{:else}
		<div class="sections">
			{#each sections as section (section.key)}
				<section class="run-section" aria-labelledby={`agent-section-${section.key}`}>
					<header class="run-section__header">
						<span id={`agent-section-${section.key}`}>{section.label}</span>
						<div class="run-section__rule" aria-hidden="true"></div>
						<span>{section.items.length} run{section.items.length === 1 ? '' : 's'}</span>
					</header>

					<div class="run-group">
						{#each section.items as run, index (run.id)}
							<a class="run-row" href={resolveRunHref(run.id)} data-status={run.status}>
								<div class="run-row__icon" data-status={run.status} aria-hidden="true">
									{#if run.status === 'done'}
										<svg viewBox="0 0 24 24">
											<path d="M5 13L9 17L19 7"></path>
										</svg>
									{:else if run.status === 'executing'}
										<svg viewBox="0 0 24 24">
											<path d="M8 5V19L19 12Z"></path>
										</svg>
									{:else if run.status === 'stopped'}
										<svg viewBox="0 0 24 24">
											<path d="M7 7H17V17H7Z"></path>
										</svg>
									{:else if run.status === 'failed'}
										<svg viewBox="0 0 24 24">
											<path d="M7 7L17 17"></path>
											<path d="M17 7L7 17"></path>
										</svg>
									{:else}
										<svg viewBox="0 0 24 24">
											<circle cx="12" cy="12" r="8"></circle>
											<path d="M12 8V12L15 14"></path>
										</svg>
									{/if}
								</div>

								<div class="run-row__body">
									<div class="run-row__topline">
										<div class="run-row__titlewrap">
											<h2>{run.prompt}</h2>
											<span class="run-status-pill" data-status={run.status}>{run.status}</span>
											{#if run.stopRequested && (run.status === 'created' || run.status === 'executing')}
												<span class="run-stop-pill">Stop requested</span>
											{/if}
										</div>
										<span class="run-row__date">{formatRelativeDate(run.updatedAt)}</span>
									</div>

									<p class="run-row__preview">{run.preview}</p>
									<p class="run-row__meta">{formatRunMeta(run)}</p>
								</div>
							</a>

							{#if index < section.items.length - 1}
								<div class="run-row__divider" aria-hidden="true"></div>
							{/if}
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</section>

<style lang="postcss">
	.agents-page {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		width: min(62rem, 94vw);
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

	.run-section {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.run-section__header {
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

	.run-section__rule {
		height: 1px;
		background: color-mix(in srgb, var(--border) 84%, transparent);
	}

	.run-group,
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

	.run-row {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		padding: 1.05rem 1.15rem;
		text-decoration: none;
		color: inherit;
		transition: background-color 140ms ease;
	}

	.run-row:hover {
		background: color-mix(in srgb, var(--foreground) 2%, transparent);
	}

	.run-row__icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		flex-shrink: 0;
		border-radius: 1rem;
		background: var(--status-bg);
		color: var(--status-fg);
		margin-top: 0.1rem;
	}

	.run-row__icon svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.run-row__icon[data-status='executing'] svg,
	.run-row__icon[data-status='stopped'] svg {
		fill: currentColor;
		stroke: none;
	}

	.run-row__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.run-row__topline {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.run-row__titlewrap {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.65rem;
		min-width: 0;
	}

	.run-row__titlewrap h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 650;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}

	.run-status-pill,
	.run-stop-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.22rem 0.65rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}

	.run-status-pill {
		background: var(--status-bg);
		color: var(--status-fg);
	}

	.run-stop-pill {
		background: rgba(245, 158, 11, 0.16);
		color: #b45309;
	}

	.run-row__date {
		flex-shrink: 0;
		font-size: 0.86rem;
		color: color-mix(in srgb, var(--foreground) 38%, transparent);
	}

	.run-row__preview {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.45;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.run-row__meta {
		margin: 0.15rem 0 0;
		font-size: 0.84rem;
		color: color-mix(in srgb, var(--foreground) 40%, transparent);
	}

	.run-row__divider {
		height: 1px;
		margin: 0 1.15rem;
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
	}

	.run-row[data-status='created'] {
		--status-fg: #6b7280;
		--status-bg: rgba(107, 114, 128, 0.12);
	}

	.run-row[data-status='executing'] {
		--status-fg: #1d4ed8;
		--status-bg: rgba(59, 130, 246, 0.16);
	}

	.run-row[data-status='done'] {
		--status-fg: #166534;
		--status-bg: rgba(34, 197, 94, 0.18);
	}

	.run-row[data-status='failed'] {
		--status-fg: #b91c1c;
		--status-bg: rgba(239, 68, 68, 0.14);
	}

	.run-row[data-status='stopped'] {
		--status-fg: #b45309;
		--status-bg: rgba(245, 158, 11, 0.18);
	}

	:global(:root:not([data-theme='light']) .agents-page),
	:global([data-theme='dark'] .agents-page),
	:global(.dark .agents-page) {
		--spark-paper-surface: #17142a;
		--spark-paper-surface-elevated: #201c39;
		--spark-paper-surface-soft: #1d1934;
		--spark-paper-divider: #3a3258;
		--spark-paper-border: #3a3258;
		--spark-paper-text: #e4dff5;
		--spark-paper-text-strong: #f0eef8;
		--spark-paper-text-soft: #a89ec4;
		--spark-paper-text-muted: #9489b4;
		--spark-paper-text-subtle: #7f739d;

		.search-field__icon {
			stroke: var(--spark-paper-text-subtle);
		}

		.search-field input {
			background: color-mix(in srgb, #d6a11e 6%, var(--spark-paper-surface-soft));
			border-color: var(--spark-paper-border);
			color: var(--spark-paper-text);
		}

		.filter-pill {
			background: var(--spark-paper-surface-elevated);
			border-color: var(--spark-paper-border);
			color: var(--spark-paper-text-soft);
		}

		.filter-pill:hover {
			background: color-mix(in srgb, white 4%, var(--spark-paper-surface-elevated));
			border-color: #5c517c;
		}

		.filter-pill[data-active='true'] {
			background: color-mix(in srgb, #d6a11e 24%, var(--spark-paper-surface-soft));
			border-color: #fbbf24;
			color: #fde68a;
		}

		.run-group,
		.state-card {
			background:
				linear-gradient(
					180deg,
					color-mix(in srgb, #d6a11e 4%, var(--spark-paper-surface-elevated)) 0%,
					var(--spark-paper-surface) 100%
				);
			border-color: var(--spark-paper-border);
			box-shadow: 0 18px 36px -28px rgba(2, 6, 23, 0.65);
		}

		.run-row:hover {
			background: rgba(255, 255, 255, 0.03);
		}

		.state-card h2,
		.run-row__titlewrap h2 {
			color: var(--spark-paper-text-strong);
		}

		.state-card p,
		.run-row__preview {
			color: var(--spark-paper-text-soft);
		}

		.run-row__date,
		.run-section__header {
			color: var(--spark-paper-text-muted);
		}

		.run-row__meta {
			color: var(--spark-paper-text-soft);
		}

		.run-row__divider,
		.run-section__rule {
			background: var(--spark-paper-divider);
		}

		.run-stop-pill {
			background: color-mix(in srgb, #d6a11e 24%, var(--spark-paper-surface-soft));
			color: #fde68a;
		}

		.run-row[data-status='created'] {
			--status-fg: #c5bbdf;
			--status-bg: color-mix(in srgb, #c5bbdf 14%, var(--spark-paper-surface-soft));
		}

		.run-row[data-status='executing'] {
			--status-fg: #dbeafe;
			--status-bg: color-mix(in srgb, #3b82f6 20%, var(--spark-paper-surface-soft));
		}

		.run-row[data-status='done'] {
			--status-fg: #bbf7d0;
			--status-bg: color-mix(in srgb, #22a66e 22%, var(--spark-paper-surface-soft));
		}

		.run-row[data-status='failed'] {
			--status-fg: #fecaca;
			--status-bg: color-mix(in srgb, #ef4444 20%, var(--spark-paper-surface-soft));
		}

		.run-row[data-status='stopped'] {
			--status-fg: #fde68a;
			--status-bg: color-mix(in srgb, #d6a11e 24%, var(--spark-paper-surface-soft));
		}
	}

	@media (max-width: 720px) {
		.run-row__topline {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
