<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { bundle, day, referrer } = data;
</script>

<svelte:head>
	<title>Advent Day {day} · {bundle.session.title}</title>
</svelte:head>

<section class="detail-page">
	<header class="hero">
		<a class="back" href={referrer}>← Back to calendar</a>
		<p class="eyebrow">Day {day}</p>
		<h1>
			<span class="hero-emoji" aria-hidden="true">{bundle.session.emoji ?? '🎄'}</span>
			{bundle.session.title}
		</h1>
		<p class="tagline">{bundle.session.tagline}</p>
		<p class="summary">{bundle.session.summary}</p>
	</header>

	<section class="section">
		<h2>Plan</h2>
		<ul class="plan">
			{#each bundle.session.plan ?? [] as item}
				<li>
					<span class="pill">{item.kind}</span>
					<div>
						<strong>{item.title}</strong>
						{#if item.summary}<p class="muted">{item.summary}</p>{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<section class="section">
		<h2>Quizzes</h2>
		<div class="cards">
			{#each bundle.quizzes as quiz}
				<article class="card">
					<p class="eyebrow small">{quiz.id}</p>
					<h3>{quiz.title}</h3>
					<p class="muted">{quiz.description}</p>
					<p class="meta">{quiz.questions.length} questions · {quiz.topic ?? 'quiz'}</p>
				</article>
			{/each}
		</div>
	</section>

	<section class="section">
		<h2>Problems</h2>
		<div class="cards">
			{#each bundle.problems as problem}
				<article class="card">
					<p class="eyebrow small">{problem.slug}</p>
					<h3>{problem.title}</h3>
					<p class="muted topics">{problem.topics.join(', ')}</p>
					<p class="pill problem-pill">{problem.difficulty}</p>
					<p class="description">{problem.description}</p>
					<h4>Input</h4>
					<p class="mono">{problem.inputFormat}</p>
					<h4>Constraints</h4>
					<ul class="constraints">
						{#each problem.constraints as c}
							<li>{c}</li>
						{/each}
					</ul>
					<h4>Example</h4>
					<pre class="mono">{problem.examples[0].input}\n→ {problem.examples[0].output}</pre>
				</article>
			{/each}
		</div>
	</section>
</section>

<style>
	.detail-page {
		width: min(110rem, 96vw);
		margin: 0 auto clamp(1.5rem, 3vw, 2.5rem);
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
	}

	.hero {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.back {
		text-decoration: none;
		color: var(--app-subtitle-color);
		font-weight: 600;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
		color: rgba(59, 130, 246, 0.85);
		margin: 0;
	}

	.hero h1 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: clamp(2rem, 3.6vw, 2.6rem);
	}

	.hero-emoji {
		font-size: clamp(3rem, 6vw, 4.6rem);
		line-height: 1;
	}

	.tagline {
		margin: 0;
		font-weight: 600;
		color: var(--app-subtitle-color);
	}

	.summary {
		margin: 0;
		color: rgba(71, 85, 105, 0.9);
	}

	.section h2 {
		margin: 0 0 0.4rem;
	}

	.plan {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.plan li {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		padding: 0.6rem 0.8rem;
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.85rem;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.35);
		background: rgba(148, 163, 184, 0.16);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 0.9rem;
	}

	.card {
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 1rem;
		padding: 0.9rem 1rem;
		background: rgba(255, 255, 255, 0.9);
		display: grid;
		gap: 0.35rem;
	}

	.muted {
		color: rgba(71, 85, 105, 0.82);
		margin: 0;
	}

	.meta {
		font-weight: 700;
		margin: 0;
	}

	.topics {
		font-style: italic;
	}

	.problem-pill {
		width: fit-content;
		text-transform: capitalize;
	}

	.description {
		margin: 0.2rem 0;
	}

	.constraints {
		margin: 0;
		padding-left: 1.1rem;
		color: rgba(71, 85, 105, 0.9);
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		white-space: pre-wrap;
		margin: 0;
	}

	.eyebrow.small {
		font-size: 0.72rem;
	}

	@media (max-width: 720px) {
		.cards {
			grid-template-columns: 1fr;
		}
	}
</style>
