<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		sparkFocusStore,
		sparkProgressStore,
		sparkSessionStore,
		sparkUploadsStore
	} from '$lib/mock/spark-data';

	const subjectStyles: Record<string, { accent: string; track: string }> = {
		Biology: {
			accent: 'linear-gradient(90deg, rgba(16, 185, 129, 0.9), rgba(34, 197, 94, 0.9))',
			track: 'rgba(16, 185, 129, 0.16)'
		},
		Chemistry: {
			accent: 'linear-gradient(90deg, rgba(14, 165, 233, 0.9), rgba(56, 189, 248, 0.9))',
			track: 'rgba(14, 165, 233, 0.16)'
		},
		Physics: {
			accent: 'linear-gradient(90deg, rgba(129, 140, 248, 0.9), rgba(99, 102, 241, 0.9))',
			track: 'rgba(99, 102, 241, 0.16)'
		}
	};
</script>

<section class="spark-home">
	<div class="spark-home__grid">
		<article class="spark-card spark-card--progress">
			<header class="spark-card__header">
				<div>
					<h2>Your Progress</h2>
					<p>Fuel your streak with focused sets across Biology, Chemistry, and Physics.</p>
				</div>
				<span class="spark-chip">{$sparkProgressStore.trendLabel}</span>
			</header>
			<div class="spark-progress-overview">
				<div class="spark-progress-overview__score">
					{$sparkProgressStore.overall}<span>% ready</span>
				</div>
				<div class="spark-progress-overview__meter">
					<span style={`width: ${$sparkProgressStore.overall}%`}></span>
				</div>
				<p class="spark-progress-overview__foot">
					{$sparkProgressStore.weeklyMinutes} min this week
				</p>
			</div>
			<ul class="spark-progress-list">
				{#each $sparkProgressStore.progressRows as row}
					<li>
						<a
							href={`/spark/progress?subject=${encodeURIComponent(row.subject)}`}
							style={`--spark-progress-accent: ${subjectStyles[row.subject].accent}; --spark-progress-track: ${subjectStyles[row.subject].track};`}
						>
							<div class="spark-progress-list__subject">
								<span>{row.subject}</span>
								<span>{row.delta >= 0 ? `+${row.delta}` : row.delta}% this week</span>
							</div>
							<div class="spark-progress-list__bar">
								<span style={`width: ${row.percent}%`}></span>
							</div>
							<div class="spark-progress-list__meta">
								<span>{row.percent}% ready</span>
								<span>{row.streakDays}-day streak • Focus {row.focusCount}</span>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</article>

		<article class="spark-card spark-card--session">
			<header class="spark-card__header">
				<div>
					<h2>{$sparkSessionStore.status === 'resume' ? 'Resume session' : 'Next session'}</h2>
					<p>
						{$sparkSessionStore.status === 'resume'
							? `${$sparkSessionStore.subject} • ${$sparkSessionStore.remaining} left`
							: `Based on ${$sparkSessionStore.sourceTitle}`}
					</p>
				</div>
				<a href="/spark/setup" class="spark-card__more" aria-label="Adjust session">Change size</a>
			</header>
			<div class="spark-session-body">
				<div class="spark-session-body__title">{$sparkSessionStore.sourceTitle}</div>
				<div class="spark-session-body__meta">
					<span
						>{$sparkSessionStore.status === 'resume'
							? `${$sparkSessionStore.total - ($sparkSessionStore.remaining ?? 0)} of ${$sparkSessionStore.total} done`
							: `${$sparkSessionStore.total} questions`}</span
					>
					<span>{$sparkSessionStore.scope}</span>
					<span>{$sparkSessionStore.timer ? 'Timer on' : 'Timer off'}</span>
				</div>
			</div>
			<div class="spark-session-actions">
				<Button href="/spark/quiz" size="lg">Start quiz</Button>
				<Button href="/spark/setup" variant="ghost">New variant</Button>
			</div>
		</article>

		<article class="spark-card spark-card--library">
			<header class="spark-card__header">
				<div>
					<h2>Library glance</h2>
					<p>Jump back into your freshest upload.</p>
				</div>
			</header>
			{#if $sparkUploadsStore.length > 0}
				{@const latest = $sparkUploadsStore[0]}
				<div class="spark-library-highlight" style={`--spark-library-gradient: ${latest.color};`}>
					<div class="spark-library-highlight__meta">
						<span class="spark-library-highlight__badge">{latest.subject}</span>
						<h3>{latest.title}</h3>
						<p>{latest.specCodes}</p>
					</div>
					<div class="spark-library-highlight__stats">
						<span>{latest.items} items</span>
						<span>Last used {latest.lastUsed}</span>
					</div>
				</div>
			{/if}
			<div class="spark-library-actions">
				<Button href="/spark/library" variant="outline">Open Library</Button>
				<Button href="/spark/setup">Start from last upload</Button>
			</div>
		</article>
	</div>

	<section class="spark-focus">
		<header>
			<h2>Keep the spark</h2>
			<p>Pick a focus set to sharpen tricky concepts before exams land.</p>
		</header>
		<ul>
			{#each $sparkFocusStore as focus}
				<li>
					<a href="/spark/results" class="spark-focus__card">
						<span class="spark-focus__subject">{focus.subject}</span>
						<h3>{focus.title}</h3>
						<p>{focus.description}</p>
						<span class="spark-focus__count">{focus.count} questions</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
</section>

<style>
	.spark-home {
		display: grid;
		gap: clamp(2rem, 5vw, 3rem);
	}

	.spark-home__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: clamp(1.75rem, 4vw, 2.5rem);
	}

	.spark-card {
		background: color-mix(in srgb, var(--surface-color) 95%, transparent 5%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		border-radius: clamp(1.25rem, 4vw, 1.75rem);
		padding: clamp(1.5rem, 3vw, 2.25rem);
		box-shadow: 0 24px 48px -36px var(--shadow-color);
		display: grid;
		gap: clamp(1rem, 3vw, 1.75rem);
	}

	.spark-card__header {
		display: flex;
		justify-content: space-between;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.spark-card__header h2 {
		font-size: clamp(1.1rem, 2vw, 1.35rem);
		font-weight: 600;
		margin-bottom: 0.35rem;
	}

	.spark-card__header p {
		margin: 0;
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 88%, transparent 12%);
	}

	.spark-chip {
		align-self: flex-start;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(14, 165, 233, 0.18));
		border-radius: 999px;
		padding: 0.4rem 0.85rem;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.spark-progress-overview {
		display: grid;
		gap: 0.75rem;
	}

	.spark-progress-overview__score {
		font-size: clamp(2.75rem, 6vw, 3.25rem);
		font-weight: 600;
		line-height: 1;
		color: var(--text-primary);
		text-shadow: 0 16px 32px -24px var(--shadow-color);
	}

	.spark-progress-overview__score span {
		display: block;
		font-size: 0.9rem;
		font-weight: 500;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
		margin-top: 0.35rem;
	}

	.spark-progress-overview__meter {
		position: relative;
		height: 0.75rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 16%, transparent 84%);
		overflow: hidden;
	}

	.spark-progress-overview__meter span {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(90deg, rgba(59, 130, 246, 0.95), rgba(14, 116, 233, 0.95));
		box-shadow: 0 10px 20px -16px var(--shadow-color);
	}

	.spark-progress-overview__foot {
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-progress-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.spark-progress-list a {
		display: grid;
		gap: 0.6rem;
		padding: 0.9rem 1rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface-color) 92%, transparent 8%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		text-decoration: none;
		color: inherit;
		transition:
			transform 160ms ease,
			box-shadow 200ms ease,
			border 160ms ease,
			background 160ms ease;
	}

	.spark-progress-list a:hover {
		transform: translateY(-4px);
		border-color: color-mix(in srgb, var(--accent) 50%, transparent 50%);
		box-shadow: 0 20px 40px -34px var(--shadow-color);
		background: color-mix(in srgb, var(--surface-color) 88%, transparent 12%);
	}

	.spark-progress-list__subject {
		display: flex;
		justify-content: space-between;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.spark-progress-list__subject span:last-child {
		font-size: 0.8rem;
		font-weight: 600;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-progress-list__bar {
		position: relative;
		height: 0.65rem;
		border-radius: 999px;
		background: var(--spark-progress-track);
		overflow: hidden;
	}

	.spark-progress-list__bar span {
		position: absolute;
		inset: 0;
		background: var(--spark-progress-accent);
		border-radius: inherit;
	}

	.spark-progress-list__meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: color-mix(in srgb, var(--text-secondary) 78%, transparent 22%);
	}

	.spark-card__more {
		font-size: 0.85rem;
		text-decoration: none;
		font-weight: 600;
		color: color-mix(in srgb, var(--text-secondary) 90%, transparent 10%);
	}

	.spark-card__more:hover {
		color: var(--text-primary);
	}

	.spark-session-body {
		display: grid;
		gap: 0.75rem;
	}

	.spark-session-body__title {
		font-size: 1.1rem;
		font-weight: 600;
	}

	.spark-session-body__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-session-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.spark-card--library {
		display: flex;
		flex-direction: column;
	}

	.spark-library-highlight {
		position: relative;
		padding: 1.5rem;
		border-radius: 1.5rem;
		background: linear-gradient(135deg, var(--spark-library-gradient));
		color: white;
		display: grid;
		gap: 1.25rem;
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.06),
			0 32px 60px -48px rgba(15, 23, 42, 0.75);
	}

	.spark-library-highlight__badge {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		background: rgba(255, 255, 255, 0.18);
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
	}

	.spark-library-highlight h3 {
		font-size: 1.15rem;
		font-weight: 600;
	}

	.spark-library-highlight p {
		margin: 0;
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.85);
	}

	.spark-library-highlight__stats {
		display: flex;
		gap: 0.75rem;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.82);
		flex-wrap: wrap;
	}

	.spark-library-actions {
		margin-top: auto;
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.spark-focus {
		display: grid;
		gap: 1.5rem;
	}

	.spark-focus header {
		display: grid;
		gap: 0.5rem;
	}

	.spark-focus h2 {
		font-size: clamp(1.2rem, 2.5vw, 1.5rem);
		font-weight: 600;
	}

	.spark-focus p {
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 82%, transparent 18%);
	}

	.spark-focus ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: clamp(1rem, 3vw, 1.75rem);
	}

	.spark-focus__card {
		display: grid;
		gap: 0.65rem;
		padding: 1.25rem;
		border-radius: 1.25rem;
		background: color-mix(in srgb, var(--accent) 18%, transparent 82%);
		text-decoration: none;
		color: inherit;
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		transition:
			transform 160ms ease,
			border 160ms ease,
			box-shadow 200ms ease;
	}

	.spark-focus__card:hover {
		transform: translateY(-4px);
		border-color: color-mix(in srgb, var(--accent) 55%, transparent 45%);
		box-shadow: 0 22px 48px -40px var(--shadow-color);
	}

	.spark-focus__subject {
		font-size: 0.75rem;
		text-transform: uppercase;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-focus__card h3 {
		font-size: 1.05rem;
		font-weight: 600;
	}

	.spark-focus__card p {
		font-size: 0.9rem;
		color: color-mix(in srgb, var(--text-secondary) 85%, transparent 15%);
	}

	.spark-focus__count {
		font-size: 0.8rem;
		font-weight: 600;
		color: color-mix(in srgb, var(--text-secondary) 75%, transparent 25%);
	}

	@media (max-width: 768px) {
		.spark-card__header {
			flex-direction: column;
		}

		.spark-session-actions,
		.spark-library-actions {
			flex-direction: column;
		}
	}
</style>
