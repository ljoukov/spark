<script lang="ts">
	import type { PageData } from './$types';

	type WelcomeTemplate = {
		key: string;
		sessionId: string;
		title: string;
		tagline?: string | null;
		emoji?: string | null;
		posterImageUrl?: string | null;
		existingLessonStatus?: string | null;
	};

	const statusLabels: Record<string, string> = {
		generating: 'Generating',
		error: 'Error',
		ready: 'Ready',
		in_progress: 'In progress',
		completed: 'Completed'
	};

	import type { ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();
	const templates = $derived(data.welcomeTemplates as WelcomeTemplate[]);

	function formatDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return '';
		}
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}

	function progressPercent(completed: number, total: number): number {
		if (total <= 0) {
			return 0;
		}
		return Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
	}

	function resolveTemplateCta(template: WelcomeTemplate): string {
		if (template.existingLessonStatus && template.existingLessonStatus !== 'completed') {
			return 'Continue';
		}
		return 'Start';
	}
</script>

<svelte:head>
	<title>Spark Code · Lessons</title>
</svelte:head>

<section class="lessons-page">
	<header class="lessons-header">
		<div>
			<p class="eyebrow">Lessons</p>
			<h1>All sessions</h1>
			<p class="subtitle">Reverse chronological view of everything you've started or finished.</p>
		</div>
		<a class="back-button" href="/code">Back to today</a>
	</header>

	<div class="lessons-panel">
		{#if data.lessons.length === 0}
			<div class="empty-state">
				<div class="empty-emoji" aria-hidden="true">📘</div>
				<div class="empty-copy">
					<h2>No lessons yet</h2>
					<p>Complete your first session to see it here.</p>
				</div>
			</div>
		{:else}
			<div class="lessons-grid">
				{#each data.lessons as lesson}
					<a class="lesson-card" href={`/code/${lesson.id}`} data-status={lesson.status}>
						<div class="lesson-meta">
							<span class="lesson-emoji" aria-hidden="true">{lesson.emoji}</span>
							<span class="lesson-status" data-state={lesson.status}>
								{statusLabels[lesson.status] ?? lesson.status}
							</span>
							<span class="lesson-date">{formatDate(lesson.createdAt)}</span>
						</div>
						<h3>{lesson.title}</h3>
						{#if lesson.tagline}
							<p class="lesson-tagline">{lesson.tagline}</p>
						{/if}
						<div class="lesson-progress">
							<div class="progress-track" aria-hidden="true">
								<div
									class="progress-fill"
									style={`--progress:${progressPercent(lesson.completed, lesson.total)}%`}
									data-state={lesson.status}
								></div>
							</div>
							{#if lesson.total > 0}
								<span class="progress-label">
									{lesson.completed}/{lesson.total} steps
								</span>
							{:else}
								<span class="progress-label muted">Content is being generated</span>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<section class="templates-panel">
		<header class="templates-header">
			<div>
				<p class="eyebrow">Starter options</p>
				<h2>Welcome templates</h2>
				<p class="subtitle">Want a fresh start? Launch any of our built-in starter sessions.</p>
			</div>
		</header>

		{#if form?.error}
			<p class="template-error">{form.error}</p>
		{/if}

		{#if templates.length === 0}
			<div class="empty-state">
				<div class="empty-emoji" aria-hidden="true">🧭</div>
				<div class="empty-copy">
					<h3>No templates available</h3>
					<p>Starter lessons will appear here when configured.</p>
				</div>
			</div>
		{:else}
			<div class="templates-grid">
				{#each templates as template}
					<form method="POST" action="?/start" class="template-card">
						<input type="hidden" name="topic" value={template.key} />
						<div class="template-visual">
							{#if template.posterImageUrl}
								<img
									src={template.posterImageUrl}
									alt=""
									class="template-poster"
									loading="lazy"
									decoding="async"
								/>
							{:else}
								<div class="template-emoji" aria-hidden="true">
									{template.emoji ?? '🚀'}
								</div>
							{/if}
						</div>
						<div class="template-body">
							<h3>{template.title}</h3>
							{#if template.tagline}
								<p class="template-tagline">{template.tagline}</p>
							{/if}
						</div>
						<button type="submit" class="template-action">{resolveTemplateCta(template)}</button>
					</form>
				{/each}
			</div>
		{/if}
	</section>
</section>

<style lang="postcss">
	.lessons-page {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
		width: min(80rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.5rem, 3vw, 2.4rem);
		padding-bottom: clamp(1.5rem, 3vw, 2.4rem);
	}

	.lessons-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		color: rgba(59, 130, 246, 0.85);
		font-weight: 600;
	}

	.lessons-header h1 {
		margin: 0 0 0.3rem;
		font-size: clamp(1.6rem, 3vw, 2.2rem);
	}

	.subtitle {
		margin: 0;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	:global([data-theme='dark'] .subtitle),
	:global(:root:not([data-theme='light']) .subtitle) {
		color: rgba(203, 213, 225, 0.78);
	}

	.back-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		border-radius: 999px;
		text-decoration: none;
		border: 1px solid rgba(148, 163, 184, 0.35);
		font-weight: 600;
		color: inherit;
	}

	.lessons-panel {
		padding: 1.2rem;
		border-radius: 1.2rem;
		background: color-mix(in srgb, var(--app-content-bg) 88%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 24px 70px -55px rgba(15, 23, 42, 0.45);
	}

	:global([data-theme='dark'] .lessons-panel),
	:global(:root:not([data-theme='light']) .lessons-panel) {
		background: rgba(10, 16, 35, 0.75);
		border-color: rgba(148, 163, 184, 0.28);
	}

	.lessons-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: clamp(0.9rem, 2vw, 1.3rem);
	}

	.lesson-card {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 1rem 1rem 1.1rem;
		border-radius: 1.1rem;
		text-decoration: none;
		background: color-mix(in srgb, var(--app-content-bg) 86%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 18px 50px -40px rgba(15, 23, 42, 0.45);
		color: inherit;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease,
			border-color 0.15s ease;
	}

	.lesson-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 24px 60px -44px rgba(37, 99, 235, 0.35);
		border-color: rgba(59, 130, 246, 0.35);
	}

	:global([data-theme='dark'] .lesson-card),
	:global(:root:not([data-theme='light']) .lesson-card) {
		background: rgba(10, 16, 35, 0.8);
		border-color: rgba(148, 163, 184, 0.28);
	}

	.lesson-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.72));
	}

	.lesson-emoji {
		font-size: 1.25rem;
		line-height: 1;
	}

	.lesson-status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 600;
		background: rgba(59, 130, 246, 0.12);
		color: #1d4ed8;
	}

	.lesson-status[data-state='completed'] {
		background: rgba(34, 197, 94, 0.16);
		color: #166534;
	}

	.lesson-status[data-state='in_progress'] {
		background: rgba(249, 115, 22, 0.16);
		color: #c2410c;
	}

	.lesson-status[data-state='generating'] {
		background: rgba(59, 130, 246, 0.16);
		color: #1d4ed8;
	}

	.lesson-status[data-state='error'] {
		background: rgba(239, 68, 68, 0.16);
		color: #991b1b;
	}

	.lesson-date {
		margin-left: auto;
		font-size: 0.82rem;
		color: rgba(100, 116, 139, 0.9);
	}

	.lesson-card h3 {
		margin: 0;
		font-size: 1.05rem;
	}

	.lesson-tagline {
		margin: 0;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.78));
	}

	.lesson-progress {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: auto;
	}

	.progress-track {
		position: relative;
		flex: 1 1 auto;
		height: 0.45rem;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.2);
		overflow: hidden;
	}

	.progress-fill {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: var(--progress, 0%);
		max-width: 100%;
		border-radius: 999px;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(96, 165, 250, 0.75));
	}

	.progress-fill[data-state='completed'] {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.9), rgba(74, 222, 128, 0.8));
	}

	.progress-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: rgba(51, 65, 85, 0.92);
	}

	.progress-label.muted {
		color: rgba(100, 116, 139, 0.9);
	}

	.empty-state {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 1rem 1.2rem;
		border-radius: 1.1rem;
		border: 1px dashed rgba(148, 163, 184, 0.6);
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.72));
	}

	.empty-emoji {
		font-size: 1.6rem;
	}

	.empty-copy h2 {
		margin: 0;
	}

	.empty-copy p {
		margin: 0.15rem 0 0;
	}

	.templates-panel {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.templates-header h2 {
		margin: 0 0 0.25rem;
	}

	.templates-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: clamp(0.9rem, 2vw, 1.3rem);
	}

	.template-card {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 1rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background: color-mix(in srgb, var(--app-content-bg) 92%, transparent);
		text-decoration: none;
		color: inherit;
		box-shadow: 0 18px 50px -44px rgba(15, 23, 42, 0.45);
	}

	.template-visual {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 0.85rem;
		border: 1px solid rgba(148, 163, 184, 0.24);
		overflow: hidden;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--app-content-bg) 82%, transparent);
	}

	.template-poster {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.template-emoji {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		font-size: 1.6rem;
		line-height: 1;
	}

	.template-body h3 {
		margin: 0;
	}

	.template-tagline {
		margin: 0.2rem 0 0;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	.template-action {
		align-self: flex-start;
		margin-top: auto;
		padding: 0.55rem 1rem;
		border-radius: 0.9rem;
		border: none;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(96, 165, 250, 0.78));
		color: #fff;
		font-weight: 700;
		cursor: pointer;
	}

	.template-action:hover {
		filter: brightness(1.03);
	}

	.template-error {
		margin: 0;
		padding: 0.7rem 0.85rem;
		border-radius: 0.85rem;
		border: 1px solid rgba(239, 68, 68, 0.38);
		background: rgba(248, 113, 113, 0.14);
		color: #b91c1c;
	}

	@media (max-width: 720px) {
		.lessons-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.back-button {
			width: 100%;
			justify-content: center;
		}
	}
</style>
