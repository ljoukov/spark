<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sectionItems = $derived([
		{
			key: 'statement',
			title: 'Problem statement',
			value: data.sections.statement
		},
		{
			key: 'official-statement',
			title: 'Official problem statement',
			value: data.sections.officialStatement
		},
		{
			key: 'official-solution',
			title: 'Official solution',
			value: data.sections.officialSolution
		},
		{
			key: 'transcript',
			title: 'Student solution transcript',
			value: data.sections.transcript
		},
		{
			key: 'grading',
			title: 'Grading',
			value: data.sections.grading
		},
		{
			key: 'annotations',
			title: 'Annotation and feedback',
			value: data.sections.annotations
		},
		{
			key: 'overall',
			title: 'Overall feedback',
			value: data.sections.overall
		}
	]);
</script>

<svelte:head>
	<title>Spark · Grader problem</title>
</svelte:head>

<section class="grader-problem-page">
	<header class="problem-header">
		<div>
			<p class="eyebrow">Problem report</p>
			<h1>{data.problem.index}. {data.problem.title}</h1>
			<p class="subtitle">
				{data.problem.verdict ?? 'ungraded'} •
				{#if data.problem.awardedMarks !== null && data.problem.maxMarks !== null}
					{data.problem.awardedMarks}/{data.problem.maxMarks}
				{:else}
					Marks pending
				{/if}
			</p>
		</div>
		<div class="links">
			<a href={`/spark/grader/${data.run.id}`}>Back to run</a>
			<a href="/spark/grader">All runs</a>
		</div>
	</header>

	{#each sectionItems as section (section.key)}
		<section class="problem-section">
			<h2>{section.title}</h2>
			{#if section.value}
				<div class="markdown-content">{@html renderMarkdown(section.value)}</div>
			{:else}
				<p class="missing">Section missing in report.</p>
			{/if}
		</section>
	{/each}

	<details class="raw-report">
		<summary>Raw report markdown</summary>
		<pre>{data.sections.raw}</pre>
	</details>
</section>

<style lang="postcss">
	.grader-problem-page {
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
		width: min(78rem, 94vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.2rem, 3vw, 2rem);
	}

	.problem-header {
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
		font-size: clamp(1.4rem, 2.8vw, 1.95rem);
	}

	.subtitle {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.links a {
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

	.problem-section {
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 0.95rem;
	}

	.problem-section h2 {
		margin: 0 0 0.7rem;
		font-size: 1.02rem;
	}

	.missing {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
		font-style: italic;
	}

	.markdown-content :global(p:last-child) {
		margin-bottom: 0;
	}

	.markdown-content :global(ul),
	.markdown-content :global(ol) {
		margin: 0.5rem 0 0.75rem 1.25rem;
		padding: 0;
		list-style-position: outside;
	}

	.markdown-content :global(ul) {
		list-style: disc;
	}

	.markdown-content :global(ol) {
		list-style: decimal;
	}

	.markdown-content :global(li + li) {
		margin-top: 0.35rem;
	}

	.raw-report {
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
		border-radius: 1rem;
		padding: 0.8rem 0.9rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
	}

	.raw-report summary {
		cursor: pointer;
		font-weight: 600;
	}

	.raw-report pre {
		margin: 0.75rem 0 0;
		overflow-x: auto;
		font-size: 0.82rem;
		white-space: pre-wrap;
	}

	@media (max-width: 700px) {
		.problem-header {
			flex-direction: column;
		}
	}
</style>
