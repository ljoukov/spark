<script lang="ts">
	import { page } from '$app/stores';
	import Button from '$lib/components/ui/button/button.svelte';
	import { sparkFocusStore, sparkProgressStore } from '$lib/mock/spark-data';

	type SubjectTheme = {
		glow: string;
		accent: string;
		muted: string;
	};

	const subjectThemes: Record<string, SubjectTheme> = {
		Biology: {
			glow: 'rgba(34, 197, 94, 0.12)',
			accent: 'linear-gradient(90deg, rgba(16, 185, 129, 0.9), rgba(45, 212, 191, 0.9))',
			muted: 'rgba(16, 185, 129, 0.16)'
		},
		Chemistry: {
			glow: 'rgba(56, 189, 248, 0.12)',
			accent: 'linear-gradient(90deg, rgba(14, 165, 233, 0.9), rgba(34, 211, 238, 0.9))',
			muted: 'rgba(14, 165, 233, 0.16)'
		},
		Physics: {
			glow: 'rgba(129, 140, 248, 0.12)',
			accent: 'linear-gradient(90deg, rgba(99, 102, 241, 0.9), rgba(129, 140, 248, 0.9))',
			muted: 'rgba(99, 102, 241, 0.18)'
		}
	};

	let subject: string = 'Biology';
	let subjectTheme: SubjectTheme = subjectThemes.Biology;
	let subjectPercent = 0;
	let subjectDelta = 0;
	let subjectFocusCount = 0;

	const timeline = [
		{
			title: 'Electrolysis, redox & cells',
			result: 'Score 82%',
			date: 'Monday',
			type: 'Full session'
		},
		{ title: 'Required practicals mix', result: 'Score 76%', date: 'Saturday', type: 'Focus 10' },
		{
			title: 'Energy changes quick check',
			result: 'Score 88%',
			date: 'Last week',
			type: 'Timed sprint'
		}
	];

	$: subject = $page.url.searchParams.get('subject') ?? subject;
	$: currentProgress = $sparkProgressStore;
	$: {
		const match = currentProgress.progressRows.find((row) => row.subject === subject);
		const target = match ?? currentProgress.progressRows[0];
		subject = target.subject;
		subjectTheme = subjectThemes[target.subject];
		subjectPercent = target.percent;
		subjectDelta = target.delta;
		subjectFocusCount = target.focusCount;
	}

	$: relatedFocus = $sparkFocusStore.filter((focus) => focus.subject === subject).slice(0, 2);
</script>

<section
	class="spark-progress-detail"
	style={`--spark-progress-glow: ${subjectTheme.glow}; --spark-progress-accent: ${subjectTheme.accent}; --spark-progress-muted: ${subjectTheme.muted};`}
