<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import type { PlanItemState, UserStats } from '@spark/schemas';
	import { createSessionStateStore } from '$lib/client/sessionState';
	import { createUserStatsStore } from '$lib/client/user';
	import { browser } from '$app/environment';

	type UserStore = {
		subscribe: (
			run: (value: { name?: string | null; email?: string | null } | null) => void
		) => () => void;
	};

	const userStore = getContext<UserStore | undefined>('spark-code:user');

	let firstName = $state('Sparkie');
	let unsubscribe: (() => void) | null = null;

	if (userStore) {
		unsubscribe = userStore.subscribe((value) => {
			const resolved = value?.name?.trim() || value?.email?.split('@')[0] || 'Spark guest';
			firstName = resolved.split(/\s+/)[0] ?? resolved;
		});
	}

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

	const userStatsStore = createUserStatsStore(data.userId);
	let liveStats = $state<UserStats | null>(data.stats ?? null);
	let stopUserStats = () => {};
	if (browser) {
		stopUserStats = userStatsStore.subscribe((value) => {
			liveStats = value;
		});
	}

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

	let stats = $state(buildStats(data.stats));
	$effect(() => {
		stats = buildStats(liveStats ?? data.stats);
	});

	const sessionId = $derived(data.session.id);
	const sessionPlan = $derived(data.session.plan);

	const planEyebrow = $derived(() => `Session · ${sessionId}`);
	const planTopic = $derived(() => data.session.plan[0]?.title ?? 'Your session plan');
	const planSummary = $derived(
		() =>
			data.session.plan[0]?.summary ??
			data.session.plan[0]?.description ??
			'This mix keeps momentum: quizzes prime your thinking, problems lock it in.'
	);

	const sessionStateStore = createSessionStateStore(data.userId, data.session.id);
	let sessionStateItems = $state<Record<string, PlanItemState>>({});
	const stopSessionStateSubscription = sessionStateStore.subscribe((value) => {
		sessionStateItems = value.items;
	});

	onDestroy(() => {
		unsubscribe?.();
		stopSessionStateSubscription();
		sessionStateStore.stop();
		stopUserStats();
		userStatsStore.stop();
	});

	const baseTimeline = $derived(
		sessionPlan.map<TimelineStep>((item) => {
			const icon = item.icon ?? (item.kind === 'quiz' ? '📝' : '🧠');
			const meta = item.meta ?? (item.kind === 'quiz' ? 'Quiz' : 'Problem');
			const description = item.summary ?? item.description ?? '';
			const href =
				item.kind === 'quiz'
					? `/code/${sessionId}/quiz/${item.id}`
					: `/code/${sessionId}/p/${item.id}`;
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
	);

	const timeline = $derived(
		baseTimeline.map((step) => ({
			...step,
			status: sessionStateItems[step.key]?.status ?? 'not_started'
		}))
	);
	const firstIncomplete = $derived(
		timeline.find((step) => step.status !== 'completed') ?? timeline[timeline.length - 1]!
	);
	const startHref = $derived(firstIncomplete.href);
	const startLabel = $derived(firstIncomplete.title);
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
				<a
					class="timeline-row"
					href={item.href}
					data-first={index === 0}
					data-last={index === timeline.length - 1}
					data-done={item.status === 'completed'}
					data-status={item.status}
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
						</div>
					</div>
				</a>
			{/each}
		</div>
		<div class="plan-footer">
			<a class="plan-start" href={startHref}>
				▶ Start with {startLabel}
			</a>
		</div>
	</div>
</section>

<style lang="postcss">
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
