<script lang="ts">
	import { browser } from '$app/environment';
	import { renderMarkdown } from '$lib/markdown';
	import { PaperSheet } from '$lib/components/paper-sheet/index.js';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import type {
		PaperSheetFeedbackThread,
		SparkAgentWorkspaceFile,
		SparkGraderWorksheetReport,
		SparkTutorReviewState
	} from '@spark/schemas';
	import {
		SparkAgentWorkspaceFileSchema,
		SparkGraderWorksheetReportSchema,
		SparkTutorReviewStateSchema
	} from '@spark/schemas';
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
	import { getContext, onMount, untrack } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ClientUser = NonNullable<PageData['user']> | null;

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);
	const initialReport = untrack(() => data.report);
	const initialReviewState = untrack(
		() => data.interaction?.reviewState ?? data.initialReviewState ?? null
	);
	const initialInteractionSessionId = untrack(() => data.interaction?.id ?? null);
	const initialInteractionWorkspaceId = untrack(() => data.interaction?.workspaceId ?? null);

	let authReady = $state(false);
	let report = $state<SparkGraderWorksheetReport | null>(initialReport);
	let reviewState = $state<SparkTutorReviewState | null>(initialReviewState);
	let interactionSessionId = $state<string | null>(initialInteractionSessionId);
	let interactionWorkspaceId = $state<string | null>(initialInteractionWorkspaceId);
	let requestError = $state<string | null>(null);
	let submittingQuestionId = $state<string | null>(null);

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

		const reviewStateRaw = textByPath.get('state/review.json');
		if (reviewStateRaw) {
			try {
				reviewState = SparkTutorReviewStateSchema.parse(JSON.parse(reviewStateRaw));
			} catch {
				// Ignore transient partial writes.
			}
		}

		const reportRaw = textByPath.get('context/report.json');
		if (reportRaw) {
			try {
				report = SparkGraderWorksheetReportSchema.parse(JSON.parse(reportRaw));
			} catch {
				// Ignore transient partial writes.
			}
		}
	}

	async function submitQuestionReply(questionId: string, draft: string): Promise<void> {
		if (submittingQuestionId || data.run.status !== 'done') {
			return;
		}
		submittingQuestionId = questionId;
		requestError = null;

		try {
			const response = await fetch(`/api/spark/sheets/${data.run.id}/turn`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					action: 'reply',
					questionId,
					text: draft
				})
			});

			const payload = (await response.json().catch(() => null)) as
				| {
						error?: string;
						sessionId?: string;
						workspaceId?: string;
				  }
				| null;
			if (!response.ok) {
				requestError = payload?.error ?? 'Unable to send your worksheet reply.';
			} else {
				if (payload?.sessionId) {
					interactionSessionId = payload.sessionId;
				}
				if (payload?.workspaceId) {
					interactionWorkspaceId = payload.workspaceId;
				}
			}
		} catch {
			requestError = 'Unable to send your worksheet reply.';
		} finally {
			submittingQuestionId = null;
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
			console.warn('Failed to initialize sheet auth guard', error);
		}
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !interactionWorkspaceId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const filesRef = collection(db, 'users', userId, 'workspace', interactionWorkspaceId, 'files');
		const filesQuery = query(filesRef, orderBy('path', 'asc'), limit(400));
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
				console.warn('Sheet workspace subscription failed', error);
			}
		);
		return () => {
			stop?.();
		};
	});

	const feedbackThreads = $derived.by((): Record<string, PaperSheetFeedbackThread> => {
		const threads: Record<string, PaperSheetFeedbackThread> = {};
		if (!reviewState) {
			return threads;
		}
		for (const [questionId, thread] of Object.entries(reviewState.threads)) {
			threads[questionId] = {
				status: thread.status,
				turns: thread.messages.map((message) => ({
					id: message.id,
					speaker: message.author === 'assistant' ? 'tutor' : 'student',
					text: message.markdown
				}))
			};
		}
		return threads;
	});

	const feedbackSending = $derived.by(() =>
		submittingQuestionId ? { [submittingQuestionId]: true } : {}
	);

	const referenceItems = $derived.by(() => {
		const references = report?.references ?? {};
		return [
			{
				key: 'problem',
				title: 'Problem context',
				value: references.officialProblemMarkdown ?? references.problemMarkdown ?? null
			},
			{
				key: 'solution',
				title: 'Solution notes',
				value: references.officialSolutionMarkdown ?? null
			},
			{
				key: 'grading',
				title: 'Marking notes',
				value: references.gradingMarkdown ?? null
			},
			{
				key: 'overall',
				title: 'Overall feedback',
				value: references.overallFeedbackMarkdown ?? null
			}
		].filter((item) => item.value);
	});
</script>

<svelte:head>
	<title>Spark · {data.run.display.title}</title>
</svelte:head>

