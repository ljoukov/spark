<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { GiadFlow, GiadFlowStatus } from '$lib/spark/giad/flows';
	import type { PageData } from './$types';

	type ZoomCard = {
		section: string;
		number: string;
		title: string;
		body: string;
		color: string;
		visual?: string;
		link?: string;
	};

	let { data }: { data: PageData } = $props();
	const flow = $derived(data.flow);
	const closingGapLabel = $derived(flow.gapLabel.replace(/^(Gap|Next step):\s*/i, ''));
	const chainLinkLabels = ['', 'means', 'so', 'therefore'];
	const builderCardColors = ['#2ab87a', '#7c5cbf', '#4a90d9'];
	const chainCardColors = ['#2ab87a', '#3d9bd4', '#7c5cbf', '#f0a830'];
	let activeZoomCard = $state<ZoomCard | null>(null);

	function flowStyle(target: GiadFlow): string {
		return [
			`--flow-accent:${target.theme.accent}`,
			`--flow-strong:${target.theme.accentStrong}`,
			`--flow-soft:${target.theme.soft}`,
			`--flow-border:${target.theme.border}`,
			`--flow-text:${target.theme.text}`
		].join('; ');
	}

	function diagnosisClass(status: GiadFlowStatus): string {
		return `diagnosis-card diagnosis-card--${status}`;
	}

	function diagnosisColor(status: GiadFlowStatus): string {
		return {
			correct: '#189265',
			identified: '#2563eb',
			gap: '#f97316'
		}[status];
	}

	function builderCardColor(index: number): string {
		return builderCardColors[index] ?? flow.theme.accent;
	}

	function chainCardColor(index: number): string {
		return chainCardColors[index] ?? flow.theme.accent;
	}

	function openBuilderZoom(index: number): void {
		const step = flow.builderSteps[index];

		if (step === undefined) {
			return;
		}

		activeZoomCard = {
			section: 'Thinking builder',
			number: `${index + 1}.`,
			title: step.title,
			body: step.answer,
			color: builderCardColor(index),
			visual: step.visual
		};
	}

	function openChainZoom(index: number): void {
		const item = flow.chain[index];

		if (item === undefined) {
			return;
		}

		activeZoomCard = {
			section: 'Cause-and-effect chain',
			number: item.label,
			title: item.title,
			body: item.body,
			color: chainCardColor(index),
			visual: item.visual,
			link: index > 0 ? (chainLinkLabels[index] ?? 'so') : undefined
		};
	}

	function closeZoomCard(): void {
		activeZoomCard = null;
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			closeZoomCard();
		}
	}

	function handleZoomBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			closeZoomCard();
		}
	}
</script>

