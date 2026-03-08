<script lang="ts">
	import { browser } from '$app/environment';
	import { renderMarkdown } from '$lib/markdown';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import type {
		SparkAgentWorkspaceFile,
		SparkTutorComposerState,
		SparkTutorConfidence,
		SparkTutorHintLevel,
		SparkTutorScreenState
	} from '@spark/schemas';
	import { SparkAgentWorkspaceFileSchema } from '@spark/schemas';
	import {
		collection,
		getFirestore,
		limit,
		onSnapshot,
		orderBy,
		query,
		type Unsubscribe
	} from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { getContext, onMount, tick } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ClientUser = NonNullable<PageData['user']> | null;
	type WorkspaceContext = PageData['initialWorkspace']['context'];

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);
	const sessionId = $derived(data.session.id);
	const workspaceId = $derived(data.session.workspaceId);

	let authReady = $state(false);
	let tutorMarkdown = $state('');
	let inlineFeedbackMarkdown = $state('');
	let screenState = $state<SparkTutorScreenState>({
		status: 'booting',
		title: '',
		updatedAt: new Date(0).toISOString()
	});
	let composerState = $state<SparkTutorComposerState>({
		placeholder: 'Write your next thought here.',
		disabled: false,
		submitLabel: 'Send'
	});
	let contextState = $state<WorkspaceContext>({
		problem: '',
		officialSolution: '',
		transcript: '',
		grading: '',
		annotations: '',
		overallFeedback: ''
	});
	let draftText = $state('');
	let confidence = $state<SparkTutorConfidence>('mid');
	let requestError = $state<string | null>(null);
	let sendingTurn = $state(false);
	let lastDraftRevision = $state(0);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let backdropEl = $state<HTMLDivElement | null>(null);
	let draftDebounceTimer = 0 as ReturnType<typeof setTimeout> | 0;
	let didApplyInitialData = $state(false);

	function decodeFileId(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	function syncComposerScroll(): void {
		if (!textareaEl || !backdropEl) {
			return;
		}
		backdropEl.scrollTop = textareaEl.scrollTop;
		backdropEl.scrollLeft = textareaEl.scrollLeft;
	}

	function applyWorkspaceFiles(files: SparkAgentWorkspaceFile[]): void {
		const textByPath = new Map<string, string>();
		for (const file of files) {
			if ('content' in file && typeof file.content === 'string') {
				textByPath.set(file.path, file.content);
			}
		}
		const tutor = textByPath.get('ui/tutor.md');
		if (typeof tutor === 'string') {
			tutorMarkdown = tutor;
		}
		const inlineFeedback = textByPath.get('ui/inline-feedback.md');
		if (typeof inlineFeedback === 'string') {
			inlineFeedbackMarkdown = inlineFeedback;
		}
		const sessionStateRaw = textByPath.get('state/session.json');
		if (sessionStateRaw) {
			try {
				screenState = JSON.parse(sessionStateRaw);
			} catch {
				// keep previous value
			}
		}
		const composerStateRaw = textByPath.get('state/composer.json');
		if (composerStateRaw) {
			try {
				composerState = JSON.parse(composerStateRaw);
			} catch {
				// keep previous value
			}
		}
		const problem = textByPath.get('context/problem.md');
		const officialSolution = textByPath.get('context/official-solution.md');
		const transcript = textByPath.get('context/student-transcript.md');
		const grading = textByPath.get('context/grading.md');
		const annotations = textByPath.get('context/annotations.md');
		const overallFeedback = textByPath.get('context/overall-feedback.md');
		contextState = {
			problem: problem ?? contextState.problem,
			officialSolution: officialSolution ?? contextState.officialSolution,
			transcript: transcript ?? contextState.transcript,
			grading: grading ?? contextState.grading,
			annotations: annotations ?? contextState.annotations,
			overallFeedback: overallFeedback ?? contextState.overallFeedback
		};
	}

	async function postDraft(revision: number, text: string): Promise<void> {
		if (!browser || !userId) {
			return;
		}
		await fetch(`/api/spark/sessions/${sessionId}/draft`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				revision,
				text
			})
		}).catch(() => undefined);
	}

	function scheduleDraftFeedback(): void {
		if (!browser) {
			return;
		}
		if (draftDebounceTimer) {
			clearTimeout(draftDebounceTimer);
		}
		const revision = ++lastDraftRevision;
		const nextText = draftText;
		draftDebounceTimer = setTimeout(() => {
			draftDebounceTimer = 0;
			if (screenState.status !== 'awaiting_student' || composerState.disabled) {
				return;
			}
			void postDraft(revision, nextText);
		}, 650);
	}

	async function submitTurn(
		payload:
			| { action: 'reply'; text: string; confidence: SparkTutorConfidence }
			| { action: 'hint'; hintLevel: SparkTutorHintLevel }
	): Promise<void> {
		requestError = null;
		sendingTurn = true;
		if (draftDebounceTimer) {
			clearTimeout(draftDebounceTimer);
			draftDebounceTimer = 0;
		}
		try {
			const response = await fetch(`/api/spark/sessions/${sessionId}/turn`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { error?: string } | null;
				requestError = payload?.error ?? 'Unable to continue the tutor session.';
				return;
			}
			draftText = '';
			inlineFeedbackMarkdown = '';
			composerState = {
				...composerState,
				disabled: true,
				placeholder: 'Spark is thinking...'
			};
			screenState = {
				...screenState,
				status: 'responding',
				updatedAt: new Date().toISOString()
			};
			await tick();
			syncComposerScroll();
		} catch {
			requestError = 'Unable to continue the tutor session.';
		} finally {
			sendingTurn = false;
		}
	}

	async function handleSubmit(): Promise<void> {
		const trimmed = draftText.trim();
		if (trimmed.length === 0 || composerState.disabled || sendingTurn) {
			return;
		}
		await submitTurn({
			action: 'reply',
			text: trimmed,
			confidence
		});
	}

	async function requestHint(level: SparkTutorHintLevel): Promise<void> {
		if (composerState.disabled || sendingTurn) {
			return;
		}
		await submitTurn({
			action: 'hint',
			hintLevel: level
		});
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		try {
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
		} catch (error) {
			console.warn('Failed to initialize tutor session auth guard', error);
		}
	});

	$effect(() => {
		if (didApplyInitialData) {
			return;
		}
		tutorMarkdown = data.initialWorkspace.tutorMarkdown;
		inlineFeedbackMarkdown = data.initialWorkspace.inlineFeedbackMarkdown;
		screenState = data.initialWorkspace.screenState;
		composerState = data.initialWorkspace.composerState;
		contextState = data.initialWorkspace.context;
		lastDraftRevision = data.session.latestDraftRevision;
		didApplyInitialData = true;
	});

	$effect(() => {
		if (!browser || !authReady || !userId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const filesRef = collection(db, 'users', userId, 'workspace', workspaceId, 'files');
		const filesQuery = query(filesRef, orderBy('path', 'asc'), limit(200));
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			filesQuery,
			(snapshot) => {
				const files: SparkAgentWorkspaceFile[] = [];
				for (const document of snapshot.docs) {
					const raw = document.data();
					const payload = {
						...raw,
						path:
							typeof raw.path === 'string' && raw.path.trim().length > 0
								? raw.path.trim()
								: decodeFileId(document.id)
					};
					const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
					if (!parsed.success) {
						continue;
					}
					files.push(parsed.data);
				}
				applyWorkspaceFiles(files);
			},
			(error) => {
				console.warn('Tutor workspace subscription failed', error);
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		draftText;
		void tick().then(() => {
			syncComposerScroll();
		});
	});

	const sessionStatusLabel = $derived(
		screenState.focusLabel
			? `${screenState.status} • ${screenState.focusLabel}`
			: screenState.status
	);

	const canSubmit = $derived(
		!composerState.disabled && !sendingTurn && draftText.trim().length > 0
	);
</script>

<svelte:head>
	<title>Spark · {data.session.title}</title>
</svelte:head>

<section class="tutor-session-page">
	<header class="session-header">
		<div>
			<p class="eyebrow">Experimental tutor</p>
			<h1>{data.session.title}</h1>
			<p class="subtitle">
				Problem {data.session.source.problemIndex}. {data.session.source.problemTitle}
			</p>
		</div>
		<div class="header-links">
			<a href={`/spark/grader/${data.session.source.runId}/${data.session.source.problemId}`}>
				Problem report
			</a>
			<a href="/spark/sessions">All sessions</a>
		</div>
	</header>

	<section class="hero-card">
		<div class="hero-topline">
			<span class="status-pill" data-status={screenState.status}>{screenState.status}</span>
			<span>{sessionStatusLabel}</span>
			{#if data.session.source.awardedMarks !== null && data.session.source.maxMarks !== null}
				<span>{data.session.source.awardedMarks}/{data.session.source.maxMarks}</span>
			{/if}
		</div>
		<div class="markdown-content tutor-panel">{@html renderMarkdown(tutorMarkdown)}</div>
	</section>

	<details class="context-card">
		<summary>Problem context</summary>
		<div class="context-grid">
			<section>
				<h2>Problem</h2>
				<div class="markdown-content">{@html renderMarkdown(contextState.problem)}</div>
			</section>
			<section>
				<h2>Student transcript</h2>
				<div class="markdown-content">{@html renderMarkdown(contextState.transcript)}</div>
			</section>
			<section>
				<h2>Grading</h2>
				<div class="markdown-content">{@html renderMarkdown(contextState.grading)}</div>
			</section>
			<section>
				<h2>Annotations</h2>
				<div class="markdown-content">{@html renderMarkdown(contextState.annotations)}</div>
			</section>
		</div>
	</details>

	<section class="composer-card">
		<div class="composer-header">
			<h2>Your next step</h2>
			{#if composerState.allowConfidence}
				<div class="confidence-row" role="radiogroup" aria-label="Confidence">
					{#if composerState.confidenceLabel}
						<span class="confidence-label">{composerState.confidenceLabel}</span>
					{/if}
					{#each ['low', 'mid', 'high'] as level}
						<button
							type="button"
							class:active={confidence === level}
							onclick={() => {
								confidence = level as SparkTutorConfidence;
							}}
						>
							{level}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="composer-shell">
			<div class="composer-backdrop" bind:this={backdropEl} aria-hidden="true">
				<div class="composer-mirror">
					<span class="typed-mirror">{draftText}</span><span class="ghost-inline"
						>{inlineFeedbackMarkdown}</span
					>
				</div>
			</div>
			<textarea
				bind:this={textareaEl}
				bind:value={draftText}
				placeholder={composerState.placeholder}
				disabled={composerState.disabled}
				rows="8"
				oninput={scheduleDraftFeedback}
				onscroll={syncComposerScroll}
			></textarea>
		</div>

		{#if requestError}
			<p class="error-text" role="alert">{requestError}</p>
		{/if}

		<div class="composer-actions">
			<div class="hint-actions">
				{#each composerState.hintButtons ?? [] as hintButton (hintButton.id)}
					<button
						type="button"
						class="secondary"
						disabled={composerState.disabled || sendingTurn}
						onclick={() => requestHint(hintButton.hintLevel)}
					>
						{hintButton.label}
					</button>
				{/each}
			</div>
			<button type="button" class="primary" disabled={!canSubmit} onclick={handleSubmit}>
				{composerState.submitLabel ?? 'Send'}
			</button>
		</div>
	</section>
</section>

<style lang="postcss">
	.tutor-session-page {
		width: min(72rem, 92vw);
		margin: 0 auto 3rem;
		padding-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.session-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		font-weight: 600;
		color: rgba(59, 130, 246, 0.85);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.45rem, 3vw, 2rem);
	}

	.subtitle {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.header-links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.header-links a {
		display: inline-flex;
		align-items: center;
		padding: 0.42rem 0.7rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		text-decoration: none;
		color: inherit;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		font-weight: 600;
	}

	.hero-card,
	.context-card,
	.composer-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.hero-topline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
		margin-bottom: 0.8rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border) 70%, transparent);
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.status-pill[data-status='awaiting_student'] {
		background: color-mix(in srgb, #2563eb 16%, transparent);
		color: color-mix(in srgb, #1d4ed8 92%, black 5%);
	}

	.status-pill[data-status='responding'] {
		background: color-mix(in srgb, #f59e0b 18%, transparent);
		color: color-mix(in srgb, #92400e 92%, black 5%);
	}

	.status-pill[data-status='completed'] {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: color-mix(in srgb, #166534 90%, black 6%);
	}

	.tutor-panel :global(p:first-child) {
		margin-top: 0;
	}

	.context-card summary {
		cursor: pointer;
		font-weight: 600;
	}

	.context-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 1rem;
		margin-top: 0.9rem;
	}

	.context-grid h2,
	.composer-header h2 {
		margin: 0 0 0.55rem;
		font-size: 1rem;
	}

	.composer-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		margin-bottom: 0.8rem;
	}

	.confidence-row {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.confidence-label {
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.confidence-row button,
	.composer-actions button {
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		padding: 0.5rem 0.85rem;
		background: color-mix(in srgb, var(--background) 70%, transparent);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.confidence-row button.active {
		background: color-mix(in srgb, #2563eb 12%, var(--background));
		border-color: color-mix(in srgb, #2563eb 45%, var(--border));
	}

	.composer-shell {
		position: relative;
		min-height: 12rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--background) 72%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		overflow: hidden;
	}

	.composer-backdrop,
	textarea {
		width: 100%;
		min-height: 12rem;
		padding: 1rem;
		font: inherit;
		line-height: 1.55;
		letter-spacing: inherit;
		white-space: pre-wrap;
		overflow: auto;
		box-sizing: border-box;
	}

	.composer-backdrop {
		position: absolute;
		inset: 0;
		pointer-events: none;
		color: transparent;
	}

	.composer-mirror {
		white-space: pre-wrap;
		word-break: break-word;
	}

	.typed-mirror {
		color: transparent;
	}

	.ghost-inline {
		color: color-mix(in srgb, var(--foreground) 42%, transparent);
	}

	textarea {
		position: relative;
		z-index: 1;
		resize: vertical;
		border: 0;
		outline: none;
		background: transparent;
		color: inherit;
	}

	textarea:disabled {
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
		cursor: not-allowed;
	}

	.composer-actions {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.8rem;
	}

	.hint-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.composer-actions button.primary {
		background: color-mix(in srgb, #2563eb 14%, var(--background));
		border-color: color-mix(in srgb, #2563eb 48%, var(--border));
	}

	.composer-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error-text {
		margin: 0.7rem 0 0;
		color: #b91c1c;
	}

	.markdown-content :global(p:last-child) {
		margin-bottom: 0;
	}

	@media (max-width: 700px) {
		.session-header,
		.composer-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
