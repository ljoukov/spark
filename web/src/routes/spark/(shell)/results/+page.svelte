<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { sparkQuizStore } from '$lib/mock/spark-data';

	const summary = {
		score: 88,
		time: '18m 42s',
		incorrect: 3,
		focusSize: 5
	};
</script>

<div class="spark-results-cover">
	<div class="spark-results-modal" role="dialog" aria-modal="true">
		<header>
			<h1>Great work</h1>
			<p>Your set is scored and ready for the next move.</p>
		</header>

		<section class="spark-results-stats">
			<div>
				<span class="spark-results-label">Score</span>
				<strong>{summary.score}%</strong>
			</div>
			<div>
				<span class="spark-results-label">Time</span>
				<strong>{summary.time}</strong>
			</div>
			<div>
				<span class="spark-results-label">Wrong</span>
				<strong>{summary.incorrect}</strong>
			</div>
		</section>

		<section class="spark-results-meta">
			<ul>
				<li>{summary.focusSize} questions flagged for focus</li>
				<li>{($sparkQuizStore.total ?? 25) - summary.incorrect} correct answers</li>
				<li>{summary.incorrect} marked for recap</li>
			</ul>
		</section>

		<footer class="spark-results-actions">
			<Button href="/spark/results" variant="ghost">Review mistakes</Button>
			<Button href="/spark/setup">Do Focus {summary.focusSize}</Button>
			<Button href="/spark/quiz" variant="outline">Same again</Button>
			<Button href="/spark/setup" variant="outline">New variant</Button>
			<Button href="/spark/home">Done</Button>
		</footer>
	</div>
</div>

<style>
	.spark-results-cover {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--background) 76%, transparent 24%);
		backdrop-filter: blur(18px);
		padding: clamp(2rem, 4vw, 3rem);
	}

	.spark-results-modal {
		width: min(640px, 100%);
		background: color-mix(in srgb, var(--surface-color) 96%, transparent 4%);
		border-radius: clamp(1.5rem, 4vw, 1.9rem);
		border: 1px solid color-mix(in srgb, var(--surface-border) 75%, transparent 25%);
		padding: clamp(2rem, 5vw, 2.5rem);
		display: grid;
		gap: 1.5rem;
		box-shadow: 0 40px 80px -60px var(--shadow-color);
	}

	.spark-results-modal header h1 {
		font-size: clamp(1.5rem, 3vw, 1.9rem);
		font-weight: 600;
	}

	.spark-results-modal header p {
		margin-top: 0.35rem;
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-results-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.spark-results-stats div {
		background: color-mix(in srgb, var(--accent) 18%, transparent 82%);
		padding: 1rem 1.25rem;
		border-radius: 1.1rem;
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		display: grid;
		gap: 0.35rem;
		text-align: center;
	}

	.spark-results-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--text-secondary) 75%, transparent 25%);
	}

	.spark-results-stats strong {
		font-size: 1.6rem;
		font-weight: 600;
	}

	.spark-results-meta ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.9rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-results-actions {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	}

	@media (max-width: 640px) {
		.spark-results-actions {
			grid-template-columns: 1fr;
		}

		.spark-results-stats {
			grid-template-columns: 1fr;
		}
	}
</style>
