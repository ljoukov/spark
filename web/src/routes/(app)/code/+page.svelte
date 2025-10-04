<script lang="ts">
	import { getContext, onDestroy } from 'svelte';

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

	onDestroy(() => {
		unsubscribe?.();
	});

	const stats = [
		{ label: 'XP', value: '1,420' },
		{ label: 'Level', value: '7' },
		{ label: 'Days 🔥', value: '12' },
		{ label: 'Solved', value: '86' }
	] as const;

	const planLinks = [
		{ href: '/code/quiz/dp-warmup-quiz', label: 'Warm-up quiz' },
		{ href: '/code/quiz/dp-topic-deck', label: 'Topic deck' },
		{ href: '/code/p/coin-change-ways', label: 'Practice · Coin Change Ways' },
		{ href: '/code/p/decode-ways', label: 'Challenge · Decode Ways' },
		{ href: '/code/quiz/dp-review-quiz', label: 'Final review quiz' }
	] as const;
</script>

<section class="dashboard">
	<div class="hero-card">
		<h1 class="hero-title">
			Welcome back, {firstName}!
			<picture class="hero-rocket">
				<source srcset="https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.webp" type="image/webp" />
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
			<h2 class="title">Jump back in</h2>
			<p class="lead">Pick a step to continue where you left off.</p>
		</header>

		<ul class="link-list">
			{#each planLinks as link}
				<li>
					<a href={link.href}>{link.label}</a>
				</li>
			{/each}
		</ul>
	</div>
</section>

<style lang="postcss">
	.dashboard {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 3vw, 2.5rem);
		max-width: min(80rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding: clamp(2rem, 5vw, 3rem) clamp(1.5rem, 6vw, 3rem);
		align-items: start;
	}

	@media (min-width: 70rem) {
		.dashboard {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.hero-card {
		display: flex;
		flex-direction: column;
		gap: clamp(0.9rem, 1.4vw, 1.2rem);
		padding: clamp(1.6rem, 2.5vw, 2.2rem);
		border-radius: clamp(1.6rem, 2vw, 1.9rem);
		background:
			linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(96, 165, 250, 0.18)),
			color-mix(in srgb, var(--app-content-bg) 78%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 80px -55px rgba(15, 23, 42, 0.45);
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
		font-size: clamp(2rem, 3.4vw, 2.6rem);
		line-height: 1.05;
		font-weight: 650;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.hero-rocket {
		display: inline-flex;
		margin-left: 0.2rem;
		vertical-align: middle;
	}

	.hero-rocket img {
		display: block;
	}

	.hero-subtitle {
		margin: 0;
		font-size: clamp(1.05rem, 1.6vw, 1.2rem);
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
		gap: 1.5rem;
		padding: clamp(1.6rem, 2.5vw, 2.2rem);
		border-radius: clamp(1.6rem, 2.2vw, 2rem);
		background: var(--plan-card-bg);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 24px 75px -50px rgba(15, 23, 42, 0.4);
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
		gap: 0.8rem;
	}

	.title {
		margin: 0;
		font-size: clamp(1.6rem, 2.6vw, 2rem);
		font-weight: 600;
	}

	.lead {
		margin: 0;
		font-size: 1rem;
		color: rgba(71, 85, 105, 0.82);
	}

	:global([data-theme='dark'] .lead) {
		color: rgba(203, 213, 225, 0.78);
	}

	.link-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.link-list a {
		color: rgba(37, 99, 235, 0.92);
		text-decoration: none;
		font-weight: 600;
	}

	.link-list a:hover,
	.link-list a:focus-visible {
		text-decoration: underline;
	}

	:global([data-theme='dark'] .link-list a) {
		color: rgba(147, 197, 253, 0.95);
	}
</style>
