<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import AtomIcon from '@lucide/svelte/icons/atom';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { GIAD_FLOWS, type GiadFlow } from '$lib/spark/giad/flows';

	function flowHref(flow: GiadFlow): string {
		return `/spark/exp/explanations/${encodeURIComponent(flow.id)}`;
	}

	function flowStyle(flow: GiadFlow): string {
		return [
			`--flow-accent:${flow.theme.accent}`,
			`--flow-strong:${flow.theme.accentStrong}`,
			`--flow-soft:${flow.theme.soft}`,
			`--flow-border:${flow.theme.border}`,
			`--flow-text:${flow.theme.text}`
		].join('; ');
	}
</script>

<svelte:head>
	<title>Spark · Diagnosis to repair</title>
</svelte:head>

<section class="giad-index">
	<div class="giad-index__shell">
		<header class="giad-index__header">
			<p class="giad-index__eyebrow">Experiment · Andrew V.</p>
			<h1>Diagnosis-to-repair flows</h1>
			<p>
				Hard-coded GCSE examples where Andrew has a correct start, but needs the missing
				reasoning link made visible before seeing a stronger answer.
			</p>
		</header>

		<div class="giad-index__grid">
			{#each GIAD_FLOWS as flow}
				<a class="flow-card" href={flowHref(flow)} style={flowStyle(flow)}>
					<div class="flow-card__topline">
						<span class="flow-card__icon" aria-hidden="true">
							{#if flow.icon === 'heart'}
								<HeartPulseIcon />
							{:else if flow.icon === 'atom'}
								<AtomIcon />
							{:else if flow.icon === 'zap'}
								<ZapIcon />
							{:else}
								<ActivityIcon />
							{/if}
						</span>
						<span class="flow-card__badge">{flow.subject} · {flow.marks}</span>
					</div>
					<h2>{flow.shortTitle}</h2>
					<p class="flow-card__subtitle">{flow.subtitle}</p>
					<div class="flow-card__question">{flow.question}</div>
					<dl class="flow-card__facts">
						<div>
							<dt>Current</dt>
							<dd>{flow.scoreLabel}</dd>
						</div>
						<div>
							<dt>Gap</dt>
							<dd>{flow.gapLabel}</dd>
						</div>
						<div>
							<dt>Repair</dt>
							<dd>{flow.repairMove}</dd>
						</div>
					</dl>
					<span class="flow-card__action">
						Open flow
						<ArrowRightIcon aria-hidden="true" />
					</span>
				</a>
			{/each}
		</div>
	</div>
</section>

<style>
	.giad-index {
		min-height: calc(100dvh - 5rem);
		padding: clamp(1rem, 3vw, 2rem);
		color: #071747;
	}

	.giad-index__shell {
		width: min(72rem, 100%);
		margin: 0 auto;
	}

	.giad-index__header {
		display: grid;
		gap: 0.65rem;
		max-width: 48rem;
		padding: clamp(1rem, 3vw, 1.75rem) 0;
	}

	.giad-index__eyebrow {
		margin: 0;
		color: #2563eb;
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.giad-index h1 {
		margin: 0;
		font-size: clamp(2.1rem, 6vw, 4.5rem);
		font-weight: 800;
		line-height: 0.98;
		letter-spacing: 0;
	}

	.giad-index__header p:last-child {
		margin: 0;
		color: rgba(7, 23, 71, 0.72);
		font-size: clamp(1rem, 2vw, 1.2rem);
		line-height: 1.55;
	}

	.giad-index__grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		padding: 0.5rem 0 3rem;
	}

	.flow-card {
		display: grid;
		gap: 1rem;
		padding: clamp(1rem, 2.5vw, 1.35rem);
		border: 1px solid color-mix(in srgb, var(--flow-border), #ffffff 12%);
		border-radius: 1rem;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--flow-soft), #ffffff 46%), #ffffff 62%),
			#ffffff;
		box-shadow: 0 24px 65px -46px rgba(15, 23, 42, 0.42);
		color: inherit;
		text-decoration: none;
		transition:
			transform 160ms ease,
			border-color 160ms ease,
			box-shadow 160ms ease;
	}

	.flow-card:hover {
		transform: translateY(-2px);
		border-color: var(--flow-accent);
		box-shadow: 0 30px 75px -44px color-mix(in srgb, var(--flow-accent) 45%, #0f172a);
	}

	.flow-card__topline,
	.flow-card__action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.flow-card__icon {
		display: inline-grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid var(--flow-border);
		border-radius: 0.85rem;
		background: #ffffff;
		color: var(--flow-strong);
	}

	.flow-card__icon :global(svg) {
		width: 1.35rem;
		height: 1.35rem;
	}

	.flow-card__badge {
		min-width: 0;
		padding: 0.38rem 0.65rem;
		border: 1px solid var(--flow-border);
		border-radius: 999px;
		background: color-mix(in srgb, var(--flow-soft), #ffffff 32%);
		color: var(--flow-text);
		font-size: 0.82rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.flow-card h2 {
		margin: 0;
		color: #071747;
		font-size: clamp(1.35rem, 2.5vw, 1.85rem);
		line-height: 1.08;
		letter-spacing: 0;
	}

	.flow-card__subtitle,
	.flow-card__question {
		margin: 0;
		color: rgba(7, 23, 71, 0.72);
		line-height: 1.45;
	}

	.flow-card__question {
		padding: 0.85rem 0.95rem;
		border: 1px solid rgba(37, 99, 235, 0.12);
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.72);
		color: #071747;
		font-weight: 650;
	}

	.flow-card__facts {
		display: grid;
		gap: 0.65rem;
		margin: 0;
	}

	.flow-card__facts div {
		display: grid;
		gap: 0.2rem;
	}

	.flow-card__facts dt {
		color: var(--flow-strong);
		font-size: 0.74rem;
		font-weight: 900;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.flow-card__facts dd {
		margin: 0;
		color: rgba(7, 23, 71, 0.75);
		font-size: 0.92rem;
		line-height: 1.35;
	}

	.flow-card__action {
		justify-content: flex-start;
		color: var(--flow-strong);
		font-weight: 850;
	}

	.flow-card__action :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	:global([data-theme='dark'] .giad-index),
	:global(:root:not([data-theme='light']) .giad-index) {
		color: #eef4ff;
	}

	:global([data-theme='dark'] .giad-index__eyebrow),
	:global(:root:not([data-theme='light']) .giad-index__eyebrow) {
		color: #93c5fd;
	}

	:global([data-theme='dark'] .giad-index__header p:last-child),
	:global(:root:not([data-theme='light']) .giad-index__header p:last-child) {
		color: rgba(226, 232, 240, 0.75);
	}

	:global([data-theme='dark'] .flow-card),
	:global(:root:not([data-theme='light']) .flow-card) {
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--flow-accent) 20%, #111827), #17142a 58%),
			#17142a;
		box-shadow: 0 30px 80px -48px rgba(0, 0, 0, 0.75);
	}

	:global([data-theme='dark'] .flow-card h2),
	:global([data-theme='dark'] .flow-card__question),
	:global(:root:not([data-theme='light']) .flow-card h2),
	:global(:root:not([data-theme='light']) .flow-card__question) {
		color: #f8fbff;
	}

	:global([data-theme='dark'] .flow-card__subtitle),
	:global([data-theme='dark'] .flow-card__facts dd),
	:global(:root:not([data-theme='light']) .flow-card__subtitle),
	:global(:root:not([data-theme='light']) .flow-card__facts dd) {
		color: rgba(226, 232, 240, 0.76);
	}

	:global([data-theme='dark'] .flow-card__question),
	:global([data-theme='dark'] .flow-card__icon),
	:global([data-theme='dark'] .flow-card__badge),
	:global(:root:not([data-theme='light']) .flow-card__question),
	:global(:root:not([data-theme='light']) .flow-card__icon),
	:global(:root:not([data-theme='light']) .flow-card__badge) {
		background: rgba(15, 23, 42, 0.48);
	}

	@media (max-width: 56rem) {
		.giad-index__grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 38rem) {
		.giad-index {
			padding: 0.75rem;
		}

		.giad-index__grid {
			gap: 0.85rem;
			padding-bottom: 1.5rem;
		}

		.flow-card {
			border-radius: 0.85rem;
		}

		.flow-card__topline {
			align-items: flex-start;
		}

		.flow-card__badge {
			white-space: normal;
			text-align: right;
		}
	}
</style>
