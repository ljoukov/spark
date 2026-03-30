<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { doc, getFirestore, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import {
		SessionSchema,
		SessionStateSchema,
		SparkGraderRunSchema,
		type Session,
		type SessionState,
		type SessionStatus,
		type SparkAgentRunCard,
		type SparkGraderRun,
		type SparkSheetPhase
	} from '@spark/schemas';
	import { formatRelativeAge } from '$lib/utils/relativeAge';
	import type { TaskCardPreview } from './taskCardPreview';

	let {
		userId = '',
		runCard,
		preview = null
	}: {
		userId?: string;
		runCard: SparkAgentRunCard;
		preview?: TaskCardPreview | null;
	} = $props();

	let lesson = $state<Session | null>(null);
	let lessonState = $state<SessionState | null>(null);
	let graderRun = $state<SparkGraderRun | null>(null);
	let liveStatusError = $state<string | null>(null);
	let relativeAgeNow = $state(Date.now());

	function deriveLessonStatus(
		session: Session | null,
		state: SessionState | null
	): SessionStatus {
		if (!session) {
			return 'generating';
		}
		const storedStatus = session.status ?? 'ready';
		if (storedStatus === 'generating' || storedStatus === 'error') {
			return storedStatus;
		}
		const planItems = session.plan ?? [];
		if (planItems.length === 0) {
			return storedStatus;
		}
		const planStatuses = planItems.map((item) => state?.items[item.id]?.status ?? 'not_started');
		const allCompleted =
			planStatuses.length > 0 && planStatuses.every((status) => status === 'completed');
		if (allCompleted) {
			return 'completed';
		}
		const hasProgress = planStatuses.some((status) => status !== 'not_started');
		if (hasProgress) {
			return 'in_progress';
		}
		return 'ready';
	}

	function countLessonProgress(
		session: Session | null,
		state: SessionState | null
	): { completed: number; total: number } {
		const planItems = session?.plan ?? [];
		let completed = 0;
		for (const item of planItems) {
			if (state?.items[item.id]?.status === 'completed') {
				completed += 1;
			}
		}
		return { completed, total: planItems.length };
	}

	function formatPercent(value: number | undefined): string {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '0%';
		}
		return `${Math.round(value).toString()}%`;
	}

	function formatMarks(awarded: number, max: number): string {
		return `${awarded.toString()}/${max.toString()}`;
	}

	function pluralise(word: string, count: number): string {
		return count === 1 ? word : `${word}s`;
	}

	const previewState = $derived.by(() =>
		preview && preview.kind === runCard.kind ? preview : null
	);

	const lessonStatus = $derived.by(() =>
		runCard.kind === 'lesson'
			? previewState?.kind === 'lesson'
				? previewState.status
				: deriveLessonStatus(lesson, lessonState)
			: null
	);

	const lessonProgress = $derived.by(() =>
		runCard.kind === 'lesson'
			? previewState?.kind === 'lesson'
				? (previewState.progress ?? { completed: 0, total: 0 })
				: countLessonProgress(lesson, lessonState)
			: { completed: 0, total: 0 }
	);

	const graderStatus = $derived.by(() =>
		runCard.kind === 'grader'
			? previewState?.kind === 'grader'
				? previewState.status
				: (graderRun?.status ?? 'created')
			: null
	);

	const graderSheetPhase = $derived.by((): SparkSheetPhase | null => {
		if (runCard.kind !== 'grader') {
			return null;
		}
		if (previewState?.kind === 'grader') {
			return previewState.sheetPhase ?? null;
		}
		if (graderRun?.sheetPhase) {
			return graderRun.sheetPhase;
		}
		if (graderRun?.status === 'done' && graderRun?.totals) {
			return 'graded';
		}
		return null;
	});

	const statusLabel = $derived.by(() => {
		if (runCard.kind === 'lesson') {
			switch (lessonStatus) {
				case 'generating':
					return 'Creating lesson';
				case 'ready':
					return 'Ready';
				case 'in_progress':
					return 'In progress';
				case 'completed':
					return 'Completed';
				case 'error':
					return 'Failed';
				case null:
					return 'Creating lesson';
			}
		}
		if (graderStatus === 'failed') {
			return 'Failed';
		}
		if (graderStatus === 'stopped') {
			return 'Stopped';
		}
		if (graderSheetPhase === 'building') {
			return graderStatus === 'created' ? 'Queued' : 'Preparing sheet';
		}
		if (graderSheetPhase === 'solving') {
			return 'Ready to solve';
		}
		if (graderSheetPhase === 'graded') {
			return 'Graded';
		}
		switch (graderStatus) {
			case 'created':
				return 'Queued';
			case 'executing':
				return 'Grading';
			case 'done':
				return 'Ready';
			case null:
				return 'Queued';
		}
	});

	const showSpinner = $derived.by(() => {
		if (previewState?.kind === 'lesson') {
			return previewState.status === 'generating';
		}
		if (previewState?.kind === 'grader') {
			return previewState.status === 'created' || previewState.status === 'executing';
		}
		if (runCard.kind === 'lesson') {
			return lessonStatus === 'generating';
		}
		return graderStatus === 'created' || graderStatus === 'executing';
	});

	const startedAt = $derived.by(() => {
		if (previewState?.startedAt !== undefined) {
			return previewState.startedAt ?? null;
		}
		if (runCard.kind === 'lesson') {
			return lessonStatus === 'generating' ? lesson?.createdAt ?? null : null;
		}
		return graderStatus === 'created' || graderStatus === 'executing'
			? graderRun?.createdAt ?? null
			: null;
	});

	const activeAgeLabel = $derived.by(() => {
		if (!startedAt) {
			return null;
		}
		return formatRelativeAge(startedAt, { now: relativeAgeNow });
	});

	const title = $derived.by(() => {
		if (previewState?.title !== undefined) {
			return previewState.title;
		}
		if (runCard.kind === 'lesson') {
			return lesson?.title ?? runCard.title ?? 'New lesson';
		}
		const presentationTitle = graderRun?.presentation?.title?.trim();
		if (presentationTitle && presentationTitle.length > 0) {
			return presentationTitle;
		}
		const paperName = graderRun?.paper?.paperName?.trim();
		if (paperName && paperName.length > 0) {
			return paperName;
		}
		const contextLabel = graderRun?.paper?.contextLabel?.trim();
		if (contextLabel && contextLabel.length > 0) {
			return contextLabel;
		}
		const storedTitle = graderRun?.olympiadLabel?.trim();
		if (storedTitle && storedTitle.length > 0) {
			return storedTitle;
		}
		const launchTitle = runCard.title?.trim();
		if (launchTitle && launchTitle.length > 0) {
			return launchTitle;
		}
		return 'Grading task';
	});

	const subtitle = $derived.by(() => {
		if (previewState && previewState.subtitle !== undefined) {
			return previewState.subtitle;
		}
		if (runCard.kind === 'lesson') {
			const tagline = lesson?.tagline?.trim();
			if (tagline && tagline.length > 0) {
				return tagline;
			}
			const topics = lesson?.topics?.filter((entry) => entry.trim().length > 0) ?? [];
			return topics.length > 0 ? topics.join(' · ') : null;
		}
		const parts: string[] = [];
		const paperYear = graderRun?.paper?.year?.trim();
		if (paperYear && paperYear.length > 0) {
			parts.push(`Year ${paperYear}`);
		}
		const contextLabel = graderRun?.paper?.contextLabel?.trim();
		if (contextLabel && contextLabel.length > 0) {
			parts.push(contextLabel);
		}
		if (parts.length === 0) {
			return null;
		}
		const nextSubtitle = parts.join(' • ');
		return nextSubtitle === title ? null : nextSubtitle;
	});

	const summary = $derived.by(() => {
		if (previewState && previewState.summary !== undefined) {
			return previewState.summary;
		}
		if (runCard.kind === 'lesson') {
			switch (lessonStatus) {
				case 'generating':
					return 'Building the lesson structure and publishing the first draft.';
				case 'ready':
					if (lessonProgress.total > 0) {
						return `${lessonProgress.total.toString()} ${pluralise('step', lessonProgress.total)} ready to start.`;
					}
					return 'Lesson ready to open.';
				case 'in_progress':
					return `${lessonProgress.completed.toString()}/${lessonProgress.total.toString()} steps complete.`;
				case 'completed':
					return `${lessonProgress.completed.toString()}/${lessonProgress.total.toString()} steps complete.`;
				case 'error':
					return lesson?.tagline?.trim() || 'Lesson creation failed. Open the lesson for details.';
				case null:
					return 'Building the lesson structure and publishing the first draft.';
			}
		}
		switch (graderStatus) {
			case 'created':
				return graderSheetPhase === 'building'
					? 'Preparing the sheet workspace.'
					: 'Preparing the grading workspace.';
			case 'executing':
				if (graderSheetPhase === 'building') {
					return 'Reviewing the upload and building the worksheet sheet view.';
				}
				return 'Reviewing the upload and building the graded worksheet view.';
			case 'done':
				if (graderSheetPhase === 'solving') {
					return graderRun?.resultSummary?.trim() || 'Worksheet draft ready to open and solve.';
				}
				if (graderRun?.totals) {
					return `${formatMarks(graderRun.totals.awardedMarks, graderRun.totals.maxMarks)} across ${graderRun.totals.problemCount.toString()} ${pluralise('question', graderRun.totals.problemCount)}.`;
				}
				return graderRun?.resultSummary?.trim() || 'Sheet ready.';
			case 'failed':
				return (
					graderRun?.error?.trim() ||
					(graderSheetPhase === 'building'
						? 'Sheet generation failed. Open the sheet for details.'
						: 'Sheet grading failed. Open the sheet for details.')
				);
			case 'stopped':
				return (
					graderRun?.resultSummary?.trim() ||
					(graderSheetPhase === 'building'
						? 'Sheet generation stopped.'
						: 'Sheet grading stopped.')
				);
			case null:
				return 'Preparing the sheet workspace.';
		}
	});

	const lessonProgressPercent = $derived.by(() => {
		if (lessonProgress.total <= 0) {
			return '0%';
		}
		return formatPercent((lessonProgress.completed / lessonProgress.total) * 100);
	});

	const meta = $derived.by(() => {
		if (previewState && previewState.meta !== undefined) {
			return previewState.meta;
		}
		if (runCard.kind === 'lesson') {
			if (lessonProgress.total > 0) {
				return `${lessonProgress.completed.toString()}/${lessonProgress.total.toString()} steps`;
			}
			return null;
		}
		if (graderSheetPhase === 'solving') {
			return 'Ready to solve';
		}
		if (graderRun?.totals) {
			return `${formatPercent(graderRun.totals.percentage)} scored`;
		}
		if (typeof runCard.sourceAttachmentCount === 'number' && runCard.sourceAttachmentCount > 0) {
			return `${runCard.sourceAttachmentCount.toString()} ${pluralise('upload', runCard.sourceAttachmentCount)} attached`;
		}
		return null;
	});

	const graderTotals = $derived.by(() =>
		previewState?.kind === 'grader' ? previewState.totals ?? null : graderRun?.totals ?? null
	);

	const effectiveLiveStatusError = $derived.by(() =>
		previewState?.liveStatusError ? 'preview' : liveStatusError
	);

	const primaryLabel = $derived.by(() => (runCard.kind === 'lesson' ? 'Open' : 'Open sheet'));

	const secondaryHref = $derived.by(() => runCard.listHref ?? null);

	onMount(() => {
		if (!browser) {
			return;
		}
		relativeAgeNow = Date.now();
		const intervalId = window.setInterval(() => {
			relativeAgeNow = Date.now();
		}, 5000);
		return () => {
			window.clearInterval(intervalId);
		};
	});

	onMount(() => {
		if (!browser || previewState || userId.trim().length === 0) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		let stopPrimary: Unsubscribe | null = null;
		let stopSecondary: Unsubscribe | null = null;
		liveStatusError = null;
		if (runCard.kind === 'lesson') {
			stopPrimary = onSnapshot(
				doc(db, 'spark', userId, 'sessions', runCard.sessionId),
				(snapshot) => {
					if (!snapshot.exists()) {
						lesson = null;
						return;
					}
					const parsed = SessionSchema.safeParse({
						id: runCard.sessionId,
						...snapshot.data()
					});
					if (!parsed.success) {
						console.warn('Invalid lesson payload for chat run card', parsed.error.flatten());
						liveStatusError = 'lesson';
						return;
					}
					liveStatusError = null;
					lesson = parsed.data;
				},
				(error) => {
					console.warn('Lesson run card subscription failed', error);
					liveStatusError = 'lesson';
				}
			);
			stopSecondary = onSnapshot(
				doc(db, 'spark', userId, 'state', runCard.sessionId),
				(snapshot) => {
					if (!snapshot.exists()) {
						lessonState = null;
						return;
					}
					const parsed = SessionStateSchema.safeParse({
						sessionId: runCard.sessionId,
						...snapshot.data()
					});
					if (!parsed.success) {
						console.warn('Invalid lesson state payload for chat run card', parsed.error.flatten());
						return;
					}
					lessonState = parsed.data;
				}
			);
		} else {
			stopPrimary = onSnapshot(
				doc(db, 'spark', userId, 'graderRuns', runCard.runId),
				(snapshot) => {
					if (!snapshot.exists()) {
						graderRun = null;
						return;
					}
					const parsed = SparkGraderRunSchema.safeParse({
						id: runCard.runId,
						...snapshot.data()
					});
					if (!parsed.success) {
						console.warn('Invalid grader payload for chat run card', parsed.error.flatten());
						liveStatusError = 'grader';
						return;
					}
					liveStatusError = null;
					graderRun = parsed.data;
				},
				(error) => {
					console.warn('Sheet run card subscription failed', error);
					liveStatusError = 'grader';
				}
			);
		}
		return () => {
			stopPrimary?.();
			stopSecondary?.();
		};
	});
