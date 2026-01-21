<script lang="ts">
	import { goto } from '$app/navigation';
	import { navigating } from '$app/stores';
	import { getContext, onDestroy } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import { z } from 'zod';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { PageData } from './$types';
	import type { LessonProposal, PlanItemState, UserStats } from '@spark/schemas';
	import { createSessionStateStore } from '$lib/client/sessionState';
	import { initializeUserStats, setUserStats } from '$lib/client/userStats';

	type UserSnapshot = { name?: string | null; email?: string | null } | null;

	const userStore = getContext<Readable<UserSnapshot> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const firstName = $derived.by(() => {
		const resolved =
			userSnapshot?.current?.name?.trim() ||
			userSnapshot?.current?.email?.split('@')[0] ||
			'Spark guest';
		return resolved.split(/\s+/)[0] ?? resolved;
	});

	let { data }: { data: PageData } = $props();

	type TimelineStep = {
		key: string;
		title: string;
		icon: string;
		meta?: string;
		description: string;
		href: string;
		status: PlanItemState['status'];
	};

	const fallbackStats = Object.freeze([
		{ label: 'XP', value: '—' },
		{ label: 'Level', value: '—' },
		{ label: 'Days 🔥', value: '—' },
		{ label: 'Solved', value: '—' }
	]);

	function buildStats(source: UserStats | null | undefined) {
		if (!source) {
			return fallbackStats;
		}
		return [
			{ label: 'XP', value: source.xp.toLocaleString() },
			{ label: 'Level', value: source.level.toLocaleString() },
			{ label: 'Days 🔥', value: source.streakDays.toLocaleString() },
			{ label: 'Solved', value: source.solvedCount.toLocaleString() }
		];
	}

	const initialStats = $derived(data.stats ?? null);
	const userStatsStore = initializeUserStats(null);
	let liveStats = $state<UserStats | null>(null);
	const stopUserStats = userStatsStore.subscribe((value) => {
		liveStats = value;
	});

	$effect(() => {
		setUserStats(initialStats);
	});

	const stats = $derived(buildStats(liveStats ?? initialStats));
	const navigationStore = fromStore(navigating);
	const navigatingTo = $derived(navigationStore?.current?.to?.url?.pathname ?? null);
	let pendingHref = $state<string | null>(null);
	const activeLoadingHref = $derived(pendingHref ?? navigatingTo);

	$effect(() => {
		if (!navigatingTo) {
			pendingHref = null;
		}
	});

	const sessionId = $derived(data.session.id);
	const sessionStatus = $derived(data.session.status ?? 'ready');
	const isGeneratingSession = $derived(sessionStatus === 'generating');
	const isErroredSession = $derived(sessionStatus === 'error');
	const sessionPlan = $derived(data.session.plan ?? []);
	const hasPlanItems = $derived(sessionPlan.length > 0);

	const planEyebrow = $derived("Today's plan");
	const planTopic = $derived(data.session.title ?? sessionPlan[0]?.title ?? 'Your session plan');
	const planSummary = $derived(data.session.summary ?? '');

	let sessionStateItems = $state<Record<string, PlanItemState>>({});
	$effect(() => {
		const store = createSessionStateStore(data.session.id, data.sessionState);
		const stop = store.subscribe((value) => {
			sessionStateItems = value.items;
		});
		return () => {
			stop();
			store.stop();
		};
	});

	onDestroy(() => {
		stopUserStats();
	});

	const baseTimeline = $derived(
		hasPlanItems
			? sessionPlan.map<TimelineStep>((item) => {
					const icon =
						item.icon ?? (item.kind === 'quiz' ? '📝' : item.kind === 'problem' ? '🧠' : '🎧');
					const meta =
						item.meta ??
						(item.kind === 'quiz' ? 'Quiz' : item.kind === 'problem' ? 'Problem' : 'Clip');
					const description = item.summary ?? '';
					const href =
						item.kind === 'quiz'
							? `/code/${sessionId}/quiz/${item.id}`
							: item.kind === 'problem'
								? `/code/${sessionId}/p/${item.id}`
								: `/code/${sessionId}/m/${item.id}`;
					return {
						key: item.id,
						title: item.title,
						icon,
						meta,
						description,
						href,
						status: 'not_started'
					};
				})
			: []
	);

	const timeline = $derived(
		baseTimeline.map((step) => ({
			...step,
			status: sessionStateItems[step.key]?.status ?? 'not_started'
		}))
	);
	const firstIncomplete = $derived(
		timeline.length > 0
			? (timeline.find((step) => step.status !== 'completed') ?? timeline[timeline.length - 1]!)
			: null
	);
	const startHref = $derived(firstIncomplete?.href ?? `/code/${sessionId}`);
	const startLabel = $derived(firstIncomplete?.title ?? 'Session');
	const timelineStatuses = $derived(timeline.map((step) => step.status));
	const allCompleted = $derived(
		timeline.length > 0 && timelineStatuses.every((status) => status === 'completed')
	);
	const hasProgress = $derived(timelineStatuses.some((status) => status !== 'not_started'));
	const ctaState = $derived(
		timeline.length === 0
			? 'start'
			: allCompleted
				? 'completed'
				: hasProgress
					? 'continue'
					: 'start'
	);
	const ctaIcon = $derived(ctaState === 'completed' ? '🎉' : '▶');
	const ctaLabel = $derived(
		ctaState === 'completed' ? 'Finish' : ctaState === 'continue' ? 'Continue' : 'Start'
	);
	const ctaAria = $derived(
		ctaState === 'completed'
			? 'Session completed — review any step again if you like.'
			: ctaState === 'continue'
				? `Continue with ${startLabel}`
				: `Start ${startLabel}`
	);

	function handleTimelineClick(href: string): void {
		if (activeLoadingHref) {
			return;
		}
		pendingHref = href;
	}

	const lessonProposalSchema = z.object({
		id: z.string().trim().min(1),
		title: z.string().trim().min(1),
		tagline: z.string().trim().min(1),
		topics: z.array(z.string().trim().min(1)).min(1),
		emoji: z.string().trim().min(1)
	});

	const proposalsResponseSchema = z.object({
		proposals: z.array(lessonProposalSchema),
		reused: z.boolean().optional()
	});

	const selectResponseSchema = z.object({
		nextSessionId: z.string().trim().min(1),
		status: z.string().trim().optional()
	});

	let proposalDialogOpen = $state(false);
	let proposalsLoading = $state(false);
	const initialProposals = $derived(data.session.nextLessonProposals ?? []);
	let proposalsLoaded = $state(false);
	let proposalsError = $state<string | null>(null);
	let selectionError = $state<string | null>(null);
	let proposals = $state<LessonProposal[]>([]);
	let selectPendingId = $state<string | null>(null);

	$effect(() => {
		proposals = initialProposals;
		proposalsLoaded = initialProposals.length > 0;
	});

	async function fetchProposals(): Promise<void> {
		proposalsError = null;
		proposalsLoading = true;
		try {
			const response = await fetch(`/api/code/${sessionId}/next-lessons`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'propose' })
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				const message =
					payload && typeof payload.message === 'string'
						? payload.message
						: 'Unable to draft next lessons. Please try again.';
				proposalsError = message;
				return;
			}
			const payload = proposalsResponseSchema.parse(await response.json());
			proposals = payload.proposals;
			proposalsLoaded = true;
		} catch (error) {
			console.error('Failed to fetch next-lesson proposals', error);
			proposalsError = 'Unable to draft next lessons. Please try again.';
		} finally {
			proposalsLoading = false;
		}
	}

	function openProposalDialog(): void {
		proposalDialogOpen = true;
		selectionError = null;
		if (!proposalsLoaded && !proposalsLoading) {
			void fetchProposals();
		}
	}

	function handlePlanCtaClick(event: MouseEvent): void {
		if (ctaState !== 'completed') {
			return;
		}
		event.preventDefault();
		openProposalDialog();
	}

	async function handleProposalPick(proposalId: string): Promise<void> {
		selectionError = null;
		selectPendingId = proposalId;
		try {
			const response = await fetch(`/api/code/${sessionId}/next-lessons`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'select', proposalId })
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				const message =
					payload && typeof payload.message === 'string'
						? payload.message
						: 'Could not start that lesson. Please try again.';
				selectionError = message;
				return;
			}
			const payload = selectResponseSchema.parse(await response.json());
			proposalDialogOpen = false;
			await goto(`/code/${payload.nextSessionId}`);
		} catch (error) {
			console.error('Failed to start next lesson', error);
			selectionError = 'Could not start that lesson. Please try again.';
		} finally {
			selectPendingId = null;
		}
	}
