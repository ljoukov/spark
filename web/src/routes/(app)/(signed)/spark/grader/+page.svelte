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

	function formatMarks(awarded: number, max: number): string {
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
	<title>Spark · Grader runs</title>
</svelte:head>

<section class="grader-runs-page">
	<header class="grader-runs-header">
		<div>
			<p class="eyebrow">Olympiad grading</p>
			<h1>Grader runs</h1>
			<p class="subtitle">
				Open a run to inspect totals, per-problem marks, transcripts, and feedback.
			</p>
		</div>
		<a class="back-button" href="/spark">Back to chat</a>
	</header>

	{#if data.runs.length === 0}
		<div class="empty-state">
			<h2>No grader runs yet</h2>
			<p>Start a run from chat by uploading solutions and asking Spark to grade the paper.</p>
		</div>
	{:else}
		<div class="runs-grid">
			{#each data.runs as run}
				<a class="run-card" href={`/spark/grader/${run.id}`} data-status={run.status}>
					<div class="run-card__meta">
						<span class="run-status">{run.status}</span>
						<span>{formatDate(run.createdAt)}</span>
					</div>
					<h2>{run.paper?.paperName ?? run.olympiadLabel}</h2>
					<p class="run-paper">
						{run.paper?.year ? `Year ${run.paper.year}` : 'Year pending'} • {run.paper?.olympiad ??
							run.olympiadLabel}
					</p>
					<div class="run-stats">
						<div>
							<span>Marks</span>
							<p>
								{#if run.totals}
									{formatMarks(run.totals.awardedMarks, run.totals.maxMarks)}
								{:else}
									—
								{/if}
							</p>
						</div>
						<div>
							<span>Problems</span>
							<p>{run.totals ? run.totals.problemCount : '—'}</p>
						</div>
						<div>
							<span>Percent</span>
							<p>{run.totals ? formatPercent(run.totals.percentage) : '—'}</p>
						</div>
					</div>
					{#if run.error}
						<p class="run-error">{run.error}</p>
					{:else if run.resultSummary}
						<p class="run-summary">{run.resultSummary}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</section>

<style lang="postcss">
	.grader-runs-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(78rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.3rem, 3vw, 2rem);
	}

	.grader-runs-header {
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

	.grader-runs-header h1 {
		margin: 0;
		font-size: clamp(1.5rem, 3vw, 2.1rem);
	}

	.subtitle {
		margin: 0.4rem 0 0;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		max-width: 44rem;
	}

	.back-button {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		background: color-mix(in srgb, var(--card) 94%, transparent);
		text-decoration: none;
		font-weight: 600;
		color: inherit;
	}

	.empty-state {
		border: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
		border-radius: 1rem;
		padding: 1.2rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.empty-state h2 {
		margin: 0;
	}

	.empty-state p {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.runs-grid {
		display: grid;
		gap: 0.9rem;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
	}

	.run-card {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1rem;
		text-decoration: none;
		color: inherit;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
		background: color-mix(in srgb, var(--card) 95%, transparent);
	}

	.run-card:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}

	.run-card__meta {
		display: flex;
		justify-content: space-between;
		gap: 0.7rem;
		font-size: 0.78rem;
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	.run-status {
		text-transform: uppercase;
		font-weight: 700;
		letter-spacing: 0.06em;
	}

	.run-card h2 {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.35;
	}

	.run-paper {
		margin: 0;
		font-size: 0.84rem;
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.run-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.run-stats span {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: color-mix(in srgb, var(--foreground) 56%, transparent);
	}

	.run-stats p {
		margin: 0.18rem 0 0;
		font-size: 0.96rem;
		font-weight: 600;
	}

	.run-summary,
	.run-error {
		margin: 0;
		font-size: 0.82rem;
	}

	.run-error {
		color: color-mix(in srgb, var(--destructive) 75%, black 8%);
	}

	@media (max-width: 700px) {
		.grader-runs-header {
			flex-direction: column;
		}
	}
</style>