</script>

<article
	class="agent-run-card"
	data-kind={runCard.kind}
	data-status={runCard.kind === 'lesson' ? lessonStatus ?? 'generating' : graderStatus ?? 'created'}
	aria-live="polite"
>
	<div class="agent-run-card__header">
		<div class="agent-run-card__status">
			{#if showSpinner}
				<span class="agent-run-card__spinner" aria-hidden="true"></span>
			{/if}
			<span>{statusLabel}</span>
		</div>
		{#if meta}
			<span class="agent-run-card__meta-pill">{meta}</span>
		{/if}
	</div>

	<div class="agent-run-card__copy">
		<p class="agent-run-card__eyebrow">{runCard.kind === 'lesson' ? 'Lesson task' : 'Sheet task'}</p>
		<h3>{title}</h3>
		{#if subtitle}
			<p class="agent-run-card__subtitle">{subtitle}</p>
		{/if}
		<p class="agent-run-card__summary">{summary}</p>
		{#if activeAgeLabel}
			<p class="agent-run-card__age">Started {activeAgeLabel}</p>
		{/if}

		{#if runCard.kind === 'lesson' && lessonProgress.total > 0}
			<div class="agent-run-card__progress">
				<div class="agent-run-card__progress-track" aria-hidden="true">
					<div
						class="agent-run-card__progress-fill"
						style={`--progress:${lessonProgressPercent};`}
					></div>
				</div>
				<span>{lessonProgress.completed}/{lessonProgress.total} steps</span>
			</div>
		{:else if runCard.kind === 'grader' && graderTotals}
			<div class="agent-run-card__stats">
				<div>
					<span>Marks</span>
					<p>{formatMarks(graderTotals.awardedMarks, graderTotals.maxMarks)}</p>
				</div>
				<div>
					<span>Questions</span>
					<p>{graderTotals.problemCount}</p>
				</div>
				<div>
					<span>Percent</span>
					<p>{formatPercent(graderTotals.percentage)}</p>
				</div>
			</div>
		{/if}

		{#if effectiveLiveStatusError}
			<p class="agent-run-card__warning">Live status is temporarily unavailable.</p>
		{/if}
	</div>

	<div class="agent-run-card__actions">
		<a class="agent-run-card__button is-primary" href={runCard.href}>{primaryLabel}</a>
		{#if secondaryHref}
			<a class="agent-run-card__button" href={secondaryHref}>
				{runCard.kind === 'lesson' ? 'All lessons' : 'All sheets'}
			</a>
		{/if}
	</div>
</article>

<style lang="postcss">
	.agent-run-card {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 0.95rem 1rem;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--card) 98%, white 2%), color-mix(in srgb, var(--card) 94%, transparent)),
			radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 12%, transparent), transparent 55%);
		box-shadow: 0 16px 32px -30px color-mix(in srgb, black 45%, transparent);
	}

	.agent-run-card[data-kind='lesson'] {
		border-color: color-mix(in srgb, rgb(59 130 246 / 0.24) 58%, var(--border));
	}

	.agent-run-card[data-kind='grader'] {
		border-color: color-mix(in srgb, rgb(16 185 129 / 0.24) 58%, var(--border));
	}

	.agent-run-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
	}

	.agent-run-card__status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
	}

	.agent-run-card__spinner {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--foreground) 18%, transparent);
		border-top-color: color-mix(in srgb, var(--accent) 72%, var(--foreground));
		animation: agent-run-card-spin 0.85s linear infinite;
	}

	.agent-run-card__meta-pill {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.26rem 0.56rem;
		font-size: 0.72rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--muted) 74%, transparent);
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.agent-run-card__copy {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.agent-run-card__eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--foreground) 56%, transparent);
	}

	.agent-run-card h3 {
		margin: 0;
		font-size: 1rem;
		line-height: 1.35;
	}

	.agent-run-card__subtitle,
	.agent-run-card__summary,
	.agent-run-card__age,
	.agent-run-card__warning {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.45;
	}

	.agent-run-card__subtitle {
		color: color-mix(in srgb, var(--foreground) 66%, transparent);
	}

	.agent-run-card__summary {
		color: color-mix(in srgb, var(--foreground) 80%, transparent);
	}

	.agent-run-card__age {
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.agent-run-card__warning {
		color: color-mix(in srgb, var(--destructive) 75%, black 10%);
	}

	.agent-run-card__progress {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.15rem;
		font-size: 0.76rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.agent-run-card__progress-track {
		width: 100%;
		height: 0.42rem;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--muted) 82%, transparent);
	}

	.agent-run-card__progress-fill {
		width: var(--progress);
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, rgb(56 189 248), rgb(59 130 246));
	}

	.agent-run-card__stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 0.2rem;
	}

	.agent-run-card__stats span {
		display: block;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--foreground) 54%, transparent);
	}

	.agent-run-card__stats p {
		margin: 0.18rem 0 0;
		font-size: 0.94rem;
		font-weight: 700;
	}

	.agent-run-card__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.agent-run-card__button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.2rem;
		padding: 0.52rem 0.8rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
		font-size: 0.82rem;
		font-weight: 700;
		text-decoration: none;
		color: inherit;
		background: color-mix(in srgb, var(--card) 90%, transparent);
	}

	.agent-run-card__button.is-primary {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
		background: color-mix(in srgb, var(--accent) 18%, var(--card));
	}

	@keyframes agent-run-card-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 640px) {
		.agent-run-card {
			padding: 0.9rem;
		}

		.agent-run-card__header {
			flex-direction: column;
			align-items: flex-start;
		}

		.agent-run-card__stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.agent-run-card__actions {
			flex-direction: column;
		}

		.agent-run-card__button {
			width: 100%;
		}
	}
</style>
