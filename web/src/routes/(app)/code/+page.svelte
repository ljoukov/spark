<script lang="ts">
	import { getContext, onDestroy } from 'svelte';

	type UserStore = {
		subscribe: (
			run: (value: { name?: string | null; email?: string | null } | null) => void
		) => () => void;
	};

	const userStore = getContext<UserStore | undefined>('spark-code:user');

	let firstName = 'Sparkie';
	let unsubscribe: (() => void) | null = null;

	if (userStore) {
		unsubscribe = userStore.subscribe((value) => {
			const resolved = value?.name?.trim() || value?.email?.split('@')[0] || 'Spark guest';
			firstName = resolved.split(/\s+/)[0] ?? resolved;
		});
	}

	onDestroy(() => {
		unsubscribe?.();
	});

	const stats = [
		{ label: 'XP', value: '1,420' },
		{ label: 'Level', value: '7' },
		{ label: 'Days 🔥', value: '12' },
		{ label: 'Solved', value: '86' }
	];

	const focus = {
		eyebrow: "Today's session",
		topic: 'Dynamic programming · Balanced arrays',
		summary:
			'A quick warm-up, a theory refresh, two practice reps, and a mastery quiz to lock things in.'
	};

	const timeline = [
		{
			key: 'warmup',
			title: 'Warm-up',
			icon: '🏃‍♂️',
			meta: '5 min',
			description: "Quick review of yesterday's concepts"
		},
		{
			key: 'theory',
			title: 'Theory',
			icon: '📚',
			meta: 'Concept refresh',
			description: 'Learn the 0/1 knapsack problem and optimisation techniques'
		},
		{
			key: 'problem-a',
			title: 'Problem 1',
			icon: '💻',
			meta: '15 min',
			description: 'Classic 0/1 Knapsack — medium difficulty'
		},
		{
			key: 'problem-b',
			title: 'Problem 2',
			icon: '💻',
			meta: '20 min',
			description: 'Subset Sum with Constraints — hard difficulty'
		},
		{
			key: 'quiz',
			title: 'Quiz',
			icon: '📝',
			meta: '5 questions',
			description: 'Test your understanding with a quick mastery check'
		}
	];
</script>

<svelte:head>
	<title>Spark Code · Your session plan</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
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
			<p class="plan-eyebrow">{focus.eyebrow}</p>
			<h2>{focus.topic}</h2>
			<p class="plan-summary">{focus.summary}</p>
		</header>
		<div class="plan-body">
			{#each timeline as item}
				<div class="timeline-row">
					<div class="timeline-point">
						<span class="timeline-circle"></span>
					</div>
					<span class="timeline-emoji noto-color-emoji-regular" aria-hidden="true">{item.icon}</span
					>
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
			{/each}
		</div>
		<div class="plan-footer">
			<a class="plan-start" href="p/1">▶ Start session</a>
		</div>
	</div>
</section>

<style lang="postcss">
	.dashboard {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(23.5rem, 100%), 1fr));
		gap: clamp(1.5rem, 3vw, 2.4rem);
		padding-top: clamp(1.5rem, 3vw, 2.4rem);
		align-items: start;
		max-width: min(80rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
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
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
		padding: clamp(1.4rem, 2.2vw, 2rem);
		border-radius: clamp(1.6rem, 2.2vw, 2rem);
		background: color-mix(in srgb, var(--app-content-bg) 82%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 80px -55px rgba(15, 23, 42, 0.42);
	}

	.plan-body {
		display: flex;
		flex-direction: column;
		gap: clamp(1.35rem, 2vw, 1.8rem);
	}

	:global([data-theme='dark'] .plan-card),
	:global(:root:not([data-theme='light']) .plan-card) {
		background: rgba(6, 11, 25, 0.82);
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

	.timeline {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		list-style: none;
	}

	.timeline-row {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		gap: 0.5rem;
		align-items: center;
	}

	.timeline-point {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.85rem;
		height: 1.85rem;
		flex-shrink: 0;
		margin-right: 0.5rem;
	}

	.timeline-circle {
		width: 1.55rem;
		height: 1.55rem;
		border-radius: 9999px;
		background: var(--app-surface, #fff);
		border: 3px solid rgba(59, 130, 246, 0.9);
		box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
		z-index: 1;
	}

	:global([data-theme='dark'] .timeline-circle),
	:global(:root:not([data-theme='light']) .timeline-circle) {
		background: rgba(10, 19, 40, 0.9);
	}

	.timeline-emoji {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.65rem;
		line-height: 1;
	}

	.noto-color-emoji-regular {
		font-family: 'Noto Color Emoji', sans-serif;
		font-weight: 400;
		font-style: normal;
	}

	.timeline-text-block {
		display: flex;
		flex-direction: column;
	}

	.headline-row {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex-wrap: wrap;
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
		box-shadow: 0 18px 45px -26px rgba(37, 99, 235, 0.7);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.plan-start:hover {
		transform: translateY(-2px);
		box-shadow: 0 22px 55px -28px rgba(37, 99, 235, 0.8);
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
		box-shadow: 0 18px 45px -26px rgba(37, 99, 235, 0.7);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.plan-start:hover {
		transform: translateY(-2px);
		box-shadow: 0 22px 55px -28px rgba(37, 99, 235, 0.8);
	}

	@media (max-width: 720px) {
		.dashboard {
			gap: 1.4rem;
			padding-top: 1rem;
		}

		.timeline::before {
			left: 0.9rem;
		}

		.timeline-item {
			padding-left: 2.9rem;
		}

		.timeline-item::before {
			left: 0.2rem;
		}

		.timeline-item::after {
			left: 0.95rem;
		}
	}
</style>