<section class="sheet-page">
	<header class="page-header">
		<div>
			<p class="eyebrow">Worksheet feedback</p>
			<h1>{data.run.display.title}</h1>
			{#if data.run.display.metaLine}
				<p class="subtitle">{data.run.display.metaLine}</p>
			{/if}
		</div>
		<div class="header-links">
			<a href="/spark/sheets">All sheets</a>
			<a href="/spark">Chat</a>
		</div>
	</header>

	<section class="summary-card">
		<div class="summary-topline">
			<span class="status-pill" data-status={data.run.status}>
				{data.run.status === 'done'
					? 'Ready'
					: data.run.status === 'executing'
						? 'Grading'
						: data.run.status === 'created'
							? 'Queued'
							: data.run.status === 'failed'
								? 'Failed'
								: 'Stopped'}
			</span>
			<span>Updated {data.run.updatedAt}</span>
		</div>

		{#if data.run.error}
			<p class="error-text">{data.run.error}</p>
		{:else if data.run.display.summaryMarkdown}
			<div class="summary-text markdown-content">
				{@html renderMarkdown(data.run.display.summaryMarkdown)}
			</div>
		{/if}

		{#if data.run.totals}
			<p class="summary-score">
				Marks: {data.run.totals.awardedMarks}/{data.run.totals.maxMarks}
				{#if data.run.totals.percentage !== null}
					· {data.run.totals.percentage.toFixed(1)}%
				{/if}
			</p>
		{/if}
	</section>

	{#if requestError}
		<p class="action-error" role="alert">{requestError}</p>
	{/if}

	{#if report && reviewState}
		<div class="sheet-shell">
			<PaperSheet
				sheet={reviewState.sheet}
				answers={reviewState.answers}
				review={reviewState.review}
				reviewMode="live"
				editable={false}
				allowFeedbackReplies={data.run.status === 'done'}
				feedbackThreads={feedbackThreads}
				feedbackSending={feedbackSending}
				onReplyToTutor={(questionId, draft) => {
					void submitQuestionReply(questionId, draft);
				}}
			/>
		</div>
	{:else}
		<section class="pending-card">
			<h2>This sheet is still being graded</h2>
			<p>The worksheet artifact has not been published yet. Refresh this page once the grading step finishes.</p>
		</section>
	{/if}

	{#if referenceItems.length > 0 || report?.references?.paperUrl || report?.references?.markSchemeUrl}
		<section class="reference-shell">
			<h2>Reference notes</h2>

			{#if report?.references?.paperUrl || report?.references?.markSchemeUrl}
				<div class="reference-links">
					{#if report?.references?.paperUrl}
						<a href={report.references.paperUrl} target="_blank" rel="noreferrer">Paper source</a>
					{/if}
					{#if report?.references?.markSchemeUrl}
						<a href={report.references.markSchemeUrl} target="_blank" rel="noreferrer">
							Mark scheme
						</a>
					{/if}
				</div>
			{/if}

			<div class="reference-grid">
				{#each referenceItems as item (item.key)}
					<section class="reference-card">
						<h3>{item.title}</h3>
						<div class="markdown-content">
							{@html renderMarkdown(item.value ?? '')}
						</div>
					</section>
				{/each}
			</div>
		</section>
	{/if}
</section>

<style lang="postcss">
	.sheet-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(96vw, 96rem);
		margin: 0 auto 3rem;
		padding-top: 1.2rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
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
		font-size: clamp(1.4rem, 2.8vw, 2rem);
	}

	.subtitle {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.header-links,
	.reference-links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.header-links a,
	.reference-links a {
		display: inline-flex;
		align-items: center;
		padding: 0.42rem 0.7rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		text-decoration: none;
		color: inherit;
		font-weight: 600;
		background: color-mix(in srgb, var(--card) 95%, transparent);
	}

	.summary-card,
	.pending-card,
	.reference-shell {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.summary-topline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		align-items: center;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.22rem 0.55rem;
		border-radius: 999px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--border) 70%, transparent);
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
	}

	.status-pill[data-status='done'] {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: color-mix(in srgb, #166534 90%, black 6%);
	}

	.status-pill[data-status='executing'] {
		background: color-mix(in srgb, #0ea5e9 16%, transparent);
		color: color-mix(in srgb, #075985 90%, black 6%);
	}

	.status-pill[data-status='failed'] {
		background: color-mix(in srgb, var(--destructive) 14%, transparent);
		color: color-mix(in srgb, var(--destructive) 82%, black 8%);
	}

	.summary-text,
	.summary-score,
	.error-text,
	.pending-card p {
		margin: 0.75rem 0 0;
	}

	.action-error {
		margin: 0;
		color: var(--destructive);
		font-weight: 600;
	}

	.sheet-shell {
		overflow: auto;
		padding-bottom: 0.2rem;
	}

	.reference-shell h2,
	.pending-card h2 {
		margin: 0;
	}

	.reference-grid {
		display: grid;
		gap: 0.85rem;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		margin-top: 0.85rem;
	}

	.reference-card {
		border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
		border-radius: 0.9rem;
		padding: 0.85rem;
		background: color-mix(in srgb, var(--background) 94%, var(--card));
	}

	.reference-card h3 {
		margin: 0 0 0.55rem;
	}

	@media (max-width: 700px) {
		.page-header {
			flex-direction: column;
		}
	}
</style>
