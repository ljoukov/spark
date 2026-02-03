<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { getContext } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import {
		collection,
		doc,
		getFirestore,
		limit,
		onSnapshot,
		orderBy,
		query,
		type Unsubscribe
	} from 'firebase/firestore';
	import { Button } from '$lib/components/ui/button/index.js';
	import { renderMarkdown } from '$lib/markdown';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import {
		SparkAgentRunLogSchema,
		SparkAgentStateSchema,
		SparkAgentWorkspaceFileSchema,
		type SparkAgentRunLog,
		type SparkAgentRunStats,
		type SparkAgentState,
		type SparkAgentWorkspaceFile
	} from '@spark/schemas';

	type ClientUser = { uid: string } | null;

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? null);
	const userId = $derived(user?.uid ?? null);

	let agents = $state<SparkAgentState[]>([]);
	let selectedAgentId = $state<string | null>(null);
	let selectedAgentDetail = $state<SparkAgentState | null>(null);
	let files = $state<SparkAgentWorkspaceFile[]>([]);
	let runLog = $state<SparkAgentRunLog | null>(null);
	let selectedFilePath = $state<string | null>(null);
	let createPrompt = $state('');
	let createWorkspaceId = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let createSuccess = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let copySuccess = $state(false);
	let fileDialogOpen = $state(false);
	let authReady = $state(false);

	const selectedAgent = $derived.by(() => {
		if (selectedAgentDetail && selectedAgentDetail.id === selectedAgentId) {
			return selectedAgentDetail;
		}
		if (selectedAgentId) {
			return agents.find((agent) => agent.id === selectedAgentId) ?? null;
		}
		return null;
	});
	const selectedFile = $derived(
		selectedFilePath ? (files.find((file) => file.path === selectedFilePath) ?? null) : null
	);
	const selectedFileIsMarkdown = $derived.by(() => {
		const path = selectedFile?.path?.toLowerCase() ?? '';
		return path.endsWith('.md') || path.endsWith('.markdown');
	});
	const selectedFileHtml = $derived(
		selectedFileIsMarkdown && selectedFile?.content ? renderMarkdown(selectedFile.content) : ''
	);
	const logLines = $derived(runLog?.lines ?? []);
	const runStats = $derived<SparkAgentRunStats | null>(runLog?.stats ?? null);

	function formatUsd(value: number | undefined): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '—';
		}
		return `$${value.toFixed(4)}`;
	}

	function formatInt(value: number | undefined): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '—';
		}
		return Intl.NumberFormat('en-US').format(Math.floor(value));
	}

	function formatTimestamp(value: Date | undefined): string {
		if (!value) {
			return '—';
		}
		return value.toLocaleString('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function formatRelativeAge(value: Date | undefined): string {
		if (!value) {
			return '—';
		}
		const diffMs = Date.now() - value.getTime();
		if (diffMs < 0) {
			return 'just now';
		}
		const seconds = Math.floor(diffMs / 1000);
		if (seconds < 45) {
			return 'just now';
		}
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) {
			return `${minutes}m ago`;
		}
		const hours = Math.floor(minutes / 60);
		if (hours < 24) {
			return `${hours}h ago`;
		}
		const days = Math.floor(hours / 24);
		if (days < 7) {
			return `${days}d ago`;
		}
		const weeks = Math.floor(days / 7);
		return `${weeks}w ago`;
	}

	function formatSize(bytes?: number): string {
		if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
			return '—';
		}
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const kb = bytes / 1024;
		if (kb < 1024) {
			return `${kb.toFixed(1)} KB`;
		}
		const mb = kb / 1024;
		return `${mb.toFixed(1)} MB`;
	}

	function decodeFileId(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	function parseLogTimestamp(key: string): Date | null {
		const match = /^t(\d{13})_\d{3}$/.exec(key);
		if (!match) {
			return null;
		}
		const ms = Number.parseInt(match[1] ?? '', 10);
		if (!Number.isFinite(ms)) {
			return null;
		}
		return new Date(ms);
	}

	function parseRunLogDoc(data: Record<string, unknown>): SparkAgentRunLog | null {
		const rawLines = data.lines && typeof data.lines === 'object' ? data.lines : null;
		const entries: Array<{ key: string; timestamp: Date; line: string }> = [];
		if (rawLines && !Array.isArray(rawLines)) {
			for (const [key, value] of Object.entries(rawLines as Record<string, unknown>)) {
				if (typeof value !== 'string') {
					continue;
				}
				const timestamp = parseLogTimestamp(key) ?? null;
				if (!timestamp) {
					continue;
				}
				entries.push({ key, timestamp, line: value });
			}
		}
		entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
		const limitedEntries = entries.slice(-2000);
		const payload: Record<string, unknown> = {
			lines: limitedEntries
		};
		if (data.updatedAt !== undefined) {
			payload.updatedAt = data.updatedAt;
		}
		if (data.stats && typeof data.stats === 'object') {
			payload.stats = data.stats;
		}
		const parsed = SparkAgentRunLogSchema.safeParse(payload);
		if (!parsed.success) {
			return null;
		}
		return parsed.data;
	}

	async function copyPrompt(text: string): Promise<void> {
		if (!browser) {
			return;
		}
		copySuccess = false;
		try {
			await navigator.clipboard.writeText(text);
			copySuccess = true;
			window.setTimeout(() => {
				copySuccess = false;
			}, 2000);
		} catch (error) {
			console.warn('Failed to copy prompt', error);
		}
	}

	async function createAgent(): Promise<void> {
		if (createPrompt.trim().length === 0 || creating) {
			return;
		}
		createError = null;
		createSuccess = null;
		creating = true;
		try {
			const response = await fetch('/api/spark/agents', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					prompt: createPrompt.trim(),
					workspaceId: createWorkspaceId.trim() || undefined
				})
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.error ?? 'creation_failed');
			}
			const payload = await response.json();
			if (payload?.agentId) {
				selectedAgentId = payload.agentId;
				selectedAgentDetail = null;
				createPrompt = '';
				createWorkspaceId = '';
				createSuccess = 'Agent created and queued.';
				loadError = null;
			}
		} catch (error) {
			createError = error instanceof Error ? error.message : 'Unable to create agent right now.';
		} finally {
			creating = false;
		}
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
		} catch (error) {
			console.warn('Failed to initialize Spark Agents auth guard', error);
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !authReady) {
			agents = [];
			loadError = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const agentsRef = collection(db, 'users', userId, 'agents');
		const agentsQuery = query(agentsRef, orderBy('createdAt', 'desc'), limit(50));
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			agentsQuery,
			(snap) => {
				const next: SparkAgentState[] = [];
				for (const docSnap of snap.docs) {
					const parsed = SparkAgentStateSchema.safeParse({ id: docSnap.id, ...docSnap.data() });
					if (!parsed.success) {
						continue;
					}
					next.push(parsed.data);
				}
				agents = next;
				loadError = null;
			},
			(error) => {
				console.warn('Firestore subscription failed', error);
				loadError = 'Unable to load Spark Agents right now.';
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !selectedAgentId || !authReady) {
			selectedAgentDetail = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const agentRef = doc(db, 'users', userId, 'agents', selectedAgentId);
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			agentRef,
			(snap) => {
				if (!snap.exists()) {
					selectedAgentDetail = null;
					return;
				}
				const parsed = SparkAgentStateSchema.safeParse({ id: snap.id, ...snap.data() });
				if (!parsed.success) {
					console.warn('Invalid Spark Agent payload', parsed.error.flatten());
					return;
				}
				selectedAgentDetail = parsed.data;
				loadError = null;
			},
			(error) => {
				console.warn('Firestore subscription failed', error);
				loadError = 'Unable to load Spark Agent details right now.';
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		const workspaceId = selectedAgent?.workspaceId ?? null;
		if (!userId || !workspaceId || !authReady) {
			files = [];
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const filesRef = collection(db, 'users', userId, 'workspace', workspaceId, 'files');
		const filesQuery = query(filesRef, orderBy('path', 'asc'), limit(200));
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			filesQuery,
			(snap) => {
				const next: SparkAgentWorkspaceFile[] = [];
				for (const docSnap of snap.docs) {
					const data = docSnap.data();
					const payload = {
						...data,
						path:
							typeof data.path === 'string' && data.path.trim().length > 0
								? data.path.trim()
								: decodeFileId(docSnap.id)
					};
					const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
					if (!parsed.success) {
						continue;
					}
					next.push(parsed.data);
				}
				files = next;
				loadError = null;
			},
			(error) => {
				console.warn('Firestore subscription failed', error);
				loadError = 'Unable to load Spark Agent workspace right now.';
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !selectedAgentId || !authReady) {
			runLog = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const ref = doc(db, 'users', userId, 'agents', selectedAgentId, 'logs', 'log');
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			ref,
			(snap) => {
				if (!snap.exists()) {
					runLog = null;
					return;
				}
				const data = (snap.data() ?? {}) as Record<string, unknown>;
				runLog = parseRunLogDoc(data);
				loadError = null;
			},
			(error) => {
				console.warn('Firestore subscription failed', error);
				loadError = 'Unable to load Spark Agent logs right now.';
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		if (agents.length === 0) {
			selectedAgentId = null;
			selectedAgentDetail = null;
			return;
		}
		if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
			return;
		}
		selectedAgentId = agents[0]?.id ?? null;
	});

	$effect(() => {
		if (!selectedAgentId) {
			selectedAgentDetail = null;
			files = [];
			runLog = null;
			return;
		}
		selectedAgentDetail = null;
		files = [];
		runLog = null;
	});

	$effect(() => {
		if (selectedFilePath && files.some((file) => file.path === selectedFilePath)) {
			return;
		}
		if (!selectedFilePath || files.length === 0) {
			selectedFilePath = null;
			fileDialogOpen = false;
		}
	});
</script>

<svelte:head>
	<title>Spark Agents</title>
</svelte:head>

<section class="agents-page">
	<header class="agents-hero">
		<div class="agents-hero__copy">
			<p class="agents-hero__eyebrow">Spark AI Agent</p>
			<h1>Track every autonomous run</h1>
			<p>
				Launch a new Spark Agent, watch its status update live, and inspect the workspace files it
				produces.
			</p>
		</div>
		<div class="agents-hero__card">
			<label class="agents-hero__label" for="agent-prompt">New agent prompt</label>
			<textarea
				id="agent-prompt"
				class="agents-hero__textarea"
				rows="4"
				placeholder="Describe the task you want the agent to complete..."
				bind:value={createPrompt}
			></textarea>
			<label class="agents-hero__label" for="agent-workspace"> Workspace ID (optional) </label>
			<input
				id="agent-workspace"
				class="agents-hero__input"
				type="text"
				placeholder="Use existing workspace or leave empty"
				bind:value={createWorkspaceId}
			/>
			<div class="agents-hero__actions">
				<Button onclick={createAgent} disabled={!userId || !createPrompt.trim() || creating}>
					{creating ? 'Creating…' : 'Create agent'}
				</Button>
				{#if createSuccess}
					<span class="agents-hero__success">{createSuccess}</span>
				{/if}
				{#if createError}
					<span class="agents-hero__error">{createError}</span>
				{/if}
			</div>
		</div>
	</header>

	{#if loadError}
		<div class="agents-load-error" role="alert">{loadError}</div>
	{/if}

	<div class="agents-grid">
		<section class="agents-list">
			<h2>Runs</h2>
			{#if agents.length === 0}
				<p class="agents-empty">No agents yet. Create one to get started.</p>
			{:else}
				<ul>
					{#each agents as agent}
						<li>
							<button
								class={`agents-list__item ${agent.id === selectedAgentId ? 'is-active' : ''}`}
								onclick={() => {
									selectedAgentId = agent.id;
								}}
							>
								<div>
									<p class="agents-list__prompt">{agent.prompt}</p>
									<p class="agents-list__meta">
										<span class={`status-pill status-pill--${agent.status}`}>{agent.status}</span>
										<span>{formatTimestamp(agent.createdAt)}</span>
									</p>
								</div>
								<span class="agents-list__chevron">›</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="agents-detail">
			{#if !selectedAgent}
				<div class="agents-empty agents-detail__empty">Select an agent to see details.</div>
			{:else}
				<div class="agents-detail__card">
					<div class="agents-detail__header">
						<div>
							<p class="agents-detail__eyebrow">Agent status</p>
							<h2>{selectedAgent.prompt}</h2>
						</div>
						<div class="agents-detail__header-actions">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => {
									void copyPrompt(selectedAgent.prompt);
								}}
							>
								{copySuccess ? 'Copied' : 'Copy prompt'}
							</Button>
							<span class={`status-pill status-pill--${selectedAgent.status}`}>
								{selectedAgent.status}
							</span>
						</div>
					</div>
					<div class="agents-detail__meta">
						<div>
							<span>Workspace</span>
							<p>{selectedAgent.workspaceId}</p>
						</div>
						<div>
							<span>Created</span>
							<p>{formatTimestamp(selectedAgent.createdAt)}</p>
						</div>
						<div>
							<span>Updated</span>
							<p>{formatTimestamp(selectedAgent.updatedAt)}</p>
						</div>
					</div>
					{#if selectedAgent.resultSummary}
						<div class="agents-detail__summary">
							<p class="agents-detail__eyebrow">Summary</p>
							<p>{selectedAgent.resultSummary}</p>
						</div>
					{/if}
					{#if selectedAgent.error}
						<div class="agents-detail__error">
							<p class="agents-detail__eyebrow">Error</p>
							<p>{selectedAgent.error}</p>
						</div>
					{/if}
					<div class="agents-detail__timeline">
						<p class="agents-detail__eyebrow">Timeline</p>
						<ul>
							{#each selectedAgent.statesTimeline as entry}
								<li>
									<span class={`status-dot status-dot--${entry.state}`}></span>
									<span>{entry.state}</span>
									<span class="agents-detail__timestamp">{formatTimestamp(entry.timestamp)}</span>
								</li>
							{/each}
						</ul>
					</div>
				</div>

				<div class="agents-workspace">
					<div class="agents-workspace__files">
						<h3>Workspace files</h3>
						{#if files.length === 0}
							<p class="agents-empty">No files synced yet.</p>
						{:else}
							<ul>
								{#each files as file}
									<li>
										<button
											class={`file-item ${file.path === selectedFilePath ? 'is-active' : ''}`}
											onclick={() => {
												selectedFilePath = file.path;
												fileDialogOpen = true;
											}}
										>
											<span class="file-item__path">{file.path}</span>
											<span class="file-item__meta">
												<span>{formatSize(file.sizeBytes)}</span>
												<span>{formatRelativeAge(file.updatedAt)}</span>
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>

				<section class="agents-run">
					<h3>Run stats</h3>
					{#if runStats}
						<div class="agents-run__stats">
							<div>
								<span class="agents-run__label">LLM cost</span>
								<p class="agents-run__value">{formatUsd(runStats.modelCostUsd)}</p>
							</div>
							<div>
								<span class="agents-run__label">Tools cost</span>
								<p class="agents-run__value">{formatUsd(runStats.toolCostUsd)}</p>
							</div>
							<div>
								<span class="agents-run__label">Total cost</span>
								<p class="agents-run__value">{formatUsd(runStats.totalCostUsd)}</p>
							</div>
							<div>
								<span class="agents-run__label">Model calls</span>
								<p class="agents-run__value">{formatInt(runStats.modelCalls)}</p>
							</div>
							<div class="agents-run__wide">
								<span class="agents-run__label">Models</span>
								<p class="agents-run__value">{runStats.modelsUsed.join(', ')}</p>
							</div>
							<div>
								<span class="agents-run__label">Tool calls</span>
								<p class="agents-run__value">{formatInt(runStats.toolCalls)}</p>
							</div>
							<div>
								<span class="agents-run__label">Total tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.totalTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Prompt tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.promptTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Thinking tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.thinkingTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Output tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.responseTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Cached tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.cachedTokens)}</p>
							</div>
						</div>
					{:else}
						<p class="agents-empty">Stats will appear once the agent starts running.</p>
					{/if}

					<h3>Run log</h3>
					{#if runLog && logLines.length > 0}
						<div class="agents-run__log" aria-label="Agent run log">
							{#each logLines as entry (entry.key)}
								<div class="agents-run__log-line">
									<span class="agents-run__log-ts">{formatTimestamp(entry.timestamp)}</span>
									<span class="agents-run__log-msg">{entry.line}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="agents-empty">No logs yet.</p>
					{/if}
				</section>
			{/if}
		</section>
	</div>
</section>

{#if fileDialogOpen && selectedFile}
	<button
		class="file-dialog__backdrop"
		type="button"
		aria-label="Close file dialog"
		onclick={() => {
			fileDialogOpen = false;
		}}
	></button>
	<div class="file-dialog" role="dialog" aria-modal="true">
		<header class="file-dialog__header">
			<div>
				<p class="file-dialog__label">Workspace file</p>
				<h3>{selectedFile.path}</h3>
			</div>
			<Button
				variant="ghost"
				size="sm"
				onclick={() => {
					fileDialogOpen = false;
				}}
			>
				×
			</Button>
		</header>
		<div class="file-dialog__body">
			{#if selectedFileIsMarkdown}
				<div class="markdown-preview">{@html selectedFileHtml}</div>
			{:else}
				<pre class="file-preview"><code>{selectedFile.content}</code></pre>
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
	.agents-page {
		display: flex;
		flex-direction: column;
		gap: clamp(1.5rem, 3vw, 2.5rem);
		padding: clamp(1.5rem, 3vw, 2.5rem) 0 2.5rem;
		max-width: min(80rem, 92vw);
		margin: 0 auto;
	}

	.agents-hero {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		gap: clamp(1.5rem, 3vw, 2.4rem);
		align-items: stretch;
		padding: clamp(1.5rem, 2.6vw, 2.4rem);
		border-radius: clamp(1.4rem, 2vw, 2.1rem);
		background:
			radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 55%),
			linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.85));
		color: #f8fafc;
		border: 1px solid rgba(148, 163, 184, 0.2);
		box-shadow: 0 30px 80px -55px rgba(15, 23, 42, 0.8);
	}

	.agents-hero__copy h1 {
		margin: 0 0 0.6rem;
		font-size: clamp(2rem, 3.4vw, 2.8rem);
		font-weight: 650;
	}

	.agents-hero__copy p {
		margin: 0;
		line-height: 1.6;
		color: rgba(248, 250, 252, 0.86);
	}

	.agents-hero__eyebrow {
		margin: 0 0 0.6rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		color: rgba(148, 163, 184, 0.9);
	}

	.agents-hero__card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: rgba(15, 23, 42, 0.7);
		border-radius: 1.2rem;
		padding: 1.2rem;
		border: 1px solid rgba(148, 163, 184, 0.2);
	}

	.agents-hero__label {
		font-size: 0.85rem;
		color: rgba(226, 232, 240, 0.8);
	}

	.agents-hero__textarea {
		min-height: 6.5rem;
		border-radius: 0.9rem;
		border: 1px solid rgba(148, 163, 184, 0.3);
		padding: 0.8rem 0.9rem;
		background: rgba(15, 23, 42, 0.4);
		color: #f8fafc;
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.agents-hero__textarea:focus {
		outline: none;
		border-color: rgba(56, 189, 248, 0.6);
		box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
	}

	.agents-hero__input {
		border-radius: 0.9rem;
		border: 1px solid rgba(148, 163, 184, 0.3);
		padding: 0.7rem 0.9rem;
		background: rgba(15, 23, 42, 0.4);
		color: #f8fafc;
		font-size: 0.92rem;
	}

	.agents-hero__input:focus {
		outline: none;
		border-color: rgba(56, 189, 248, 0.6);
		box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
	}

	.agents-hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.agents-hero__success {
		font-size: 0.85rem;
		color: rgba(134, 239, 172, 0.9);
	}

	.agents-hero__error {
		font-size: 0.85rem;
		color: rgba(248, 113, 113, 0.9);
	}

	.agents-load-error {
		border-radius: 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid rgba(248, 113, 113, 0.35);
		background: rgba(248, 113, 113, 0.12);
		color: rgba(185, 28, 28, 0.92);
		font-size: 0.9rem;
	}

	:global([data-theme='dark'] .agents-load-error),
	:global(:root:not([data-theme='light']) .agents-load-error) {
		background: rgba(248, 113, 113, 0.18);
		color: rgba(254, 226, 226, 0.9);
	}

	.agents-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr);
		gap: clamp(1.2rem, 2.5vw, 2rem);
	}

	.agents-list,
	.agents-detail {
		background: var(--app-panel-bg, rgba(255, 255, 255, 0.85));
		border-radius: 1.2rem;
		padding: 1.2rem;
		border: 1px solid rgba(148, 163, 184, 0.2);
		box-shadow: 0 18px 40px -35px rgba(15, 23, 42, 0.35);
	}

	:global([data-theme='dark'] .agents-list),
	:global([data-theme='dark'] .agents-detail),
	:global(:root:not([data-theme='light']) .agents-list),
	:global(:root:not([data-theme='light']) .agents-detail) {
		background: rgba(15, 23, 42, 0.7);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.agents-list h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
	}

	.agents-list ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.agents-list__item {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		text-align: left;
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid transparent;
		padding: 0.8rem 0.9rem;
		border-radius: 0.9rem;
		cursor: pointer;
		transition:
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.agents-list__item:hover {
		border-color: rgba(56, 189, 248, 0.5);
		transform: translateY(-1px);
	}

	.agents-list__item.is-active {
		border-color: rgba(56, 189, 248, 0.7);
		background: rgba(56, 189, 248, 0.15);
	}

	.agents-list__prompt {
		margin: 0 0 0.35rem;
		font-weight: 600;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.agents-list__meta {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.8rem;
		color: rgba(100, 116, 139, 0.9);
	}

	:global([data-theme='dark'] .agents-list__meta),
	:global(:root:not([data-theme='light']) .agents-list__meta) {
		color: rgba(226, 232, 240, 0.7);
	}

	.agents-list__chevron {
		font-size: 1.4rem;
		color: rgba(100, 116, 139, 0.6);
	}

	.agents-detail__card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		border-bottom: 1px solid rgba(148, 163, 184, 0.2);
		padding-bottom: 1.2rem;
		margin-bottom: 1.2rem;
	}

	.agents-detail__header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.agents-detail__header-actions {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}

	.agents-detail__header h2 {
		margin: 0;
		font-size: 1.3rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.agents-detail__meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.8rem;
		font-size: 0.85rem;
		color: rgba(100, 116, 139, 0.9);
	}

	.agents-detail__meta p {
		margin: 0.15rem 0 0;
		color: inherit;
		font-weight: 600;
	}

	.agents-detail__eyebrow {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgba(100, 116, 139, 0.7);
	}

	.agents-detail__summary,
	.agents-detail__error,
	.agents-detail__timeline {
		padding: 0.75rem;
		border-radius: 0.9rem;
		background: rgba(148, 163, 184, 0.08);
	}

	.agents-detail__error {
		background: rgba(248, 113, 113, 0.12);
		color: rgba(185, 28, 28, 0.9);
	}

	.agents-detail__timeline ul {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.agents-detail__timeline li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.agents-detail__timestamp {
		margin-left: auto;
		color: rgba(100, 116, 139, 0.7);
		font-size: 0.78rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.status-pill--created {
		background: rgba(148, 163, 184, 0.2);
		color: rgba(71, 85, 105, 0.8);
	}

	.status-pill--executing {
		background: rgba(56, 189, 248, 0.2);
		color: rgba(14, 116, 144, 0.9);
	}

	.status-pill--done {
		background: rgba(34, 197, 94, 0.2);
		color: rgba(21, 128, 61, 0.9);
	}

	.status-pill--failed {
		background: rgba(248, 113, 113, 0.2);
		color: rgba(185, 28, 28, 0.9);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.7);
	}

	.status-dot--executing {
		background: rgba(56, 189, 248, 0.9);
	}

	.status-dot--done {
		background: rgba(34, 197, 94, 0.9);
	}

	.status-dot--failed {
		background: rgba(248, 113, 113, 0.9);
	}

	.agents-workspace {
		display: block;
	}

	.agents-workspace__files h3 {
		margin: 0 0 0.8rem;
		font-size: 1rem;
	}

	.agents-workspace__files ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.file-item {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.7rem;
		border-radius: 0.7rem;
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid transparent;
		cursor: pointer;
		font-size: 0.82rem;
		align-items: center;
	}

	.file-item__path {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-item__meta {
		display: inline-flex;
		gap: 0.6rem;
		color: rgba(100, 116, 139, 0.8);
		font-size: 0.75rem;
	}

	:global([data-theme='dark'] .file-item__meta),
	:global(:root:not([data-theme='light']) .file-item__meta) {
		color: rgba(226, 232, 240, 0.7);
	}

	.file-item.is-active {
		border-color: rgba(56, 189, 248, 0.6);
		background: rgba(56, 189, 248, 0.12);
	}

	.file-preview {
		white-space: pre-wrap;
		font-family:
			'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.85rem;
	}

	.markdown-preview :global(p) {
		margin: 0 0 0.85rem;
	}

	.agents-empty {
		margin: 0;
		color: rgba(100, 116, 139, 0.8);
		font-size: 0.9rem;
	}

	.agents-detail__empty {
		padding: 2rem;
		text-align: center;
	}

	.agents-run {
		margin-top: 1.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.agents-run h3 {
		margin: 0;
		font-size: 1rem;
	}

	.agents-run__stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.8rem;
		padding: 0.85rem;
		border-radius: 1rem;
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid rgba(148, 163, 184, 0.18);
	}

	.agents-run__label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(100, 116, 139, 0.7);
	}

	.agents-run__value {
		margin: 0.3rem 0 0;
		font-weight: 650;
	}

	.agents-run__wide {
		grid-column: 1 / -1;
	}

	.agents-run__log {
		padding: 0.85rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: rgba(15, 23, 42, 0.04);
		max-height: 22rem;
		overflow: auto;
		font-family:
			'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.82rem;
		line-height: 1.4;
	}

	:global([data-theme='dark'] .agents-run__log),
	:global(:root:not([data-theme='light']) .agents-run__log) {
		background: rgba(15, 23, 42, 0.6);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.agents-run__log-line {
		display: grid;
		grid-template-columns: 10.5rem 1fr;
		gap: 0.75rem;
		padding: 0.15rem 0;
	}

	.agents-run__log-ts {
		color: rgba(100, 116, 139, 0.7);
		font-size: 0.72rem;
	}

	.agents-run__log-msg {
		white-space: pre-wrap;
		word-break: break-word;
	}

	.file-dialog__backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.6);
		z-index: 50;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.file-dialog {
		position: fixed;
		inset: clamp(1rem, 4vw, 2.5rem);
		background: var(--app-panel-bg, rgba(255, 255, 255, 0.96));
		border-radius: 1.4rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		box-shadow: 0 30px 90px -50px rgba(15, 23, 42, 0.7);
		z-index: 60;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	:global([data-theme='dark'] .file-dialog),
	:global(:root:not([data-theme='light']) .file-dialog) {
		background: rgba(15, 23, 42, 0.95);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.file-dialog__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.2rem;
		border-bottom: 1px solid rgba(148, 163, 184, 0.2);
		gap: 1rem;
	}

	.file-dialog__header h3 {
		margin: 0.2rem 0 0;
		font-size: 1.1rem;
	}

	.file-dialog__label {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(100, 116, 139, 0.7);
	}

	.file-dialog__body {
		padding: 1.2rem;
		overflow: auto;
	}

	@media (max-width: 900px) {
		.agents-hero {
			grid-template-columns: 1fr;
		}

		.agents-grid {
			grid-template-columns: 1fr;
		}

		.agents-run__log-line {
			grid-template-columns: 1fr;
			gap: 0.15rem;
		}
	}
</style>