<svelte:head>
	<title>Spark · {flow.shortTitle}</title>
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<section class="giad-detail" style={flowStyle(flow)}>
	<div class="paper-frame">
		<header class="paper-header">
			<a class="back-link" href="/spark/exp/explanations" aria-label="Back to diagnosis flows">
				<ArrowLeftIcon aria-hidden="true" />
			</a>
			<div class="paper-header__copy">
				<p class="paper-eyebrow">{flow.context}</p>
				<h1>{flow.title}</h1>
				<p>{flow.subtitle}</p>
			</div>
			<div class="paper-total" aria-label={`${flow.subject}, ${flow.marks}`}>
				<span>{flow.subject}</span>
				<strong>{flow.marks}</strong>
			</div>
		</header>

		<div class="paper-body">
			<section class="worksheet-section question-section" aria-labelledby="question-title">
				<div class="section-tag" aria-hidden="true">Q</div>
				<div class="section-main">
					<div class="section-heading">
						<p>Question</p>
						<span>{flow.marks}</span>
					</div>
					<h2 id="question-title">{flow.question}</h2>
				</div>
			</section>

			<section class="worksheet-section draft-section" aria-labelledby="draft-title">
				<div class="section-tag section-tag--soft" aria-hidden="true">
					<PencilIcon />
				</div>
				<div class="section-main">
					<div class="section-heading">
						<p id="draft-title">{flow.draftLabel}</p>
					</div>
					<div class="answer-lines answer-lines--draft">
						{#each flow.draft as line}
							<p>{line}</p>
						{/each}
					</div>
				</div>
			</section>

			<div class="diagnosis-grid" aria-label="Diagnosis timeline">
				{#each flow.diagnosis as item, index}
					<article class={diagnosisClass(item.status)} style={`--diagnosis-color:${diagnosisColor(item.status)}`}>
						<div class="diagnosis-card__icon" aria-hidden="true">
							{#if item.status === 'gap'}
								<TriangleAlertIcon />
							{:else}
								<CircleCheckIcon />
							{/if}
						</div>
						<h2>{item.title}</h2>
					</article>
					{#if index < flow.diagnosis.length - 1}
						<span
							class="diagnosis-connector"
							style={`--diagnosis-color:${diagnosisColor(item.status)}`}
							aria-hidden="true"
						></span>
					{/if}
				{/each}
			</div>

			<section class="split-section" aria-label="Repair plan">
				<div class="flow-builder">
					<div class="paper-section-header">
						<h2>Thinking builder</h2>
					</div>

					<div class="builder-steps">
						{#each flow.builderSteps as step, index}
							<button
								type="button"
								class="builder-step zoom-card-trigger"
								style={`--step-color:${builderCardColor(index)}`}
								aria-label={`Open larger view for ${step.title}`}
								onclick={() => openBuilderZoom(index)}
							>
								<span class="builder-step__title">{index + 1}. {step.title}</span>
								<span class="visual-answer">
									{#if step.visual}
										<span class="concept-visual" aria-hidden="true">{step.visual}</span>
									{/if}
									<span class="builder-step__answer">{step.answer}</span>
								</span>
								{#if step.cues.length > 0}
									<span class="builder-cues">
										{#each step.cues as cue}
											<span>{cue}</span>
										{/each}
									</span>
								{/if}
							</button>
							{#if index < flow.builderSteps.length - 1}
								<span class="flow-arrow" aria-hidden="true">→</span>
							{/if}
						{/each}
					</div>
				</div>

				<div class="chain-panel">
					<div class="paper-section-header">
						<h2>Cause-and-effect chain</h2>
					</div>

					<div class="chain-list">
						{#each flow.chain as item, index}
							<button
								type="button"
								class="chain-card zoom-card-trigger"
								style={`--step-color:${chainCardColor(index)}`}
								aria-label={`Open larger view for ${item.title}`}
								onclick={() => openChainZoom(index)}
							>
								<span class="chain-card__title">
									<span class="chain-card__number">{item.label}</span>
									<span>{item.title}</span>
								</span>
								{#if item.visual}
									<span class="concept-visual concept-visual--chain" aria-hidden="true">
										{item.visual}
									</span>
								{/if}
								<span class="chain-card__body-text">{item.body}</span>
							</button>
							{#if index < flow.chain.length - 1}
								<span class="flow-arrow flow-arrow--chain" aria-hidden="true">→</span>
							{/if}
						{/each}
					</div>
				</div>
			</section>

			<section class="answer-card" aria-labelledby="answer-title">
				<div class="answer-card__heading">
					<div>
						<CircleCheckIcon aria-hidden="true" />
						<h2 id="answer-title">Improved explanation</h2>
					</div>
					<span>Fuller answer</span>
				</div>
				<div class="answer-lines answer-lines--final">
					{#each flow.improvedAnswer as paragraph}
						<p>
							{#each paragraph as segment}
								{#if segment.highlight}
									<mark>{segment.text}</mark>
								{:else}
									{segment.text}
								{/if}
							{/each}
						</p>
					{/each}
				</div>
				<div class="answer-card__confirmation">
					<CircleCheckIcon aria-hidden="true" />
					<span>Now the answer closes the gap: {closingGapLabel.toLowerCase()}.</span>
				</div>
			</section>

			<footer class="paper-footer">
				<div class="note-panel note-panel--tip">
					<LightbulbIcon aria-hidden="true" />
					<p><strong>Tip:</strong> {flow.tip}</p>
				</div>
				<a class="paper-action" href="/spark/exp/explanations">
					All flows
					<ArrowRightIcon aria-hidden="true" />
				</a>
			</footer>

			<p class="source-note">
				<CircleAlertIcon aria-hidden="true" />
				{flow.sourceNote}
			</p>
		</div>
	</div>

	{#if activeZoomCard}
		<div class="zoom-card-backdrop" role="presentation" onclick={handleZoomBackdropClick}>
			<div
				class="zoom-card"
				style={`--step-color:${activeZoomCard.color}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="zoom-card-title"
			>
				<button
					class="zoom-card__close"
					type="button"
					aria-label="Close larger view"
					onclick={closeZoomCard}
				>
					Close
				</button>
				<p class="zoom-card__section">{activeZoomCard.section}</p>
				<div class="zoom-card__meta">
					<span class="quiet-step-number">{activeZoomCard.number}</span>
					{#if activeZoomCard.link}
						<span class="chain-card__link">{activeZoomCard.link}</span>
					{/if}
				</div>
				<div class="zoom-card__body">
					{#if activeZoomCard.visual}
						<span class="concept-visual concept-visual--zoom" aria-hidden="true">
							{activeZoomCard.visual}
						</span>
					{/if}
					<h2 id="zoom-card-title">{activeZoomCard.title}</h2>
					<p>{activeZoomCard.body}</p>
				</div>
			</div>
		</div>
	{/if}
</section>

<style>
	:global(.app-shell:has(.giad-detail) .sheet-close-button) {
		display: none;
	}

	.giad-detail {
		min-height: 100dvh;
		background:
			linear-gradient(90deg, rgba(22, 42, 61, 0.04) 0 1px, transparent 1px 100%),
			linear-gradient(180deg, rgba(22, 42, 61, 0.04) 0 1px, transparent 1px 100%),
			#eef1f3;
		background-size:
			32px 32px,
			32px 32px,
			100% 100%;
		padding: calc(env(safe-area-inset-top, 0px) + clamp(0.65rem, 2vw, 1.25rem))
			clamp(0.65rem, 2.5vw, 2rem)
			calc(env(safe-area-inset-bottom, 0px) + clamp(1rem, 3vw, 2.5rem));
		color: var(--paper-text);
		--sheet-color: var(--flow-accent);
		--sheet-accent: var(--flow-strong);
		--sheet-light: var(--flow-soft);
		--sheet-border: var(--flow-border);
		--paper-accent-text: var(--sheet-color);
		--paper-surface: #ffffff;
		--paper-surface-elevated: #ffffff;
		--paper-surface-soft: #fafafa;
		--paper-surface-subtle: #f9f9f9;
		--paper-surface-lined: #fdfdfd;
		--paper-border: color-mix(in srgb, var(--sheet-color) 30%, transparent);
		--paper-border-soft: color-mix(in srgb, var(--sheet-color) 24%, #d0d0d0);
		--paper-divider: #e0e0e0;
		--paper-text: #1a1a1a;
		--paper-text-strong: #111111;
		--paper-text-soft: #555555;
		--paper-text-muted: #666666;
		--paper-text-subtle: #888888;
		--paper-text-faint: #bbbbbb;
		--paper-reading-size: 16px;
		--paper-reading-line-height: 1.72;
		--paper-answer-line-height: 2.25;
		--paper-answer-row-height: calc(var(--paper-answer-line-height) * 1em);
		--paper-section-header-bg: color-mix(in srgb, var(--sheet-color) 14%, #ffffff);
		--paper-theory-bg: color-mix(in srgb, var(--sheet-color) 8%, #ffffff);
		--paper-info-bg: color-mix(in srgb, var(--sheet-color) 10%, #ffffff);
		--paper-choice-surface: #fafafa;
		--paper-choice-border: #d0d0d0;
		--paper-input-border: color-mix(in srgb, var(--sheet-color) 60%, #ffffff);
		--paper-lines-bg: #ffffff;
		--paper-lines-rule: #e8e8e8;
		--paper-lines-rule-alt: #ececec;
		--paper-frame-shadow: 0 4px 30px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.1);
		--paper-card-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
		--paper-review-correct-bg: #edfdf6;
		--paper-review-correct-border: #22a66e;
		--paper-review-correct-text: #1a8c5b;
		--paper-review-incorrect-bg: #fbefe3;
		--paper-review-incorrect-border: #c66317;
		--paper-review-incorrect-text: #c66317;
		--paper-review-teacher-bg: #fff6d8;
		--paper-review-teacher-border: #d6a11e;
		--paper-review-teacher-text: #b07a00;
	}

	.paper-frame {
		width: min(100%, 1024px);
		margin: 0 auto;
		overflow: hidden;
		border-radius: 4px;
		background: var(--paper-surface);
		box-shadow: var(--paper-frame-shadow);
		font-family: Georgia, 'Times New Roman', serif;
	}

	.paper-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
		padding: clamp(0.95rem, 2.4vw, 1.35rem) clamp(1rem, 3vw, 1.65rem);
		background: var(--sheet-color);
		color: #ffffff;
	}

	.back-link {
		display: inline-grid;
		width: 2.35rem;
		height: 2.35rem;
		place-items: center;
		border: 2px solid rgba(255, 255, 255, 0.72);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		color: #ffffff;
		text-decoration: none;
	}

	.back-link :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.paper-header__copy {
		min-width: 0;
	}

	.paper-eyebrow,
	.paper-header__copy p,
	.section-heading p,
	.section-heading span,
	.paper-total span,
	.builder-step__answer,
	.chain-card__body-text,
	.note-panel p,
	.source-note {
		margin: 0;
	}

	.paper-eyebrow {
		margin-bottom: 0.35rem;
		color: rgba(255, 255, 255, 0.76);
		font-size: var(--paper-reading-size);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.paper-header h1 {
		margin: 0;
		color: #ffffff;
		font-size: clamp(1.55rem, 3.6vw, 2.1rem);
		font-weight: 900;
		letter-spacing: 0;
		line-height: 1.08;
	}

	.paper-header__copy p:not(.paper-eyebrow) {
		margin-top: 0.45rem;
		color: rgba(255, 255, 255, 0.8);
		font-size: var(--paper-reading-size);
		line-height: 1.45;
	}

	.paper-total {
		min-width: 5.5rem;
		text-align: right;
	}

	.paper-total span {
		display: block;
		color: rgba(255, 255, 255, 0.76);
		font-size: var(--paper-reading-size);
	}

	.paper-total strong {
		display: block;
		margin-top: 0.2rem;
		color: #ffffff;
		font-size: clamp(1.15rem, 2.4vw, 1.55rem);
		font-weight: 760;
		line-height: 1;
	}

	.paper-body {
		padding: clamp(1rem, 2.8vw, 2rem);
	}

	.worksheet-section {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.95rem 0;
		border-bottom: 1px dashed var(--paper-divider);
	}

	.worksheet-section:first-child {
		padding-top: 0;
	}

	.section-tag {
		display: inline-flex;
		width: 1.75rem;
		min-width: 1.75rem;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 0.92rem;
		font-weight: 900;
		line-height: 1;
	}

	.section-tag {
		width: 2rem;
		min-width: 2rem;
		height: 2rem;
		margin-top: 0.1rem;
	}

	.section-tag--soft {
		background: var(--paper-section-header-bg);
		color: var(--paper-accent-text);
	}

	.section-tag--soft :global(svg) {
		width: 1.05rem;
		height: 1.05rem;
	}

	.section-main {
		min-width: 0;
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.4rem;
	}

	.section-heading p {
		color: var(--paper-accent-text);
		font-size: var(--paper-reading-size);
		font-weight: 800;
	}

	.section-heading span {
		flex: 0 0 auto;
		color: var(--paper-text-muted);
		font-size: 0.88rem;
		font-weight: 560;
	}

	.question-section h2 {
		margin: 0;
		color: var(--paper-text-strong);
		font-size: clamp(1.05rem, 2.1vw, 1.22rem);
		font-weight: 700;
		letter-spacing: 0;
		line-height: 1.55;
	}

	.answer-lines {
		min-width: 0;
		border: 1.5px solid var(--paper-border);
		border-radius: 6px;
		background:
			repeating-linear-gradient(
				transparent,
				transparent calc(var(--paper-answer-row-height) - 1px),
				var(--paper-lines-rule-alt) calc(var(--paper-answer-row-height) - 1px),
				var(--paper-lines-rule-alt) var(--paper-answer-row-height)
			),
			var(--paper-surface-lined);
		padding: 0.55rem 0.75rem;
	}

	.answer-lines p {
		min-height: var(--paper-answer-row-height);
		margin: 0;
		color: var(--paper-text);
		font-size: var(--paper-reading-size);
		line-height: var(--paper-answer-line-height);
	}

	.diagnosis-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(1.6rem, 0.55fr) minmax(0, 1fr) minmax(
				1.6rem,
				0.55fr
			) minmax(0, 1fr);
		gap: 0.15rem;
		align-items: start;
		padding: 1.35rem 0 1.45rem;
		border-bottom: 1px dashed var(--paper-divider);
	}

	.diagnosis-card {
		--diagnosis-color: var(--paper-accent-text);
		display: grid;
		gap: 0.38rem;
		justify-items: center;
		min-width: 0;
		font-family: Georgia, 'Times New Roman', serif;
		padding: 0;
		text-align: center;
	}

	.diagnosis-card__icon {
		display: inline-grid;
		width: 2.8rem;
		height: 2.8rem;
		place-items: center;
		border: 1.5px solid color-mix(in srgb, var(--diagnosis-color) 48%, var(--paper-border));
		border-radius: 999px;
		background: color-mix(in srgb, var(--diagnosis-color) 12%, var(--paper-surface-elevated));
		color: var(--diagnosis-color);
	}

	.diagnosis-card__icon :global(svg) {
		width: 1.6rem;
		height: 1.6rem;
	}

	.diagnosis-connector {
		position: relative;
		display: block;
		min-width: 0;
		height: 0.16rem;
		margin-top: 1.32rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--diagnosis-color) 76%, var(--paper-divider));
	}

	.diagnosis-connector::after {
		content: '';
		position: absolute;
		top: 50%;
		right: -0.08rem;
		width: 0;
		height: 0;
		border-top: 0.34rem solid transparent;
		border-bottom: 0.34rem solid transparent;
		border-left: 0.5rem solid
			color-mix(in srgb, var(--diagnosis-color) 76%, var(--paper-divider));
		transform: translateY(-50%);
	}

	.diagnosis-card h2,
	.paper-section-header h2,
	.answer-card h2 {
		margin: 0;
		color: var(--paper-text-strong);
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: 0;
		line-height: 1.2;
	}

	.diagnosis-card h2 {
		color: var(--diagnosis-color);
		font-size: 16px;
		font-weight: 700;
		line-height: 1.18;
	}

	.chain-card__body-text,
	.note-panel p,
	.source-note {
		color: var(--paper-text-soft);
		font-size: var(--paper-reading-size);
		line-height: 1.45;
	}

	.note-panel {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.8rem;
		align-items: start;
		border: 1.5px solid var(--paper-review-teacher-border);
		border-radius: 8px;
		background: var(--paper-review-teacher-bg);
		padding: 0.9rem 1rem;
	}

	.note-panel > :global(svg) {
		align-self: center;
		width: 1.55rem;
		height: 1.55rem;
		color: var(--paper-review-teacher-text);
	}

	.note-panel strong {
		color: var(--paper-review-incorrect-text);
		font-weight: 720;
	}

	.split-section {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.9rem;
		padding: 1rem 0;
		border-bottom: 1px dashed var(--paper-divider);
	}

	.flow-builder,
	.chain-panel {
		min-width: 0;
	}

	.flow-builder,
	.chain-panel {
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.answer-card {
		min-width: 0;
		border: 1.5px solid var(--paper-border);
		border-radius: 10px;
		background: var(--paper-surface-elevated);
		box-shadow: var(--paper-card-shadow);
	}

	.paper-section-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.45rem;
	}

	.paper-section-header h2 {
		margin: 0;
		color: var(--paper-accent-text);
		font-size: 1.05rem;
		font-weight: 820;
		letter-spacing: 0;
		line-height: 1.18;
	}

	.builder-steps {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 0;
		align-items: stretch;
	}

	.builder-step {
		--step-color: var(--paper-accent-text);
		appearance: none;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 0.75rem;
		min-width: 0;
		align-content: stretch;
		border: 1.5px solid var(--step-color);
		border-radius: 12px;
		background: color-mix(in srgb, var(--step-color) 7%, var(--paper-surface-elevated));
		color: inherit;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 16px;
		padding: 0.85rem;
		text-align: left;
	}

	.builder-step__title {
		display: block;
		margin: 0;
		color: var(--step-color, var(--paper-text-strong));
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0;
		line-height: 1.25;
	}

	.quiet-step-number {
		display: inline-flex;
		flex: 0 0 auto;
		min-width: 0.8rem;
		align-items: center;
		justify-content: center;
		color: color-mix(in srgb, var(--step-color, var(--paper-accent-text)) 78%, var(--paper-text-muted));
		font-size: 16px;
		font-weight: 680;
		line-height: 1;
	}

	.visual-answer {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		align-self: stretch;
		min-height: 3.3rem;
	}

	.concept-visual {
		display: inline-grid;
		width: auto;
		height: auto;
		place-items: center;
		color: color-mix(in srgb, var(--step-color, var(--paper-accent-text)) 72%, var(--paper-text-strong));
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Emoji',
			'Apple Color Emoji', sans-serif;
		font-size: 3rem;
		font-weight: 650;
		line-height: 1;
		opacity: 0.95;
	}

	.builder-step__answer {
		color: var(--paper-text);
		font-size: 16px;
		font-weight: 430;
		line-height: 1.45;
	}

	.builder-cues {
		display: grid;
		gap: 0.22rem;
		margin: 0;
		color: color-mix(in srgb, var(--step-color) 72%, var(--paper-text-soft));
		font-size: 16px;
		font-weight: 450;
		line-height: 1.45;
	}

	.builder-cues span {
		display: block;
	}

	.flow-arrow {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: center;
		padding: 0 0.25rem;
		color: var(--paper-text-subtle);
		font-size: 1.25rem;
		font-weight: 500;
		line-height: 1;
	}

	.chain-list {
		display: grid;
		grid-template-columns:
			minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 0;
		align-items: stretch;
	}

	.chain-card {
		--step-color: var(--paper-accent-text);
		appearance: none;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 0.75rem;
		justify-items: center;
		align-content: stretch;
		min-width: 0;
		padding: 0.85rem;
		border: 1.5px solid var(--step-color);
		border-radius: 12px;
		background: color-mix(in srgb, var(--step-color) 7%, var(--paper-surface-elevated));
		color: inherit;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 16px;
		text-align: center;
	}

	.chain-card__title {
		display: flex;
		align-items: flex-start;
		justify-content: flex-start;
		gap: 0.42rem;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		color: var(--step-color);
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0;
		line-height: 1.2;
		text-align: left;
	}

	.chain-card__title > span:not(.chain-card__number) {
		min-width: 0;
		flex: 1 1 auto;
	}

	.chain-card__number {
		display: inline-flex;
		width: 1.35rem;
		height: 1.35rem;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--step-color) 36%, var(--paper-border));
		border-radius: 999px;
		background: #ffffff;
		color: var(--step-color);
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		font-size: 0.76rem;
		font-weight: 760;
		line-height: 1;
	}

	.concept-visual--chain {
		width: auto;
		height: auto;
		align-self: center;
		margin: 0.05rem 0;
		font-size: 2.75rem;
	}

	.chain-card__body-text {
		color: var(--paper-text-soft);
		font-size: 16px;
		font-weight: 430;
		line-height: 1.36;
	}

	.zoom-card-trigger {
		cursor: pointer;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}

	.zoom-card-trigger:hover {
		border-color: color-mix(in srgb, var(--step-color) 38%, var(--paper-border));
	}

	.zoom-card-trigger:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--step-color) 62%, transparent);
		outline-offset: 3px;
	}

	.zoom-card-backdrop {
		position: fixed;
		z-index: 80;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(17, 24, 39, 0.28);
		backdrop-filter: blur(4px);
		padding: calc(env(safe-area-inset-top, 0px) + 1rem) 1rem
			calc(env(safe-area-inset-bottom, 0px) + 1rem);
	}

	.zoom-card {
		position: relative;
		display: grid;
		gap: 0.72rem;
		width: min(100%, 28rem);
		border: 1px solid color-mix(in srgb, var(--step-color) 32%, var(--paper-border));
		border-top: 3px solid color-mix(in srgb, var(--step-color) 54%, var(--paper-border));
		border-radius: 12px;
		background: color-mix(in srgb, var(--step-color) 3%, var(--paper-surface-elevated));
		box-shadow: 0 24px 60px -28px rgba(15, 23, 42, 0.5);
		padding: 1rem;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.zoom-card__close {
		position: absolute;
		top: 0.7rem;
		right: 0.7rem;
		border: 1px solid color-mix(in srgb, var(--step-color) 20%, var(--paper-border));
		border-radius: 999px;
		background: color-mix(in srgb, var(--paper-surface-elevated) 88%, transparent);
		color: var(--paper-text-soft);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 650;
		line-height: 1;
		padding: 0.34rem 0.55rem;
	}

	.zoom-card__section,
	.zoom-card__body p {
		margin: 0;
	}

	.zoom-card__section {
		padding-right: 4rem;
		color: color-mix(in srgb, var(--step-color) 70%, var(--paper-text-soft));
		font-size: 0.78rem;
		font-weight: 720;
		line-height: 1.2;
	}

	.zoom-card__meta {
		display: flex;
		gap: 0.38rem;
		align-items: center;
	}

	.zoom-card__meta .quiet-step-number {
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--step-color) 8%, var(--paper-surface-soft));
		color: color-mix(in srgb, var(--step-color) 76%, var(--paper-text-soft));
		font-size: 0.78rem;
	}

	.zoom-card__body {
		display: grid;
		gap: 0.42rem;
	}

	.zoom-card__body h2 {
		margin: 0;
		color: color-mix(in srgb, var(--step-color) 82%, var(--paper-text-strong));
		font-size: 1.18rem;
		font-weight: 760;
		letter-spacing: 0;
		line-height: 1.18;
	}

	.zoom-card__body p {
		color: var(--paper-text);
		font-size: 1rem;
		font-weight: 450;
		line-height: 1.45;
	}

	.concept-visual--zoom {
		width: 2.2rem;
		height: 2.2rem;
		font-size: 1.32rem;
		opacity: 0.9;
	}

	.answer-card {
		margin-top: 0.85rem;
		border-color: var(--paper-review-correct-border);
		background: var(--paper-review-correct-bg);
		padding: 0.9rem;
	}

	.answer-card__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.8rem;
	}

	.answer-card__heading div {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}

	.answer-card__heading :global(svg) {
		width: 1.35rem;
		height: 1.35rem;
		color: var(--paper-review-correct-text);
	}

	.answer-card__heading h2 {
		color: var(--paper-review-correct-text);
	}

	.answer-card__heading span {
		flex: 0 0 auto;
		border-radius: 999px;
		background: color-mix(in srgb, var(--paper-review-correct-border) 16%, #ffffff);
		padding: 0.25rem 0.6rem;
		color: var(--paper-review-correct-text);
		font-size: 0.82rem;
		font-weight: 800;
	}

	.answer-lines--final {
		border-color: color-mix(in srgb, var(--paper-review-correct-border) 48%, var(--paper-border));
	}

	.answer-lines mark {
		padding: 0 0.05rem 0.08rem;
		background: transparent;
		color: inherit;
		border-bottom: 0.12rem solid color-mix(in srgb, var(--paper-accent-text) 55%, #ffffff);
	}

	.answer-card__confirmation {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.85rem;
		border: 1px solid color-mix(in srgb, var(--paper-review-correct-border) 42%, #ffffff);
		border-radius: 6px;
		background: color-mix(in srgb, var(--paper-review-correct-bg) 64%, #ffffff);
		padding: 0.65rem 0.75rem;
		color: var(--paper-review-correct-text);
		font-size: var(--paper-reading-size);
		font-weight: 700;
	}

	.answer-card__confirmation :global(svg) {
		width: 1.1rem;
		height: 1.1rem;
		flex: 0 0 auto;
	}

	.paper-footer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: center;
		margin-top: 1rem;
	}

	.note-panel--tip {
		border-color: var(--paper-border);
		background: var(--paper-info-bg);
	}

	.note-panel--tip > :global(svg),
	.note-panel--tip strong {
		color: var(--paper-accent-text);
	}

	.paper-action {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		border-radius: 8px;
		background: var(--sheet-color);
		box-shadow: 0 3px 12px color-mix(in srgb, var(--sheet-color) 40%, transparent);
		color: #ffffff;
		font-size: var(--paper-reading-size);
		font-weight: 800;
		padding: 0.65rem 1.15rem;
		text-decoration: none;
	}

	.paper-action :global(svg) {
		width: 1.05rem;
		height: 1.05rem;
	}

	.source-note {
		display: flex;
		gap: 0.45rem;
		align-items: flex-start;
		margin-top: 1rem;
		color: var(--paper-text-faint);
		font-size: 0.86rem;
	}

	.source-note :global(svg) {
		width: 1rem;
		height: 1rem;
		flex: 0 0 auto;
		margin-top: 0.1rem;
		color: var(--paper-text-subtle);
	}

	:global([data-theme='dark'] .giad-detail),
	:global(:root:not([data-theme='light']) .giad-detail) {
		background:
			linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 100%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 100%),
			#100d1f;
		--paper-accent-text: color-mix(in srgb, var(--sheet-color) 70%, #f8fafc);
		--paper-surface: #17142a;
		--paper-surface-elevated: #201c39;
		--paper-surface-soft: #1d1934;
		--paper-surface-subtle: #18152c;
		--paper-surface-lined: #1b1732;
		--paper-border: color-mix(in srgb, var(--sheet-color) 34%, #302850);
		--paper-border-soft: color-mix(in srgb, var(--sheet-color) 22%, #302850);
		--paper-divider: #3a3258;
		--paper-text: #e4dff5;
		--paper-text-strong: #f0eef8;
		--paper-text-soft: #a89ec4;
		--paper-text-muted: #9489b4;
		--paper-text-subtle: #7f739d;
		--paper-text-faint: #6b5f8a;
		--paper-section-header-bg: color-mix(in srgb, var(--sheet-color) 18%, #1f1a37);
		--paper-theory-bg: color-mix(in srgb, var(--sheet-color) 14%, #17142a);
		--paper-info-bg: color-mix(in srgb, var(--sheet-color) 18%, #201c39);
		--paper-lines-rule: #3a3258;
		--paper-lines-rule-alt: #41385e;
		--paper-frame-shadow:
			0 30px 80px -48px rgba(2, 6, 23, 0.9), 0 18px 42px -32px rgba(2, 6, 23, 0.75);
		--paper-card-shadow: 0 18px 36px -28px rgba(2, 6, 23, 0.65);
		--paper-review-correct-bg: color-mix(in srgb, #22a66e 22%, #1d1934);
		--paper-review-correct-border: #4ade80;
		--paper-review-correct-text: #86efac;
		--paper-review-incorrect-bg: color-mix(in srgb, #c66317 24%, #1d1934);
		--paper-review-incorrect-border: #f59e0b;
		--paper-review-incorrect-text: #fdba74;
		--paper-review-teacher-bg: color-mix(in srgb, #d6a11e 24%, #1d1934);
		--paper-review-teacher-border: #fbbf24;
		--paper-review-teacher-text: #fde68a;
	}

	@media (max-width: 860px) {
		.paper-header {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.paper-total {
			grid-column: 2;
			text-align: left;
		}
	}

	@media (max-width: 720px) {
		.giad-detail {
			padding-inline: 0;
			padding-top: 0;
			--paper-reading-line-height: 1.55;
			--paper-answer-line-height: 2.05;
		}

		.paper-frame {
			min-height: 100dvh;
			border-radius: 0;
		}

		.paper-header {
			gap: 0.55rem 0.75rem;
			padding-top: calc(env(safe-area-inset-top, 0px) + 0.68rem);
			padding-bottom: 0.7rem;
			padding-right: calc(env(safe-area-inset-right, 0px) + 1rem);
			padding-left: calc(env(safe-area-inset-left, 0px) + 1rem);
		}

		.back-link {
			width: 2.1rem;
			height: 2.1rem;
			border-width: 1.5px;
		}

		.paper-header__copy p:not(.paper-eyebrow) {
			display: none;
		}

		.paper-total strong {
			font-size: 1.02rem;
		}

		.paper-body {
			padding-top: 0.85rem;
			padding-right: calc(env(safe-area-inset-right, 0px) + 0.75rem);
			padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.85rem);
			padding-left: calc(env(safe-area-inset-left, 0px) + 0.75rem);
		}

		.worksheet-section {
			grid-template-columns: 2.25rem minmax(0, 1fr);
			gap: 0.55rem;
			padding-block: 0.75rem;
		}

		.question-section h2 {
			font-size: 1.05rem;
			line-height: 1.48;
		}

		.answer-lines {
			padding-top: 0.42rem;
			padding-bottom: 0.48rem;
		}

		.diagnosis-grid {
			grid-template-columns:
				minmax(0, 1fr) minmax(0.75rem, 0.45fr) minmax(0, 1fr) minmax(0.75rem, 0.45fr)
				minmax(0, 1fr);
			padding-block: 0.56rem 0.72rem;
			gap: 0.08rem;
		}

		.diagnosis-card {
			gap: 0.28rem;
			min-height: 0;
			text-align: center;
		}

		.diagnosis-card__icon {
			width: 1.65rem;
			height: 1.65rem;
		}

		.diagnosis-card__icon :global(svg) {
			width: 1rem;
			height: 1rem;
		}

		.diagnosis-card h2 {
			font-size: 12px;
			line-height: 1.14;
		}

		.diagnosis-connector {
			height: 0.12rem;
			margin-top: 0.77rem;
		}

		.diagnosis-connector::after {
			border-top-width: 0.24rem;
			border-bottom-width: 0.24rem;
			border-left-width: 0.36rem;
		}

		.note-panel {
			padding: 0.68rem 0.75rem;
		}

		.split-section {
			gap: 0.78rem;
			padding-block: 0.75rem;
		}

		.paper-section-header {
			padding: 0;
			margin-bottom: 0.38rem;
		}

		.paper-section-header h2 {
			font-size: 0.98rem;
		}

		.builder-steps {
			grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
		}

		.chain-list {
			grid-template-columns:
				minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
		}

		.builder-step {
			display: grid;
			grid-template-columns: 1fr;
			gap: 0.36rem;
			align-items: start;
			min-width: 0;
			padding: 0.5rem;
		}

		.chain-card {
			gap: 0.36rem;
			min-width: 0;
			padding: 0.5rem 0.36rem;
		}

		.builder-step__title,
		.chain-card__title {
			font-size: 13px;
			font-weight: 560;
			line-height: 1.14;
		}

		.chain-card__body-text {
			font-size: 12px;
			line-height: 1.24;
		}

		.builder-cues {
			font-size: 12px;
			line-height: 1.32;
		}

		.quiet-step-number {
			font-size: 0.58rem;
		}

		.visual-answer {
			display: grid;
			place-items: center;
			min-height: 2.65rem;
			gap: 0.28rem;
		}

		.builder-step__answer {
			display: none;
		}

		.concept-visual {
			font-size: 2.3rem;
		}

		.concept-visual--chain {
			font-size: 2.1rem;
		}

		.flow-arrow {
			padding-inline: 0.16rem;
			font-size: 1rem;
		}

		.flow-arrow--chain {
			width: 0.85rem;
			padding-inline: 0;
			font-size: 0.92rem;
		}

		.chain-card__title {
			gap: 0.24rem;
			font-size: 12px;
			font-weight: 560;
			hyphens: auto;
			overflow-wrap: anywhere;
		}

		.chain-card__number {
			width: 1rem;
			height: 1rem;
			font-size: 0.56rem;
		}

		.answer-card {
			padding: 0.75rem;
		}

		.answer-card__heading {
			margin-bottom: 0.52rem;
		}

		.answer-card .answer-lines {
			--paper-answer-line-height: 1.82;
			padding: 0.38rem 0.6rem 0.42rem;
		}

		.answer-card .answer-lines p {
			font-size: 0.92rem;
		}

		.answer-card__confirmation {
			margin-top: 0.6rem;
			padding: 0.52rem 0.6rem;
			font-size: 0.85rem;
			line-height: 1.3;
		}

		.chain-card__link {
			font-size: 0.6rem;
			padding-inline: 0.22rem;
		}

		.paper-footer {
			grid-template-columns: 1fr;
		}

		.paper-action {
			width: 100%;
		}
	}

	@media (max-width: 460px) {
		.paper-header {
			grid-template-columns: 1fr auto;
			align-items: start;
		}

		.back-link {
			grid-column: 1;
			grid-row: 1;
		}

		.paper-header__copy {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.paper-total {
			grid-column: 2;
			grid-row: 1;
		}

		.paper-eyebrow {
			font-size: 0.78rem;
			line-height: 1.35;
		}

		.paper-header h1 {
			font-size: clamp(1.55rem, 8vw, 2rem);
		}

		.section-heading,
		.answer-card__heading {
			align-items: flex-start;
		}

		.answer-card__heading {
			flex-direction: column;
		}

	}
</style>