>
	<header class="spark-progress-detail__hero">
		<div>
			<p class="spark-progress-detail__eyebrow">{subject} mastery</p>
			<h1>{subjectPercent}% on spec</h1>
			<p class="spark-progress-detail__tagline">
				You're up {subjectDelta >= 0 ? `+${subjectDelta}` : subjectDelta} points this week. Keep it going
				with a fresh session to cement the wins.
			</p>
		</div>
		<div class="spark-progress-detail__cta">
			<Button href={`/spark/setup?subject=${encodeURIComponent(subject)}`} size="lg">
				Start session
			</Button>
			<Button href="/spark/results" variant="ghost">Review mistakes</Button>
		</div>
	</header>

	<div class="spark-progress-detail__grid">
		<section class="spark-progress-detail__card spark-progress-detail__card--summary">
			<h2>Snapshot</h2>
			<ul>
				<li>
					<strong>{subjectFocusCount}</strong>
					<span>Focus questions queued</span>
				</li>
				<li>
					<strong>8 days</strong>
					<span>Subject streak</span>
				</li>
				<li>
					<strong>41 min</strong>
					<span>Average time per session</span>
				</li>
				<li>
					<strong>4 topics</strong>
					<span>Marked for revision</span>
				</li>
			</ul>
		</section>

		<section class="spark-progress-detail__card spark-progress-detail__card--focus">
			<h2>Next focus</h2>
			<ul>
				{#each relatedFocus as focus}
					<li>
						<a href="/spark/setup" class="spark-progress-detail__focus">
							<h3>{focus.title}</h3>
							<p>{focus.description}</p>
							<span>{focus.count} questions</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>

		<section class="spark-progress-detail__card spark-progress-detail__card--timeline">
			<h2>Recent sessions</h2>
			<ul>
				{#each timeline as entry}
					<li>
						<div>
							<h3>{entry.title}</h3>
							<p>{entry.result}</p>
						</div>
						<div>
							<span>{entry.date}</span>
							<span>{entry.type}</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	</div>
</section>

<style>
	.spark-progress-detail {
		display: grid;
		gap: clamp(1.75rem, 4vw, 2.5rem);
	}

	.spark-progress-detail__hero {
		display: flex;
		justify-content: space-between;
		gap: 2rem;
		padding: clamp(1.75rem, 4vw, 2.5rem);
		border-radius: clamp(1.5rem, 4vw, 2rem);
		background: color-mix(in srgb, var(--surface-color) 96%, transparent 4%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		box-shadow: 0 32px 52px -44px var(--shadow-color);
		background-image: radial-gradient(
			circle at top right,
			var(--spark-progress-glow),
			transparent 45%
		);
	}

	.spark-progress-detail__eyebrow {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: color-mix(in srgb, var(--text-secondary) 72%, transparent 28%);
	}

	.spark-progress-detail__hero h1 {
		margin-top: 0.35rem;
		font-size: clamp(2.5rem, 6vw, 3rem);
		font-weight: 600;
	}

	.spark-progress-detail__tagline {
		margin-top: 0.75rem;
		font-size: 1rem;
		color: color-mix(in srgb, var(--text-secondary) 82%, transparent 18%);
		max-width: 32rem;
	}

	.spark-progress-detail__cta {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-end;
	}

	.spark-progress-detail__grid {
		display: grid;
		gap: clamp(1.5rem, 4vw, 2rem);
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	}

	.spark-progress-detail__card {
		background: color-mix(in srgb, var(--surface-color) 95%, transparent 5%);
		border-radius: clamp(1.25rem, 4vw, 1.75rem);
		border: 1px solid color-mix(in srgb, var(--surface-border) 72%, transparent 28%);
		padding: clamp(1.5rem, 3vw, 2rem);
		display: grid;
		gap: 1rem;
		box-shadow: 0 24px 48px -38px var(--shadow-color);
	}

	.spark-progress-detail__card h2 {
		font-size: 1.1rem;
		font-weight: 600;
	}

	.spark-progress-detail__card--summary ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
	}

	.spark-progress-detail__card--summary li {
		padding: 1rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--spark-progress-muted) 80%, transparent 20%);
		border: 1px solid color-mix(in srgb, var(--spark-progress-muted) 40%, transparent 60%);
		display: grid;
		gap: 0.35rem;
	}

	.spark-progress-detail__card--summary strong {
		font-size: 1.2rem;
		font-weight: 600;
	}

	.spark-progress-detail__card--summary span {
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-progress-detail__card--focus ul,
	.spark-progress-detail__card--timeline ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.9rem;
	}

	.spark-progress-detail__focus {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
		border-radius: 1.1rem;
		text-decoration: none;
		color: inherit;
		background: color-mix(in srgb, var(--spark-progress-muted) 60%, transparent 40%);
		border: 1px solid color-mix(in srgb, var(--spark-progress-muted) 50%, transparent 50%);
		transition:
			transform 160ms ease,
			box-shadow 200ms ease,
			border 160ms ease;
	}

	.spark-progress-detail__focus:hover {
		transform: translateY(-3px);
		box-shadow: 0 20px 42px -40px var(--shadow-color);
		border-color: color-mix(in srgb, var(--spark-progress-muted) 80%, transparent 20%);
	}

	.spark-progress-detail__focus h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.spark-progress-detail__focus p {
		font-size: 0.9rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-progress-detail__focus span {
		font-size: 0.8rem;
		font-weight: 600;
		color: color-mix(in srgb, var(--text-secondary) 75%, transparent 25%);
	}

	.spark-progress-detail__card--timeline li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-radius: 1.1rem;
		background: color-mix(in srgb, var(--surface-color) 92%, transparent 8%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
	}

	.spark-progress-detail__card--timeline h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.spark-progress-detail__card--timeline p {
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-progress-detail__card--timeline span {
		display: block;
		font-size: 0.8rem;
		color: color-mix(in srgb, var(--text-secondary) 78%, transparent 22%);
		text-align: right;
	}

	@media (max-width: 880px) {
		.spark-progress-detail__hero {
			flex-direction: column;
		}

		.spark-progress-detail__cta {
			align-items: flex-start;
		}
	}
</style>
