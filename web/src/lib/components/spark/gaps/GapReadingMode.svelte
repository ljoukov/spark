<script lang="ts">
	import type { SparkLearningGapReadingPresentation } from '@spark/schemas';

	type Props = {
		subjectLabel: string;
		presentation: SparkLearningGapReadingPresentation;
	};

	let { subjectLabel, presentation }: Props = $props();
</script>

<section class="gap-reading-stage">
	<article class="gap-reading-spine">
		<header class="gap-reading-header">
			<p>{subjectLabel}</p>
			<h1>{presentation.question}</h1>
		</header>

		<div class="gap-reading-chain" aria-label="Answer chain">
			{#each presentation.ideaChain as idea, index}
				<div class="gap-reading-chain-cell">
					{#if index > 0}
						<b aria-hidden="true">→</b>
					{/if}
					<span>{idea}</span>
				</div>
			{/each}
		</div>

		<div class="gap-reading-track">
			{#each presentation.outline as point, index}
				<section class="gap-reading-node">
					<span>{String.fromCharCode(97 + index)}.</span>
					<p>{point}</p>
				</section>
			{/each}
		</div>

		<div class="gap-reading-support">
			<section>
				<h2>Key sentences</h2>
				{#each presentation.keySentences as sentence}
					<p>{sentence}</p>
				{/each}
			</section>
			<section class="gap-reading-final">
				<h2>Model answer</h2>
				<p>{presentation.finalAnswer}</p>
			</section>
		</div>
	</article>
</section>

<style>
	.gap-reading-stage {
		width: min(1080px, calc(100% - 56px));
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top, 0px) + 5rem) 0 2.5rem;
		color: #17211b;
	}

	.gap-reading-spine {
		overflow: hidden;
		border: 1px solid rgba(23, 33, 27, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.94);
		box-shadow: 0 22px 70px -48px rgba(15, 23, 42, 0.45);
	}

	.gap-reading-header {
		padding: 1.7rem 1.7rem 0.95rem;
		background: #f4fbf6;
	}

	.gap-reading-header p {
		margin: 0 0 0.75rem;
		color: #27745d;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.gap-reading-header h1 {
		margin: 0;
		color: #17211b;
		font-size: clamp(1.25rem, 1.8vw, 1.55rem);
		font-weight: 750;
		line-height: 1.32;
		overflow-wrap: anywhere;
	}

	.gap-reading-chain {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0;
		overflow: visible;
		border-top: 1px solid rgba(39, 116, 93, 0.08);
		background: #f4fbf6;
		font-size: clamp(0.88rem, 1.05vw, 1rem);
		font-weight: 740;
		line-height: 1.3;
	}

	.gap-reading-chain-cell {
		position: relative;
		min-width: 0;
		overflow: visible;
		padding: 0.75rem 1.2rem 1rem;
	}

	.gap-reading-chain span {
		display: inline-block;
		max-width: 100%;
		border: 1px solid rgba(39, 116, 93, 0.2);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.72);
		padding: 0.42rem 0.55rem;
		color: #17211b;
		overflow-wrap: anywhere;
	}

	.gap-reading-chain b {
		position: absolute;
		top: 50%;
		left: 0;
		transform: translate(-50%, -50%);
		color: #52705f;
		font-size: 1.15rem;
		font-weight: 760;
		line-height: 1;
		z-index: 2;
	}

	.gap-reading-track {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0;
		border-top: 1px solid rgba(23, 33, 27, 0.12);
		border-bottom: 1px solid rgba(23, 33, 27, 0.12);
		background: transparent;
	}

	.gap-reading-node {
		min-height: 158px;
		border-right: 1px solid rgba(23, 33, 27, 0.12);
		border-bottom: 1px solid rgba(23, 33, 27, 0.12);
		background: #ffffff;
		padding: 1.2rem;
	}

	.gap-reading-node span {
		display: block;
		margin-bottom: 1.25rem;
		color: #27745d;
		font-weight: 800;
	}

	.gap-reading-node p {
		margin: 0;
		color: #27362e;
		font-size: clamp(1.05rem, 1.5vw, 1.24rem);
		font-weight: 680;
		line-height: 1.55;
	}

	.gap-reading-support {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		padding: 1rem;
	}

	.gap-reading-support section {
		border: 1px solid rgba(23, 33, 27, 0.12);
		border-radius: 8px;
		padding: 1rem;
	}

	.gap-reading-support h2 {
		margin: 0 0 0.9rem;
		color: #17211b;
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.gap-reading-support p {
		margin: 0;
		color: #27362e;
		font-size: 1rem;
		line-height: 1.55;
	}

	.gap-reading-support p + p {
		margin-top: 0.65rem;
	}

	.gap-reading-final {
		background: #eff8f3;
	}

	.gap-reading-final p {
		font-size: clamp(1.08rem, 1.55vw, 1.24rem);
		font-weight: 650;
		line-height: 1.58;
	}

	:global([data-theme='dark'] .gap-reading-spine),
	:global(:root:not([data-theme='light']) .gap-reading-spine) {
		border-color: rgba(126, 208, 167, 0.16);
		background: #18211c;
	}

	:global([data-theme='dark'] .gap-reading-header),
	:global(:root:not([data-theme='light']) .gap-reading-header) {
		background: #1e2b24;
	}

	:global([data-theme='dark'] .gap-reading-chain),
	:global(:root:not([data-theme='light']) .gap-reading-chain) {
		border-top-color: rgba(126, 208, 167, 0.1);
		background: #1e2b24;
	}

	:global([data-theme='dark'] .gap-reading-node),
	:global(:root:not([data-theme='light']) .gap-reading-node),
	:global([data-theme='dark'] .gap-reading-support section),
	:global(:root:not([data-theme='light']) .gap-reading-support section) {
		border-color: rgba(126, 208, 167, 0.14);
		background: #111713;
	}

	:global([data-theme='dark'] .gap-reading-header p),
	:global(:root:not([data-theme='light']) .gap-reading-header p),
	:global([data-theme='dark'] .gap-reading-node span),
	:global(:root:not([data-theme='light']) .gap-reading-node span) {
		color: #79caa1;
	}

	:global([data-theme='dark'] .gap-reading-header h1),
	:global(:root:not([data-theme='light']) .gap-reading-header h1),
	:global([data-theme='dark'] .gap-reading-chain span),
	:global(:root:not([data-theme='light']) .gap-reading-chain span),
	:global([data-theme='dark'] .gap-reading-support h2),
	:global(:root:not([data-theme='light']) .gap-reading-support h2) {
		color: #f4f0ec;
	}

	:global([data-theme='dark'] .gap-reading-chain span),
	:global(:root:not([data-theme='light']) .gap-reading-chain span) {
		border-color: rgba(126, 208, 167, 0.22);
		background: rgba(17, 23, 19, 0.72);
	}

	:global([data-theme='dark'] .gap-reading-chain b),
	:global(:root:not([data-theme='light']) .gap-reading-chain b) {
		color: #79caa1;
	}

	:global([data-theme='dark'] .gap-reading-node p),
	:global(:root:not([data-theme='light']) .gap-reading-node p),
	:global([data-theme='dark'] .gap-reading-support p),
	:global(:root:not([data-theme='light']) .gap-reading-support p) {
		color: #d8d0e9;
	}

	:global([data-theme='dark'] .gap-reading-final),
	:global(:root:not([data-theme='light']) .gap-reading-final) {
		background: #1b2a21;
	}

	@media (min-width: 59.5rem) {
		.gap-reading-chain-cell:nth-child(4n + 1):not(:first-child) b {
			top: 0;
			left: 50%;
			transform: translate(-50%, -50%) rotate(90deg);
		}
	}

	@media (min-width: 45.5rem) and (max-width: 59.49rem) {
		.gap-reading-chain-cell:nth-child(3n + 1):not(:first-child) b {
			top: 0;
			left: 50%;
			transform: translate(-50%, -50%) rotate(90deg);
		}
	}

	@media (min-width: 31.5rem) and (max-width: 45.49rem) {
		.gap-reading-chain-cell:nth-child(2n + 1):not(:first-child) b {
			top: 0;
			left: 50%;
			transform: translate(-50%, -50%) rotate(90deg);
		}
	}

	@media (max-width: 31.49rem) {
		.gap-reading-chain b {
			top: 0;
			left: 50%;
			transform: translate(-50%, -50%) rotate(90deg);
		}
	}

	@media (max-width: 760px) {
		.gap-reading-stage {
			width: min(100% - 24px, 1080px);
			padding-top: calc(env(safe-area-inset-top, 0px) + 4.6rem);
		}

		.gap-reading-header,
		.gap-reading-node,
		.gap-reading-support section {
			padding: 1rem;
		}

		.gap-reading-header {
			padding-bottom: 0.8rem;
		}

		.gap-reading-chain-cell {
			padding: 0.6rem 1rem 0.8rem;
		}

		.gap-reading-support {
			grid-template-columns: 1fr;
		}
	}
</style>
