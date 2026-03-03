<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatMarks(awarded: number | null, max: number | null): string {
		if (awarded === null || max === null) {
			return '—';
		}
		return `${awarded.toString()}/${max.toString()}`;
	}

	function formatPercent(value: number | null): string {
		if (value === null || !Number.isFinite(value)) {
			return '—';
		}
		return `${value.toFixed(1)}%`;
	}
</script>

<svelte:head>
	<title>Spark · Grader run</title>
</svelte:head>

<section class="grader-run-page">
	<header class="grader-run-header">
		<div>
			<p class="eyebrow">Grader run</p>
			<h1>{data.run.paper?.paperName ?? data.run.olympiadLabel}</h1>
			<p class="subtitle">
				Status: <strong>{data.run.status}</strong> • Started {formatDate(data.run.createdAt)}
			</p>
		</div>
		<div class="run-links">
			<a class="back-link" href="/spark/grader">All runs</a>
			<a class="back-link" href="/spark">Chat</a>
		</div>
	</header>

	<section class="summary-card">
		<div class="summary-grid">
			<div>
				<span>Total marks</span>
				<p>
					{#if data.run.totals}
						{data.run.totals.awardedMarks}/{data.run.totals.maxMarks}
					{:else}
						—
					{/if}
				</p>
			</div>
			<div>
				<span>Problems</span>
				<p>{data.run.totals ? data.run.totals.problemCount : data.problems.length}</p>
			</div>
			<div>
				<span>Percentage</span>
				<p>{data.run.totals ? formatPercent(data.run.totals.percentage) : '—'}</p>
			</div>
			<div>
				<span>Updated</span>
				<p>{formatDate(data.run.updatedAt)}</p>
			</div>
		</div>
		{#if data.run.paper}
			<div class="paper-links">
				{#if data.run.paper.paperUrl}
					<a href={data.run.paper.paperUrl} target="_blank" rel="noreferrer">Paper source</a>
				{/if}
				{#if data.run.paper.markSchemeUrl}
					<a href={data.run.paper.markSchemeUrl} target="_blank" rel="noreferrer"
						>Mark scheme source</a
					>
				{/if}
			</div>
		{/if}
		{#if data.run.error}
			<p class="error-text">{data.run.error}</p>
		{:else if data.run.resultSummary}
			<p class="summary-text">{data.run.resultSummary}</p>
		{/if}
	</section>

	<section class="problems-card">
		<h2>Problems</h2>
		{#if data.problems.length === 0}
			<p class="muted">No problem outputs yet. The run may still be executing.</p>
		{:else}
			<ul>
				{#each data.problems as problem}
					<li>
						<a href={`/spark/grader/${data.run.id}/${problem.id}`}>
							<div>
								<p class="problem-title">
									{problem.index}. {problem.title}
								</p>
								<p class="problem-meta">
									{problem.verdict ?? 'ungraded'} • {formatMarks(
										problem.awardedMarks,
										problem.maxMarks
									)}
								</p>
							</div>
							<span class="chevron">›</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</section>

<style lang="postcss">
	.grader-run-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(74rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.3rem, 3vw, 2rem);
	}

	.grader-run-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
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
		font-size: clamp(1.45rem, 3vw, 2rem);
	}

	.subtitle {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.run-links {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		padding: 0.42rem 0.7rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		text-decoration: none;
		color: inherit;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		font-weight: 600;
	}

	.summary-card,
	.problems-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.summary-grid {
		display: grid;
		gap: 0.7rem;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
	}

	.summary-grid span {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
	}

	.summary-grid p {
		margin: 0.2rem 0 0;
		font-weight: 600;
	}

	.paper-links {
		display: flex;
		gap: 0.65rem;
		margin-top: 0.9rem;
		flex-wrap: wrap;
	}

	.paper-links a {
		font-size: 0.86rem;
	}

	.summary-text,
	.error-text {
		margin: 0.8rem 0 0;
		font-size: 0.9rem;
	}

	.error-text {
		color: color-mix(in srgb, var(--destructive) 75%, black 10%);
	}

	.problems-card h2 {
		margin: 0;
		font-size: 1.08rem;
	}

	.problems-card ul {
		list-style: none;
		margin: 0.8rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.problems-card li a {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: center;
		padding: 0.75rem 0.8rem;
		border-radius: 0.75rem;
		text-decoration: none;
		color: inherit;
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
	}

	.problems-card li a:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}

	.problem-title {
		margin: 0;
		font-weight: 600;
	}

	.problem-meta {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.chevron {
		font-size: 1.2rem;
		color: color-mix(in srgb, var(--foreground) 55%, transparent);
	}

	.muted {
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
	}

	@media (max-width: 700px) {
		.grader-run-header {
			flex-direction: column;
		}
	}
</style>
