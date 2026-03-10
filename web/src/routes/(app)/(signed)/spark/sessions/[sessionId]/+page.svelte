<script lang="ts">
	import { browser } from '$app/environment';
	import { renderMarkdown } from '$lib/markdown';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import type {
		SparkAgentWorkspaceFile,
		SparkTutorReviewState,
		SparkTutorScreenState
	} from '@spark/schemas';
	import { SparkAgentWorkspaceFileSchema, SparkTutorReviewStateSchema } from '@spark/schemas';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { getContext, onMount } from 'svelte';
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
	let screenState = $state<SparkTutorScreenState>({
		status: 'booting',
		title: '',
		updatedAt: new Date(0).toISOString()
	});
	let reviewState = $state<SparkTutorReviewState>({
		transcriptLines: [],
		threads: [],
		updatedAt: new Date(0).toISOString()
	});
	let contextState = $state<WorkspaceContext>({
		problem: '',
		officialSolution: '',
		transcript: '',
		grading: '',
		annotations: '',
		overallFeedback: ''
	});
	let requestError = $state<string | null>(null);
	let submittingThreadId = $state<string | null>(null);
	let threadDrafts = $state<Record<string, string>>({});
	let didApplyInitialData = $state(false);

	function decodeFileId(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	function applyWorkspaceFiles(files: SparkAgentWorkspaceFile[]): void {
		const textByPath = new Map<string, string>();
		for (const file of files) {
			if ('content' in file && typeof file.content === 'string') {
				textByPath.set(file.path, file.content);
			}
		}

		const sessionStateRaw = textByPath.get('state/session.json');
		if (sessionStateRaw) {
			try {
				screenState = JSON.parse(sessionStateRaw);
			} catch {
				// Keep previous value if the workspace doc is mid-write.
			}
		}

		const reviewStateRaw = textByPath.get('state/review.json');
		if (reviewStateRaw) {
			try {
				reviewState = SparkTutorReviewStateSchema.parse(JSON.parse(reviewStateRaw));
			} catch {
				// Keep previous value if the workspace doc is mid-write.
			}
		}

		const problem = textByPath.get('context/problem.md');
		const officialSolution = textByPath.get('context/official-solution.md');
		const transcript = textByPath.get('context/student-transcript.md');
		const grading = textByPath.get('context/grading.md');
		const overallFeedback = textByPath.get('context/overall-feedback.md');
		contextState = {
			problem: problem ?? contextState.problem,
			officialSolution: officialSolution ?? contextState.officialSolution,
			transcript: transcript ?? contextState.transcript,
			grading: grading ?? contextState.grading,
			annotations: contextState.annotations,
			overallFeedback: overallFeedback ?? contextState.overallFeedback
		};
	}

	function setThreadDraft(threadId: string, value: string): void {
		threadDrafts = {
			...threadDrafts,
			[threadId]: value
		};
	}

	function clearThreadDraft(threadId: string): void {
		const nextDrafts = { ...threadDrafts };
		delete nextDrafts[threadId];
		threadDrafts = nextDrafts;
	}

	function getThreadDraft(threadId: string): string {
		return threadDrafts[threadId] ?? '';
	}

	function formatThreadStatus(status: 'open' | 'responding' | 'resolved'): string {
		if (status === 'resolved') {
			return 'Resolved';
		}
		if (status === 'responding') {
			return 'Reviewing';
		}
		return 'Open';
	}

	async function submitThreadReply(threadId: string): Promise<void> {
		const submittedDraft = getThreadDraft(threadId);
		const draft = submittedDraft.trim();
		if (draft.length === 0 || submittingThreadId || screenState.status === 'responding') {
			return;
		}

		submittingThreadId = threadId;
		requestError = null;
		setThreadDraft(threadId, '');

		try {
			const response = await fetch(`/api/spark/sessions/${sessionId}/turn`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					action: 'reply',
					threadId,
					text: draft
				})
			});

			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			if (!response.ok) {
				setThreadDraft(threadId, submittedDraft);
				requestError = payload?.error ?? 'Unable to submit your thread reply.';
				return;
			}

			clearThreadDraft(threadId);
		} catch {
			setThreadDraft(threadId, submittedDraft);
			requestError = 'Unable to submit your thread reply.';
		} finally {
			submittingThreadId = null;
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
		screenState = data.initialWorkspace.screenState;
		reviewState = data.initialWorkspace.reviewState;
		contextState = data.initialWorkspace.context;
		didApplyInitialData = true;
	});

	$effect(() => {
		if (!browser || !authReady || !userId) {
			return;
		}
		let stop: (() => void) | null = null;
		let cancelled = false;
		void import('firebase/firestore')
			.then(({ collection, getFirestore, limit, onSnapshot, orderBy, query }) => {
				if (cancelled) {
					return;
				}
				const db = getFirestore(getFirebaseApp());
				const filesRef = collection(db, 'users', userId, 'workspace', workspaceId, 'files');
				const filesQuery = query(filesRef, orderBy('path', 'asc'), limit(200));
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
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				console.warn('Tutor workspace subscription failed', error);
			});
		return () => {
			cancelled = true;
			stop?.();
		};
	});

	const reviewSummary = $derived.by(() => {
		let resolved = 0;
		let responding = 0;
		for (const thread of reviewState.threads) {
			if (thread.status === 'resolved') {
				resolved += 1;
				continue;
			}
			if (thread.status === 'responding') {
				responding += 1;
			}
		}
		const total = reviewState.threads.length;
		return {
			total,
			resolved,
			responding,
			open: total - resolved - responding,
			allResolved: total > 0 && resolved === total
		};
	});

	const threadsByLine = $derived.by(() => {
		const map = new Map<number, SparkTutorReviewState['threads']>();
		for (const thread of reviewState.threads) {
			if (thread.anchor.kind !== 'transcript_line') {
				continue;
			}
			const existing = map.get(thread.anchor.lineNumber) ?? [];
			map.set(thread.anchor.lineNumber, [...existing, thread]);
		}
		return map;
	});

	const transcriptRows = $derived.by(() =>
		reviewState.transcriptLines.map((line) => ({
			...line,
			threads: threadsByLine.get(line.lineNumber) ?? []
		}))
	);

	const problemThreads = $derived.by(() =>
		reviewState.threads.filter((thread) => thread.anchor.kind === 'problem')
	);

	const busy = $derived(submittingThreadId !== null || screenState.status === 'responding');
