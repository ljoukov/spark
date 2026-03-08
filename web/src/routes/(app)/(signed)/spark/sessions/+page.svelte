<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type SectionKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';

	const SECTION_ORDER: Array<{ key: SectionKey; label: string }> = [
		{ key: 'today', label: 'Today' },
		{ key: 'yesterday', label: 'Yesterday' },
		{ key: 'last7Days', label: 'Last 7 days' },
		{ key: 'last30Days', label: 'Last 30 days' },
		{ key: 'older', label: 'Older' }
	];

	function resolveSectionKey(value: string): SectionKey {
		const timestamp = new Date(value);
		if (Number.isNaN(timestamp.getTime())) {
			return 'older';
		}
		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);
		const startOfYesterday = new Date(startOfToday);
		startOfYesterday.setDate(startOfYesterday.getDate() - 1);
		const startOfLast7Days = new Date(startOfToday);
		startOfLast7Days.setDate(startOfLast7Days.getDate() - 7);
		const startOfLast30Days = new Date(startOfToday);
		startOfLast30Days.setDate(startOfLast30Days.getDate() - 30);

		if (timestamp >= startOfToday) {
			return 'today';
		}
		if (timestamp >= startOfYesterday) {
			return 'yesterday';
		}
		if (timestamp >= startOfLast7Days) {
			return 'last7Days';
		}
		if (timestamp >= startOfLast30Days) {
			return 'last30Days';
		}
		return 'older';
	}

	function formatRelativeDate(value: string): string {
		const timestamp = new Date(value);
		if (Number.isNaN(timestamp.getTime())) {
			return value;
		}
		const diffMs = Date.now() - timestamp.getTime();
		const minutes = Math.floor(diffMs / 60_000);
		const hours = Math.floor(diffMs / 3_600_000);
		if (minutes < 1) {
			return 'just now';
		}
		if (minutes < 60) {
			return `${minutes.toString()}m ago`;
		}
		if (hours < 24) {
			return `${hours.toString()}h ago`;
		}
		if (hours < 48) {
			return 'Yesterday';
		}
		return timestamp.toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short'
		});
	}

	const sections = $derived.by(() => {
		const grouped = new Map<SectionKey, typeof data.sessions>();
		for (const section of SECTION_ORDER) {
			grouped.set(section.key, []);
		}
		for (const session of data.sessions) {
			grouped.get(resolveSectionKey(session.updatedAt))?.push(session);
		}
		return SECTION_ORDER.map((section) => ({
			...section,
			items: grouped.get(section.key) ?? []
		})).filter((section) => section.items.length > 0);
	});
</script>

<svelte:head>
	<title>Spark · Tutor sessions</title>
</svelte:head>

<section class="sessions-page">
	<header class="sessions-header">
		<div>
			<p class="eyebrow">Experimental tutor</p>
			<h1>Tutor sessions</h1>
			<p class="subtitle">
				Continue guided work on graded problems with a single-screen coaching flow.
			</p>
		</div>
		<div class="links">
			<a href="/spark/grader">Grader</a>
			<a href="/spark">Chat</a>
		</div>
	</header>

	{#if data.sessions.length === 0}
		<section class="empty-card">
			<h2>No tutor sessions yet</h2>
			<p>Start one from a grader problem report.</p>
		</section>
	{:else}
		{#each sections as section (section.key)}
			<section class="session-section">
				<div class="section-heading">
					<h2>{section.label}</h2>
				</div>
				<div class="session-list">
					{#each section.items as session (session.id)}
						<a class="session-card" href={`/spark/sessions/${session.id}`}>
							<div class="card-topline">
								<span class="status-pill" data-status={session.status}>{session.status}</span>
								<span>{formatRelativeDate(session.updatedAt)}</span>
							</div>
							<h3>{session.title}</h3>
							<p class="meta">
								Problem {session.source.problemIndex}. {session.source.problemTitle}
							</p>
							{#if session.preview}
								<p class="preview">{session.preview}</p>
							{/if}
							<p class="footer">
								{#if session.focusLabel}
									<span>{session.focusLabel}</span>
								{/if}
								{#if session.source.awardedMarks !== null && session.source.maxMarks !== null}
									<span>{session.source.awardedMarks}/{session.source.maxMarks}</span>
								{/if}
							</p>
						</a>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</section>

<style lang="postcss">
	.sessions-page {
		width: min(74rem, 92vw);
		margin: 0 auto 3rem;
		padding-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sessions-header {
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

	.links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.links a,
	.session-card {
		text-decoration: none;
		color: inherit;
	}

	.links a {
		display: inline-flex;
		align-items: center;
		padding: 0.42rem 0.7rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		background: color-mix(in srgb, var(--card) 95%, transparent);
		font-weight: 600;
	}

	.empty-card,
	.session-section {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.session-section {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.section-heading h2,
	.empty-card h2 {
		margin: 0;
		font-size: 1rem;
	}

	.empty-card p {
		margin: 0.45rem 0 0;
	}

	.session-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 0.8rem;
	}

	.session-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--background) 55%, transparent);
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.card-topline,
	.footer {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border) 70%, transparent);
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.status-pill[data-status='awaiting_student'] {
		background: color-mix(in srgb, #2563eb 16%, transparent);
		color: color-mix(in srgb, #1d4ed8 92%, black 5%);
	}

	.status-pill[data-status='responding'] {
		background: color-mix(in srgb, #f59e0b 18%, transparent);
		color: color-mix(in srgb, #92400e 92%, black 5%);
	}

	.status-pill[data-status='completed'] {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: color-mix(in srgb, #166534 90%, black 6%);
	}

	h3 {
		margin: 0;
		font-size: 1.05rem;
	}

	.meta,
	.preview {
		margin: 0;
	}

	.meta {
		color: color-mix(in srgb, var(--foreground) 64%, transparent);
		font-size: 0.9rem;
	}

	.preview {
		color: color-mix(in srgb, var(--foreground) 78%, transparent);
	}

	@media (max-width: 700px) {
		.sessions-header {
			flex-direction: column;
		}
	}
</style>
