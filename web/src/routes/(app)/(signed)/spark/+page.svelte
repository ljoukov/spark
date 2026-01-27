<script lang="ts">
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
</script>

<svelte:head>
	<title>Spark</title>
</svelte:head>

<section class="spark-home">
	<header class="spark-home__header">
		<p class="eyebrow">Spark</p>
		<h1>Welcome back</h1>
		<p class="subtitle">Pick up where you left off or explore all lessons.</p>
	</header>

	<div class="spark-home__grid">
		<a class="spark-card" href="/spark/code">
			<div class="spark-card__icon" aria-hidden="true">⚡️</div>
			<div>
				<h2>Spark Code</h2>
				<p>Jump straight into your current coding session.</p>
			</div>
			<span class={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'spark-card__cta')}
				>Continue</span
			>
		</a>
		<a class="spark-card" href="/spark/code/lessons">
			<div class="spark-card__icon" aria-hidden="true">📚</div>
			<div>
				<h2>All lessons</h2>
				<p>Browse every session, template, and draft you have started.</p>
			</div>
			<span class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'spark-card__cta')}
				>Browse</span
			>
		</a>
	</div>
</section>

<style>
	.spark-home {
		max-width: 1080px;
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 3.5rem) clamp(1.5rem, 5vw, 2.5rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2rem, 4vw, 2.75rem);
	}

	.spark-home__header {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.spark-home__header h1 {
		margin: 0;
		font-size: clamp(2rem, 4vw, 2.75rem);
		letter-spacing: -0.02em;
	}

	.eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.22em;
		font-size: 0.75rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.75));
		font-weight: 600;
	}

	.subtitle {
		margin: 0;
		font-size: 1.05rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.72));
	}

	.spark-home__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1.5rem;
	}

	.spark-card {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1rem 1.25rem;
		align-items: center;
		text-decoration: none;
		padding: 1.5rem;
		border-radius: 1.25rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 75%, transparent);
		box-shadow: 0 24px 60px -40px rgba(15, 23, 42, 0.35);
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			border-color 160ms ease;
	}

	.spark-card:hover {
		transform: translateY(-2px);
		border-color: rgba(59, 130, 246, 0.35);
		box-shadow: 0 32px 72px -40px rgba(15, 23, 42, 0.45);
	}

	.spark-card__icon {
		height: 3.2rem;
		width: 3.2rem;
		border-radius: 1rem;
		background: rgba(59, 130, 246, 0.14);
		display: grid;
		place-items: center;
		font-size: 1.5rem;
		box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.2);
	}

	.spark-card h2 {
		margin: 0 0 0.35rem 0;
		font-size: 1.2rem;
		color: var(--text-primary, var(--foreground));
	}

	.spark-card p {
		margin: 0;
		color: var(--text-secondary, rgba(30, 41, 59, 0.72));
		line-height: 1.45;
	}

	.spark-card__cta {
		grid-column: 1 / -1;
		justify-self: flex-start;
	}

	@media (min-width: 720px) {
		.spark-card__cta {
			justify-self: flex-end;
		}
	}
</style>