</script>

<svelte:head>
	<title>Spark Code · Your session plan</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap"
	/>
</svelte:head>

{#if isGeneratingSession}
	<section class="generating">
		<div class="generating-card">
			<div class="next-spinner" aria-hidden="true"></div>
			<div class="generating-copy">
				<h1>Generating your next lesson…</h1>
				<p>We&rsquo;re assembling a fresh plan. This usually takes under a minute.</p>
				<a class="secondary-link" href="/code/lessons">See other lessons</a>
			</div>
		</div>
	</section>
{:else if isErroredSession}
	<section class="generating">
		<div class="generating-card">
			<div class="generating-copy">
				<h1>We hit a snag</h1>
				<p>We could not finish this lesson. Check your other lessons or try again later.</p>
				<a class="secondary-link" href="/code/lessons">See other lessons</a>
			</div>
		</div>
	</section>
{:else}
	<section class="dashboard">
		<div class="hero-card">
			<h1 class="hero-title">
				Welcome back, {firstName}!
				<picture class="hero-rocket">
					<source
						srcset="https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.webp"
						type="image/webp"
					/>
					<img
						src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.gif"
						alt="🚀"
						width="48"
						height="48"
					/>
				</picture>
			</h1>
			<p class="hero-subtitle">Let&apos;s crush today&apos;s session.</p>
			<div class="stat-chips">
				{#each stats as stat}
					<div class="stat-chip">
						<span class="chip-value">{stat.value}</span>
						<span class="chip-label">{stat.label}</span>
					</div>
				{/each}
			</div>
		</div>

		<div class="plan-card">
			<header class="plan-header">
				<p class="plan-eyebrow">{planEyebrow}</p>
				<h2>{planTopic}</h2>
				<p class="plan-summary">{planSummary}</p>
			</header>
			<div class="plan-body">
				{#each timeline as item, index}
					{@const isLoading = activeLoadingHref === item.href}
					<a
						class="timeline-row"
						href={item.href}
						data-first={index === 0}
						data-last={index === timeline.length - 1}
						data-done={item.status === 'completed'}
						data-status={item.status}
						data-loading={isLoading}
						aria-busy={isLoading ? 'true' : undefined}
						onclick={() => handleTimelineClick(item.href)}
					>
						<div class="timeline-hit">
							<div class="timeline-point" data-done={item.status === 'completed'}>
								<span class="timeline-circle" data-done={item.status === 'completed'}></span>
							</div>
							<div class="timeline-body">
								<span class="timeline-emoji" aria-hidden="true">
									{item.icon}
								</span>
								<div class="timeline-text-block">
									<div class="headline-row">
										<span class="checkpoint-name">{item.title}</span>
										{#if item.meta}
											<span class="checkpoint-dot">·</span>
											<span class="checkpoint-meta">{item.meta}</span>
										{/if}
									</div>
									<div class="checkpoint-description">
										<span>{item.description}</span>
									</div>
								</div>
								<span class="timeline-loader" aria-hidden="true">
									<span class="timeline-spinner" data-visible={isLoading}></span>
								</span>
							</div>
						</div>
					</a>
				{/each}
			</div>
			<div class="plan-footer">
				<a
					class="plan-start"
					href={startHref}
					data-state={ctaState}
					aria-label={ctaAria}
					onclick={handlePlanCtaClick}
				>
					{ctaIcon}
					{ctaLabel}
				</a>
			</div>
		</div>
	</section>
{/if}

<Dialog.Root
	open={proposalDialogOpen}
	onOpenChange={(value) => {
		proposalDialogOpen = value;
		if (!value) {
			selectionError = null;
		}
	}}
>
	<Dialog.Content class="next-dialog" hideClose>
		{#if proposalsLoading && !proposalsLoaded}
			<div class="next-dialog__loading">
				<div class="next-spinner" aria-hidden="true"></div>
				<div class="next-dialog__copy">
					<h2>Deciding on your next sessions…</h2>
					<p>We&rsquo;re lining up three options based on what you finished.</p>
				</div>
			</div>
		{:else}
			<div class="next-dialog__body">
				<div class="next-dialog__header">
					<h2>Pick your next lesson</h2>
					<p>Choose one to start generating right away.</p>
				</div>
				{#if proposalsError}
					<p class="proposal-error">{proposalsError}</p>
					<div class="next-dialog__actions">
						<button
							class="proposal-action"
							onclick={() => void fetchProposals()}
							disabled={proposalsLoading}
						>
							Try again
						</button>
						<button class="proposal-secondary" onclick={() => (proposalDialogOpen = false)}>
							Close
						</button>
					</div>
				{:else if proposals.length === 0}
					<div class="next-dialog__empty">
						<p>No proposals yet. Try again in a moment.</p>
						<button
							class="proposal-action"
							onclick={() => void fetchProposals()}
							disabled={proposalsLoading}
						>
							Refresh
						</button>
					</div>
				{:else}
					<div class="proposal-grid">
						{#each proposals as proposal}
							<article class="proposal-card">
								<div class="proposal-emoji" aria-hidden="true">{proposal.emoji}</div>
								<div class="proposal-main">
									<h3>{proposal.title}</h3>
									<p class="proposal-tagline">{proposal.tagline}</p>
									<ul class="proposal-topics">
										{#each proposal.topics as topic}
											<li>{topic}</li>
										{/each}
									</ul>
								</div>
								<button
									class="proposal-action"
									disabled={selectPendingId === proposal.id}
									onclick={() => void handleProposalPick(proposal.id)}
								>
									{selectPendingId === proposal.id ? 'Starting…' : 'Start this lesson'}
								</button>
							</article>
						{/each}
					</div>
					{#if selectionError}
						<p class="proposal-error">{selectionError}</p>
					{/if}
					<div class="next-dialog__actions">
						<button class="proposal-secondary" onclick={() => (proposalDialogOpen = false)}>
							Cancel
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style lang="postcss">
	.generating {
		width: min(80rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.5rem, 3vw, 2.4rem);
	}

	.generating-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.6rem;
		border-radius: 1.4rem;
		background: color-mix(in srgb, var(--app-content-bg) 88%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.24);
		box-shadow: 0 20px 60px -46px rgba(15, 23, 42, 0.45);
	}

	.generating-copy h1 {
		margin: 0 0 0.35rem;
	}

	.generating-copy p {
		margin: 0 0 0.6rem;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.78));
	}

	.secondary-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		text-decoration: none;
		font-weight: 600;
		color: rgba(59, 130, 246, 0.95);
	}

	.next-spinner {
		height: 2.75rem;
		width: 2.75rem;
		border-radius: 9999px;
		border: 3px solid rgba(148, 163, 184, 0.35);
		border-top-color: rgba(59, 130, 246, 0.85);
		animation: next-spin 0.75s linear infinite;
	}

	@keyframes next-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	:global(.next-dialog) {
		max-width: 56rem;
		width: min(56rem, 92vw);
		padding: 0;
		border-radius: 1.5rem;
		overflow: hidden;
	}

	.next-dialog__loading,
	.next-dialog__body {
		padding: 1.5rem;
	}

	.next-dialog__loading {
		display: flex;
		gap: 1rem;
		align-items: center;
	}

	.next-dialog__copy h2,
	.next-dialog__copy p {
		margin: 0;
	}

	.next-dialog__body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.next-dialog__header h2 {
		margin: 0 0 0.25rem;
	}

	.next-dialog__header p {
		margin: 0;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	.proposal-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.9rem;
	}

	.proposal-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: color-mix(in srgb, var(--app-content-bg) 92%, transparent);
		box-shadow: 0 18px 50px -44px rgba(15, 23, 42, 0.45);
	}

	.proposal-emoji {
		font-size: 1.4rem;
		line-height: 1;
	}

	.proposal-main h3 {
		margin: 0;
		font-size: 1.05rem;
	}

	.proposal-tagline {
		margin: 0.2rem 0 0;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	.proposal-topics {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.proposal-topics li {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.18);
		font-size: 0.85rem;
	}

	.proposal-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.55rem 1rem;
		border-radius: 0.9rem;
		border: none;
		cursor: pointer;
		font-weight: 700;
		color: #fff;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(96, 165, 250, 0.78));
	}

	.proposal-action:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.proposal-secondary {
		border: none;
		background: none;
		color: rgba(30, 41, 59, 0.9);
		font-weight: 600;
		cursor: pointer;
	}

	.proposal-error {
		margin: 0;
		padding: 0.65rem 0.8rem;
		border-radius: 0.85rem;
		border: 1px solid rgba(239, 68, 68, 0.38);
		background: rgba(248, 113, 113, 0.14);
		color: #b91c1c;
	}

	.next-dialog__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.7rem;
	}

	.next-dialog__empty {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.dashboard {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 3vw, 2.4rem);
		padding-top: clamp(1.5rem, 3vw, 2.4rem);
		padding-bottom: clamp(1.5rem, 3vw, 2.4rem);
		align-items: start;
		max-width: min(80rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
	}

	/* Two columns only at ≥ 1280px (80rem) */
	@media (min-width: 80rem) {
		.dashboard {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.hero-card {
		display: flex;
		flex-direction: column;
		gap: clamp(0.9rem, 1.5vw, 1.3rem);
		padding: clamp(1.6rem, 2.5vw, 2.2rem);
		border-radius: clamp(1.6rem, 2.2vw, 2rem);
		background:
			linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(96, 165, 250, 0.18)),
			color-mix(in srgb, var(--app-content-bg) 78%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 80px -50px rgba(15, 23, 42, 0.45);
	}

	:global([data-theme='dark'] .hero-card),
	:global(:root:not([data-theme='light']) .hero-card) {
		background:
			linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(37, 99, 235, 0.12)),
			rgba(6, 11, 25, 0.8);
		border-color: rgba(148, 163, 184, 0.28);
	}

	.hero-title {
		margin: 0;
		font-size: clamp(2rem, 3.6vw, 2.65rem);
		line-height: 1.05;
		font-weight: 650;
	}

	.hero-rocket {
		display: inline-flex;
		margin-left: 0.45rem;
		vertical-align: middle;
		align-items: center;
	}

	.hero-rocket img {
		display: block;
	}

	.hero-subtitle {
		margin: 0;
		font-size: clamp(1.05rem, 1.5vw, 1.2rem);
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.72));
		font-weight: 500;
	}

	.stat-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.stat-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1.1rem;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 16px 32px -28px rgba(15, 23, 42, 0.35);
		font-weight: 600;
		font-size: 0.9rem;
		color: rgba(30, 41, 59, 0.9);
	}

	:global([data-theme='dark'] .stat-chip),
	:global(:root:not([data-theme='light']) .stat-chip) {
		background: rgba(15, 23, 42, 0.72);
		color: rgba(226, 232, 240, 0.9);
		border-color: rgba(148, 163, 184, 0.3);
	}

	:global([data-theme='dark'] .stat-chip .chip-label),
	:global(:root:not([data-theme='light']) .stat-chip .chip-label) {
		color: rgba(203, 213, 225, 0.8);
	}

	.chip-value {
		font-size: 1rem;
		font-weight: 700;
	}

	.chip-label {
		font-size: 0.8rem;
		font-weight: 500;
		color: rgba(71, 85, 105, 0.85);
	}

	.plan-card {
		--plan-card-bg: color-mix(in srgb, var(--app-content-bg) 82%, transparent);
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
		padding: clamp(1.4rem, 2.2vw, 2rem);
		border-radius: clamp(1.6rem, 2.2vw, 2rem);
		background: var(--plan-card-bg);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 80px -55px rgba(15, 23, 42, 0.42);
	}

	.plan-body {
		/* Move spacing from grid gap to row padding */
		--timeline-pad-y: 0.9rem; /* vertical padding in each row */
		--timeline-pad-x: 0.75rem; /* horizontal (left/right) padding of each row */
		--timeline-circle: 1.55rem;
		--timeline-circle-border: 3px;
		--timeline-track: calc(var(--timeline-circle) + 2 * var(--timeline-circle-border));
		--timeline-track-width: 2px;
		--timeline-hover-fudge: 6px; /* extra length to cover hover lift */
		--timeline-line: #3b82f6;
		display: flex;
		flex-direction: column;
		gap: 0; /* no inter-row gap; spacing comes from padding */
		position: relative;
	}

	:global([data-theme='dark'] .plan-body),
	:global(:root:not([data-theme='light']) .plan-body) {
		--timeline-line: #60a5fa;
	}

	:global([data-theme='dark'] .plan-card),
	:global(:root:not([data-theme='light']) .plan-card) {
		--plan-card-bg: rgba(6, 11, 25, 0.82);
		background: var(--plan-card-bg);
		border-color: rgba(148, 163, 184, 0.28);
	}

	.plan-header {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.plan-eyebrow {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(59, 130, 246, 0.82);
		font-weight: 600;
	}

	.plan-header h2 {
		margin: 0;
		font-size: clamp(1.4rem, 2.4vw, 1.9rem);
		font-weight: 600;
	}

	.plan-summary {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	:global([data-theme='dark'] .plan-summary),
	:global(:root:not([data-theme='light']) .plan-summary) {
		color: rgba(203, 213, 225, 0.78);
	}

	.timeline-row {
		display: block;
		cursor: pointer;
		outline: none;
		border-radius: 1rem;
		position: relative;
		color: inherit;
		text-decoration: none;
	}

	.timeline-row[data-loading='true'] {
		cursor: progress;
		pointer-events: none;
	}

	.timeline-row:focus-visible {
		outline: none;
	}

	.timeline-hit {
		display: grid;
		grid-template-columns: var(--timeline-track) minmax(0, 1fr);
		column-gap: 0.75rem;
		row-gap: 0.45rem;
		align-items: start;
		padding: var(--timeline-pad-y) var(--timeline-pad-x);
		border-radius: 1rem;
		border: 1px solid transparent;
		width: 100%;
		position: relative;
		z-index: 1;
	}

	/* Per-row vertical segments */
	.timeline-hit::before,
	.timeline-hit::after {
		content: '';
		position: absolute;
		left: calc(var(--timeline-pad-x) + var(--timeline-track) / 2);
		width: var(--timeline-track-width);
		transform: translateX(-50%);
		background: var(--timeline-line);
		pointer-events: none;
		z-index: 0;
	}

	/* Top segment: from slightly above the row to center */
	.timeline-hit::before {
		top: calc(-1 * var(--timeline-hover-fudge));
		height: calc(50% + var(--timeline-hover-fudge));
	}

	/* Bottom segment: from center to slightly below the row */
	.timeline-hit::after {
		bottom: calc(-1 * var(--timeline-hover-fudge));
		height: calc(50% + var(--timeline-hover-fudge));
	}

	/* Hide segments for the boundaries */
	.timeline-row[data-first='true'] .timeline-hit::before {
		height: 0;
	}
	.timeline-row[data-last='true'] .timeline-hit::after {
		height: 0;
	}

	.timeline-row:focus-visible .timeline-hit {
		background: rgba(59, 130, 246, 0.12);
		border-color: rgba(59, 130, 246, 0.24);
	}

	:global([data-theme='dark'] .timeline-row:focus-visible .timeline-hit),
	:global(:root:not([data-theme='light']) .timeline-row:focus-visible .timeline-hit) {
		background: rgba(37, 99, 235, 0.2);
		border-color: rgba(59, 130, 246, 0.32);
	}

	@media (hover: hover) {
		.timeline-row:hover .timeline-hit {
			background: rgba(59, 130, 246, 0.12);
			border-color: rgba(59, 130, 246, 0.24);
		}

		:global([data-theme='dark'] .timeline-row:hover .timeline-hit),
		:global(:root:not([data-theme='light']) .timeline-row:hover .timeline-hit) {
			background: rgba(37, 99, 235, 0.2);
			border-color: rgba(59, 130, 246, 0.32);
		}
	}

	.timeline-row[data-loading='true'] .timeline-hit {
		background: rgba(59, 130, 246, 0.16);
		border-color: rgba(59, 130, 246, 0.3);
	}

	:global([data-theme='dark'] .timeline-row[data-loading='true'] .timeline-hit),
	:global(:root:not([data-theme='light']) .timeline-row[data-loading='true'] .timeline-hit) {
		background: rgba(37, 99, 235, 0.26);
		border-color: rgba(59, 130, 246, 0.4);
	}

	.timeline-point {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--timeline-track);
		height: var(--timeline-track);
		flex-shrink: 0;
		align-self: center;
		z-index: 1;
	}

	.timeline-body {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.timeline-loader {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.2rem;
		margin-left: auto;
	}

	.timeline-spinner {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 9999px;
		border: 2px solid rgba(59, 130, 246, 0.2);
		border-top-color: var(--timeline-line);
		animation: timeline-spin 0.9s linear infinite;
		opacity: 0;
		--spinner-scale: 0.85;
		transition:
			opacity 0.2s ease,
			--spinner-scale 0.2s ease;
	}

	.timeline-spinner[data-visible='true'] {
		opacity: 1;
		--spinner-scale: 1;
	}

	:global([data-theme='dark'] .timeline-spinner),
	:global(:root:not([data-theme='light']) .timeline-spinner) {
		border-color: rgba(96, 165, 250, 0.28);
		border-top-color: var(--timeline-line);
	}

	@keyframes timeline-spin {
		from {
			transform: rotate(0deg) scale(var(--spinner-scale));
		}
		to {
			transform: rotate(360deg) scale(var(--spinner-scale));
		}
	}

	.timeline-circle {
		width: var(--timeline-circle);
		height: var(--timeline-circle);
		border-radius: 9999px;
		background: var(--app-surface, #fff);
		border: var(--timeline-circle-border) solid rgba(59, 130, 246, 0.9);
		/* use inner outline ring via pseudo to avoid animating heavy shadows */
		z-index: 1;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	:global([data-theme='dark'] .timeline-circle),
	:global(:root:not([data-theme='light']) .timeline-circle) {
		background: #0a1328;
	}

	.timeline-circle::before,
	.timeline-circle::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}

	/* soft ring without animating box-shadow */
	/* .timeline-circle::before {
		box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
	} */

	.timeline-circle[data-done='true'] {
		background: linear-gradient(135deg, #3b82f6, #2563eb);
		border-color: rgba(59, 130, 246, 0.9);
		box-shadow: 0 0 0 5px rgba(59, 130, 246, 0.22);
		color: #fff;
	}

	.timeline-circle[data-done='true']::after {
		content: '✓';
		font-size: 0.85rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.timeline-row:hover .timeline-circle,
	.timeline-row:focus-visible .timeline-circle {
	}

	.timeline-emoji {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.65rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.timeline-text-block {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.headline-row {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.timeline-row[data-done='true'] .headline-row .checkpoint-name {
		color: rgba(37, 99, 235, 0.92);
	}

	.timeline-row[data-done='true'] .headline-row .checkpoint-meta {
		color: rgba(37, 99, 235, 0.66);
	}

	:global([data-theme='dark'] .timeline-row[data-done='true'] .headline-row .checkpoint-name),
	:global(
		:root:not([data-theme='light']) .timeline-row[data-done='true'] .headline-row .checkpoint-name
	) {
		color: rgba(147, 197, 253, 0.92);
	}

	:global([data-theme='dark'] .timeline-row[data-done='true'] .headline-row .checkpoint-meta),
	:global(
		:root:not([data-theme='light']) .timeline-row[data-done='true'] .headline-row .checkpoint-meta
	) {
		color: rgba(147, 197, 253, 0.72);
	}

	.checkpoint-name {
		font-weight: 600;
		font-size: 1.05rem;
		color: var(--foreground);
	}

	.checkpoint-dot {
		font-size: 1.1rem;
		line-height: 1;
		color: rgba(71, 85, 105, 0.6);
	}

	.checkpoint-meta {
		font-size: 0.82rem;
		color: rgba(71, 85, 105, 0.72);
		font-weight: 500;
	}

	:global([data-theme='dark'] .checkpoint-dot),
	:global(:root:not([data-theme='light']) .checkpoint-dot) {
		color: rgba(148, 163, 184, 0.55);
	}

	:global([data-theme='dark'] .checkpoint-meta),
	:global(:root:not([data-theme='light']) .checkpoint-meta) {
		color: rgba(203, 213, 225, 0.7);
	}

	.checkpoint-description {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.9rem;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.76));
	}

	:global([data-theme='dark'] .checkpoint-description),
	:global(:root:not([data-theme='light']) .checkpoint-description) {
		color: rgba(203, 213, 225, 0.75);
	}

	.plan-footer {
		display: flex;
		justify-content: flex-end;
	}

	.plan-start {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 1.6rem;
		border-radius: 9999px;
		font-weight: 600;
		font-size: 0.95rem;
		text-decoration: none;
		color: #fff;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(96, 165, 250, 0.78));
		/* reduce costly shadow changes */
		box-shadow: 0 18px 45px -26px rgba(37, 99, 235, 0.55);
		border: 1px solid transparent;
	}

	/* removed unused .plan-start__icon and __label wrappers */

	.plan-start[data-state='completed'] {
		background: rgba(34, 197, 94, 0.16);
		color: #14532d;
		box-shadow: none;
		border-color: rgba(34, 197, 94, 0.45);
		gap: 0.5rem;
	}

	:global([data-theme='dark'] .plan-start[data-state='completed']),
	:global(:root:not([data-theme='light']) .plan-start[data-state='completed']) {
		background: rgba(34, 197, 94, 0.28);
		color: rgba(240, 253, 244, 0.95);
		border-color: rgba(74, 222, 128, 0.55);
	}

	.plan-start:hover {
	}

	@media (max-width: 720px) {
		.dashboard {
			gap: 1.4rem;
			padding-top: 1rem;
			padding-bottom: 1rem;
		}
	}
</style>
