<script lang="ts">
	import {
		FINAL_ANSWER,
		GUIDE_VARIANTS,
		ORIGINAL_QUESTION
	} from '$lib/spark/guides/knowledgeGapGuide';
</script>

<svelte:head>
	<title>Knowledge gap guides | Spark</title>
</svelte:head>

<section class="guides-index">
	<header class="guides-index__header">
		<p>Student guide prototypes</p>
		<h1>Pick a knowledge-gap flow.</h1>
		<div class="question-strip">
			<span>Shared biology prompt</span>
			<strong>{ORIGINAL_QUESTION}</strong>
		</div>
	</header>

	<div class="guides-grid">
		{#each GUIDE_VARIANTS as variant}
			<a class="guide-card" href={`/spark/guides/${variant.id}`}>
				<span>{variant.id.toUpperCase()} · {variant.format}</span>
				<strong>{variant.name}</strong>
				<p>{variant.description}</p>
			</a>
		{/each}
	</div>

	<footer class="answer-note">
		<span>Target answer</span>
		<p>{FINAL_ANSWER}</p>
	</footer>
</section>

<style>
	.guides-index {
		width: min(1040px, calc(100% - 40px));
		margin: 0 auto;
		padding: 2rem 0 3rem;
		color: var(--foreground);
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif,
			'Apple Color Emoji', 'Segoe UI Emoji';
		letter-spacing: 0;
	}

	.guides-index *,
	.guides-index *::before,
	.guides-index *::after {
		box-sizing: border-box;
		letter-spacing: 0;
	}

	.guides-index__header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
		gap: 24px;
		align-items: end;
		margin-bottom: 1.25rem;
	}

	.guides-index__header > p {
		grid-column: 1;
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 58%, #2563eb);
		font-size: 0.82rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.guides-index h1 {
		grid-column: 1;
		margin: 0;
		font-size: clamp(1.8rem, 3.2vw, 2.35rem);
		line-height: 1.08;
		letter-spacing: -0.01em;
	}

	.question-strip {
		grid-column: 2;
		grid-row: 1 / span 2;
		padding: 18px;
		border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
		border-left: 4px solid color-mix(in srgb, var(--foreground) 40%, #3b82f6);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		box-shadow: 0 20px 60px -42px rgba(15, 23, 42, 0.4);
	}

	.question-strip span,
	.answer-note span,
	.guide-card span {
		display: block;
		font-size: 0.75rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.question-strip span {
		margin-bottom: 8px;
		color: color-mix(in srgb, var(--foreground) 62%, #3b82f6);
	}

	.question-strip strong {
		display: block;
		font-size: 1rem;
		line-height: 1.38;
	}

	.guides-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.9rem;
	}

	.guide-card {
		display: grid;
		min-height: 142px;
		align-content: start;
		gap: 0.65rem;
		padding: 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		color: inherit;
		text-decoration: none;
		box-shadow: 0 20px 60px -42px rgba(15, 23, 42, 0.34);
		transition:
			transform 0.16s ease,
			border-color 0.16s ease,
			box-shadow 0.16s ease;
	}

	.guide-card:hover {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--foreground) 32%, #3b82f6);
		box-shadow: 0 26px 70px -42px rgba(15, 23, 42, 0.48);
	}

	.guide-card span {
		color: color-mix(in srgb, var(--foreground) 58%, #3b82f6);
	}

	.guide-card strong {
		font-size: 1.08rem;
		line-height: 1.2;
	}

	.guide-card p,
	.answer-note p {
		margin: 0;
		color: #536170;
		line-height: 1.5;
	}

	.answer-note {
		margin-top: 18px;
		padding: 18px;
		border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 96%, var(--background));
	}

	.answer-note span {
		margin-bottom: 8px;
		color: color-mix(in srgb, var(--foreground) 58%, #3b82f6);
	}

	@media (max-width: 960px) {
		.guides-index__header {
			grid-template-columns: 1fr;
		}

		.guides-index__header > p,
		.guides-index h1,
		.question-strip {
			grid-column: auto;
			grid-row: auto;
		}

		.guides-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.guides-index {
			width: min(100% - 20px, 1120px);
			padding-top: 24px;
		}

		.guides-grid {
			grid-template-columns: 1fr;
		}

		.guide-card {
			min-height: 150px;
		}
	}
</style>