</script>

<svelte:head>
	<title>Spark · {data.session.title}</title>
</svelte:head>

<section class="tutor-review-page">
	<header class="page-header">
		<div>
			<p class="eyebrow">Tutor review</p>
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

	<section class="summary-shell">
		<div class="summary-card">
			<div class="summary-topline">
				<span class="status-pill" data-status={screenState.status}>{screenState.status}</span>
				{#if screenState.focusLabel}
					<span>{screenState.focusLabel}</span>
				{/if}
				{#if data.session.source.awardedMarks !== null && data.session.source.maxMarks !== null}
					<span>{data.session.source.awardedMarks}/{data.session.source.maxMarks}</span>
				{/if}
			</div>
			<h2>Review progress</h2>
			<p class="summary-copy">
				{#if reviewSummary.total === 0}
					No student response is needed for this problem.
				{:else if reviewSummary.allResolved}
					Every review thread on this problem is resolved.
				{:else}
					Reply on each review thread until the reviewer marks it resolved with a green check.
				{/if}
			</p>
			<div class="progress-bar" aria-hidden="true">
				<div
					class="progress-bar__fill"
					style={`width: ${
						reviewSummary.total === 0
							? 100
							: Math.round((reviewSummary.resolved / reviewSummary.total) * 100)
					}%`}
				></div>
			</div>
			<div class="summary-stats">
				<div>
					<span>Total threads</span>
					<p>{reviewSummary.total}</p>
				</div>
				<div>
					<span>Open</span>
					<p>{reviewSummary.open}</p>
				</div>
				<div>
					<span>Resolved</span>
					<p>{reviewSummary.resolved}</p>
				</div>
			</div>
		</div>

		<aside class="reference-rail">
			<section class="reference-card">
				<h2>Official problem formulation</h2>
				<div class="markdown-content">{@html renderMarkdown(contextState.problem)}</div>
			</section>

			<details class="reference-card reference-card--details">
				<summary>Reference notes</summary>
				<div class="reference-card__body">
					<section>
						<h3>Grading summary</h3>
						<div class="markdown-content">{@html renderMarkdown(contextState.grading)}</div>
					</section>
					<section>
						<h3>Official solution</h3>
						<div class="markdown-content">{@html renderMarkdown(contextState.officialSolution)}</div>
					</section>
					<section>
						<h3>Overall feedback</h3>
						<div class="markdown-content">{@html renderMarkdown(contextState.overallFeedback)}</div>
					</section>
				</div>
			</details>
		</aside>
	</section>

	{#if requestError}
		<p class="error-text" role="alert">{requestError}</p>
	{/if}

	<section class="transcript-card">
		<header class="section-header">
			<div>
				<p class="section-kicker">Student work</p>
				<h2>Transcript review</h2>
			</div>
		</header>

		{#if transcriptRows.length === 0}
			<p class="empty-state">The grader did not produce a numbered transcript for this problem.</p>
		{:else}
			<div class="transcript-list">
				{#each transcriptRows as line (line.lineNumber)}
					<article class="transcript-line">
						<div class="line-number">{line.lineNumber}</div>
						<div class="line-main">
							<div class="line-markdown markdown-content">{@html renderMarkdown(line.markdown)}</div>

							{#if line.threads.length > 0}
								<div class="thread-stack">
									{#each line.threads as thread (thread.id)}
										<article class="review-thread" data-status={thread.status}>
											<header class="thread-header">
												<div>
													<p class="thread-label">{thread.label}</p>
													{#if thread.excerpt}
														<p class="thread-excerpt">{thread.excerpt}</p>
													{/if}
												</div>
												{#if thread.status === 'resolved'}
													<span class="thread-status thread-status--resolved">
														<span class="thread-check">✓</span> Resolved
													</span>
												{:else}
													<span class="thread-status">{formatThreadStatus(thread.status)}</span>
												{/if}
											</header>

											<div class="thread-messages">
												{#each thread.messages as message (message.id)}
													<div class="thread-message" data-author={message.author}>
														<p class="message-author">
															{message.author === 'assistant' ? 'Reviewer' : 'Student'}
														</p>
														<div class="message-body markdown-content">
															{@html renderMarkdown(message.markdown)}
														</div>
													</div>
												{/each}
											</div>

											{#if thread.status !== 'resolved'}
												<form
													class="thread-composer"
													onsubmit={(event) => {
														event.preventDefault();
														void submitThreadReply(thread.id);
													}}
												>
													<label for={`reply-${thread.id}`}>Your response</label>
													<textarea
														id={`reply-${thread.id}`}
														rows="4"
														placeholder="Explain your correction, justification, or revised reasoning."
														value={getThreadDraft(thread.id)}
														disabled={busy}
														oninput={(event) => {
															const target = event.currentTarget;
															if (!(target instanceof HTMLTextAreaElement)) {
																return;
															}
															setThreadDraft(thread.id, target.value);
														}}
													></textarea>
													<div class="thread-actions">
														<button
															type="submit"
															disabled={busy || getThreadDraft(thread.id).trim().length === 0}
														>
															{submittingThreadId === thread.id ? 'Reviewing…' : 'Submit reply'}
														</button>
														{#if thread.status === 'responding'}
															<span class="thread-note">Spark is reviewing this thread…</span>
														{/if}
													</div>
												</form>
											{:else}
												<div class="resolved-banner">
													<span class="thread-check">✓</span>
													<span>This comment is resolved.</span>
												</div>
											{/if}
										</article>
									{/each}
								</div>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	{#if problemThreads.length > 0}
		<section class="problem-comments-card">
			<header class="section-header">
				<div>
					<p class="section-kicker">Problem-level review</p>
					<h2>General comments</h2>
				</div>
			</header>

			<div class="thread-stack">
				{#each problemThreads as thread (thread.id)}
					<article class="review-thread" data-status={thread.status}>
						<header class="thread-header">
							<div>
								<p class="thread-label">{thread.label}</p>
							</div>
							{#if thread.status === 'resolved'}
								<span class="thread-status thread-status--resolved">
									<span class="thread-check">✓</span> Resolved
								</span>
							{:else}
								<span class="thread-status">{formatThreadStatus(thread.status)}</span>
							{/if}
						</header>

						<div class="thread-messages">
							{#each thread.messages as message (message.id)}
								<div class="thread-message" data-author={message.author}>
									<p class="message-author">
										{message.author === 'assistant' ? 'Reviewer' : 'Student'}
									</p>
									<div class="message-body markdown-content">
										{@html renderMarkdown(message.markdown)}
									</div>
								</div>
							{/each}
						</div>

						{#if thread.status !== 'resolved'}
							<form
								class="thread-composer"
								onsubmit={(event) => {
									event.preventDefault();
									void submitThreadReply(thread.id);
								}}
							>
								<label for={`reply-${thread.id}`}>Your response</label>
								<textarea
									id={`reply-${thread.id}`}
									rows="4"
									placeholder="Explain how you would revise the full problem response."
									value={getThreadDraft(thread.id)}
									disabled={busy}
									oninput={(event) => {
										const target = event.currentTarget;
										if (!(target instanceof HTMLTextAreaElement)) {
											return;
										}
										setThreadDraft(thread.id, target.value);
									}}
								></textarea>
								<div class="thread-actions">
									<button
										type="submit"
										disabled={busy || getThreadDraft(thread.id).trim().length === 0}
									>
										{submittingThreadId === thread.id ? 'Reviewing…' : 'Submit reply'}
									</button>
								</div>
							</form>
						{:else}
							<div class="resolved-banner">
								<span class="thread-check">✓</span>
								<span>This comment is resolved.</span>
							</div>
						{/if}
					</article>
				{/each}
			</div>
		</section>
	{/if}
</section>

<style lang="postcss">
	.tutor-review-page {
		width: min(84rem, 94vw);
		margin: 0 auto 3rem;
		padding-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.eyebrow,
	.section-kicker {
		margin: 0 0 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		font-weight: 700;
		color: #155dfc;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 3vw, 2.1rem);
	}

	h2 {
		margin: 0;
		font-size: 1.12rem;
	}

	.subtitle,
	.summary-copy,
	.thread-excerpt,
	.empty-state {
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.subtitle,
	.summary-copy {
		margin: 0.35rem 0 0;
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
		font-weight: 600;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.summary-shell {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 0.9fr);
		gap: 1rem;
		align-items: start;
	}

	.summary-card,
	.reference-card,
	.transcript-card,
	.problem-comments-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		padding: 1rem;
	}

	.reference-rail {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.summary-topline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		align-items: center;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
		margin-bottom: 0.85rem;
	}

	.status-pill,
	.thread-status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.22rem 0.55rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border) 70%, transparent);
		color: color-mix(in srgb, var(--foreground) 78%, transparent);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.status-pill[data-status='awaiting_student'] {
		background: color-mix(in srgb, #f59e0b 14%, transparent);
		color: color-mix(in srgb, #92400e 88%, black 6%);
	}

	.status-pill[data-status='responding'] {
		background: color-mix(in srgb, #0ea5e9 16%, transparent);
		color: color-mix(in srgb, #075985 90%, black 6%);
	}

	.status-pill[data-status='completed'],
	.thread-status--resolved {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: color-mix(in srgb, #166534 90%, black 6%);
	}

	.progress-bar {
		margin-top: 1rem;
		height: 0.72rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border) 55%, transparent);
		overflow: hidden;
	}

	.progress-bar__fill {
		height: 100%;
		background:
			linear-gradient(90deg, color-mix(in srgb, #16a34a 72%, white 10%), #22c55e);
	}

	.summary-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
		margin-top: 1rem;
	}

	.summary-stats span {
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
	}

	.summary-stats p {
		margin: 0.2rem 0 0;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.reference-card :global(p:first-child) {
		margin-top: 0;
	}

	.reference-card--details summary {
		cursor: pointer;
		font-weight: 700;
	}

	.reference-card__body {
		margin-top: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.reference-card__body h3 {
		margin: 0 0 0.45rem;
		font-size: 0.95rem;
	}

	.error-text {
		margin: 0;
		color: color-mix(in srgb, var(--destructive) 78%, black 8%);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.transcript-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.transcript-line {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.9rem;
		align-items: start;
	}

	.line-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.7rem;
		background: color-mix(in srgb, #0f172a 90%, white 6%);
		color: white;
		font-weight: 800;
	}

	.line-main {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.line-markdown {
		border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
		border-radius: 0.85rem;
		padding: 0.9rem;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--background) 95%, white 2%),
				color-mix(in srgb, var(--card) 92%, transparent)
			);
	}

	.thread-stack {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.review-thread {
		border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
		border-left-width: 4px;
		border-radius: 0.9rem;
		padding: 0.9rem;
		background: color-mix(in srgb, var(--background) 70%, transparent);
	}

	.review-thread[data-status='open'] {
		border-left-color: #f59e0b;
	}

	.review-thread[data-status='responding'] {
		border-left-color: #0ea5e9;
	}

	.review-thread[data-status='resolved'] {
		border-left-color: #16a34a;
		background: color-mix(in srgb, #16a34a 5%, var(--background));
	}

	.thread-header {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: flex-start;
	}

	.thread-label {
		margin: 0;
		font-weight: 700;
	}

	.thread-excerpt {
		margin: 0.2rem 0 0;
		font-size: 0.88rem;
	}

	.thread-messages {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-top: 0.9rem;
	}

	.thread-message {
		border-radius: 0.85rem;
		padding: 0.75rem 0.8rem;
	}

	.thread-message[data-author='assistant'] {
		background: color-mix(in srgb, #155dfc 7%, var(--background));
	}

	.thread-message[data-author='student'] {
		background: color-mix(in srgb, #0f172a 5%, var(--background));
	}

	.message-author {
		margin: 0 0 0.45rem;
		font-size: 0.73rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	.thread-composer {
		margin-top: 0.95rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.thread-composer label {
		font-size: 0.82rem;
		font-weight: 600;
	}

	.thread-composer textarea {
		width: 100%;
		min-height: 7rem;
		border-radius: 0.85rem;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		background: color-mix(in srgb, var(--background) 88%, transparent);
		color: inherit;
		padding: 0.8rem 0.9rem;
		font: inherit;
		resize: vertical;
	}

	.thread-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.thread-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		border: none;
		background: #155dfc;
		color: white;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.thread-actions button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.thread-note {
		font-size: 0.84rem;
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	.resolved-banner {
		margin-top: 0.9rem;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.7rem;
		border-radius: 999px;
		background: color-mix(in srgb, #16a34a 14%, transparent);
		color: color-mix(in srgb, #166534 88%, black 8%);
		font-weight: 700;
	}

	.thread-check {
		font-weight: 900;
	}

	.markdown-content :global(p) {
		margin: 0;
	}

	.markdown-content :global(p + p) {
		margin-top: 0.55rem;
	}

	.markdown-content :global(ol),
	.markdown-content :global(ul) {
		margin: 0.45rem 0 0.55rem 1.2rem;
		padding: 0;
		list-style-position: outside;
	}

	.markdown-content :global(ul) {
		list-style: disc;
	}

	.markdown-content :global(ol) {
		list-style: decimal;
	}

	.markdown-content :global(li + li) {
		margin-top: 0.25rem;
	}

	@media (max-width: 960px) {
		.summary-shell {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 700px) {
		.page-header,
		.section-header {
			flex-direction: column;
		}

		.transcript-line {
			grid-template-columns: 1fr;
		}

		.line-number {
			width: 2.2rem;
		}

		.summary-stats {
			grid-template-columns: 1fr;
		}
	}
</style>
