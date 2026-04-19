<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { browser } from '$app/environment';
	import GapGuidedMode from '$lib/components/spark/gaps/GapGuidedMode.svelte';
	import type {
		SparkLearningGapGuidedPresentation,
		SparkTutorGuidedPhase,
		SparkTutorGuidedState,
		SparkTutorReviewGapBand
	} from '@spark/schemas';

	let {
		sheetId,
		questionId,
		questionLabel,
		subjectLabel,
		gapBand = 'large_gap',
		presentation,
		initialState = null,
		phase = $bindable<SparkTutorGuidedPhase>('questions'),
		loading = false,
		errorMessage = null,
		onClose,
		onPhaseChange,
		onProgressChange
	}: {
		sheetId: string;
		questionId: string;
		questionLabel: string;
		subjectLabel: string;
		gapBand?: SparkTutorReviewGapBand;
		presentation: SparkLearningGapGuidedPresentation | null;
		initialState?: SparkTutorGuidedState | null;
		phase?: SparkTutorGuidedPhase;
		loading?: boolean;
		errorMessage?: string | null;
		onClose: () => void;
		onPhaseChange: (phase: SparkTutorGuidedPhase) => void;
		onProgressChange: (state: SparkTutorGuidedState) => void;
	} = $props();

	const progressLabel = $derived.by(() => {
		switch (gapBand) {
			case 'large_gap':
				return 'largest gap';
			case 'medium_gap':
				return 'closing';
			case 'small_gap':
				return 'nearly closed';
			case 'closed':
				return 'closed';
		}
	});

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}

	$effect(() => {
		if (!browser) {
			return;
		}
		document.body.classList.add('close-gap-response-modal-is-open');
		return () => {
			document.body.classList.remove('close-gap-response-modal-is-open');
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class={`close-gap-response-modal is-gap-${gapBand}`}
	role="presentation"
	onclick={handleBackdropClick}
>
	<div
		class="close-gap-response-modal__dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="close-gap-response-title"
	>
		<header class="close-gap-response-modal__chrome">
			<div>
				<div class="close-gap-response-modal__meta">
					<p>{questionLabel}</p>
					<span>{progressLabel}</span>
				</div>
				<h2 id="close-gap-response-title">Close the gap</h2>
			</div>
			<button
				type="button"
				class="close-gap-response-modal__close"
				aria-label="Close gap"
				onclick={onClose}
			>
				<XIcon size={20} />
			</button>
		</header>

		<div class="close-gap-response-modal__body">
			{#if loading}
				<section class="close-gap-response-modal__status" aria-live="polite">
					<span class="close-gap-response-modal__spinner" aria-hidden="true"></span>
					<p>Building the answer steps...</p>
				</section>
			{:else if errorMessage}
				<section class="close-gap-response-modal__status" role="alert">
					<p>{errorMessage}</p>
				</section>
			{:else if presentation}
				<GapGuidedMode
					gapId={`${sheetId}-${questionId}`}
					{subjectLabel}
					{presentation}
					{initialState}
					bind:phase
					modalLayout={true}
					showStageNavigation={true}
					copyGuard={true}
					fieldGradeEndpoint={`/api/spark/sheets/${sheetId}/guided-field-grade?questionId=${encodeURIComponent(questionId)}`}
					finalGradeEndpoint={`/api/spark/sheets/${sheetId}/guided-grade?questionId=${encodeURIComponent(questionId)}`}
					{onPhaseChange}
					{onProgressChange}
					onDone={onClose}
				/>
			{/if}
		</div>
	</div>
</div>

<style>
	.close-gap-response-modal {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: grid;
		place-items: center;
		padding: 3rem 1.25rem;
		background: var(--close-gap-backdrop);
		backdrop-filter: blur(16px) saturate(0.98);
		color: var(--close-gap-ink);
		--close-gap-backdrop: color-mix(in srgb, #f4fbf7 44%, rgba(31, 49, 38, 0.46));
		--close-gap-paper: #ffffff;
		--close-gap-paper-soft: #f7fbf5;
		--close-gap-paper-border: rgba(39, 116, 93, 0.2);
		--close-gap-ink: #17211b;
		--close-gap-muted: rgba(23, 33, 27, 0.68);
		--close-gap-accent: #27745d;
		--close-gap-shadow: 0 24px 84px -46px rgba(15, 23, 42, 0.52);
	}

	.close-gap-response-modal.is-gap-medium_gap {
		--close-gap-backdrop: color-mix(in srgb, #fff7df 42%, rgba(72, 58, 26, 0.42));
		--close-gap-paper-border: rgba(176, 122, 0, 0.24);
		--close-gap-accent: #a76b16;
	}

	.close-gap-response-modal.is-gap-small_gap,
	.close-gap-response-modal.is-gap-closed {
		--close-gap-backdrop: color-mix(in srgb, #f0fbf6 44%, rgba(36, 78, 61, 0.42));
		--close-gap-paper-border: rgba(34, 166, 110, 0.24);
		--close-gap-accent: #23845d;
	}

	.close-gap-response-modal__dialog {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		width: min(64rem, 100%);
		max-height: calc(100dvh - 6rem);
		overflow: hidden;
		border: 1px solid var(--close-gap-paper-border);
		border-radius: 8px;
		background: var(--close-gap-paper);
		box-shadow: var(--close-gap-shadow);
	}

	.close-gap-response-modal__chrome {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--close-gap-paper-border);
		background: var(--close-gap-paper-soft);
		padding: 0.85rem 1rem;
	}

	.close-gap-response-modal__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.close-gap-response-modal__meta p,
	.close-gap-response-modal__chrome h2 {
		margin: 0;
	}

	.close-gap-response-modal__meta p {
		color: var(--close-gap-muted);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.close-gap-response-modal__meta span {
		display: inline-flex;
		align-items: center;
		min-height: 1.35rem;
		border: 1px solid color-mix(in srgb, var(--close-gap-accent) 34%, transparent);
		border-radius: 999px;
		color: var(--close-gap-accent);
		padding: 0 0.55rem;
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.close-gap-response-modal__chrome h2 {
		margin-top: 0.18rem;
		color: var(--close-gap-ink);
		font-size: 1.18rem;
		line-height: 1.15;
	}

	.close-gap-response-modal__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 2.2rem;
		border: 1px solid var(--close-gap-paper-border);
		border-radius: 8px;
		background: var(--close-gap-paper);
		color: var(--close-gap-ink);
		cursor: pointer;
	}

	.close-gap-response-modal__body {
		min-height: 0;
		overflow: auto;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, #d7eadf 52%, transparent) 0 1px,
				transparent 1px 100%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, #b8d9c6 38%, transparent) 0 1px,
				transparent 1px 2rem
			),
			linear-gradient(180deg, #f7fbf5 0%, #fffdf5 100%);
		background-size:
			2.1rem 2.1rem,
			100% 2rem,
			100% 100%;
		padding: 1rem;
	}

	.close-gap-response-modal__status {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 14rem;
		justify-content: center;
		color: var(--close-gap-muted);
		font-weight: 700;
	}

	.close-gap-response-modal__status p {
		margin: 0;
	}

	.close-gap-response-modal__spinner {
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--close-gap-accent) 22%, transparent);
		border-top-color: var(--close-gap-accent);
		animation: close-gap-spin 1s linear infinite;
	}

	:global(body.close-gap-response-modal-is-open) {
		overflow: hidden;
	}

	:global([data-theme='dark']) .close-gap-response-modal,
	:global(:root:not([data-theme='light'])) .close-gap-response-modal {
		--close-gap-backdrop: color-mix(in srgb, #101713 48%, rgba(4, 8, 6, 0.66));
		--close-gap-paper: #18211c;
		--close-gap-paper-soft: #111713;
		--close-gap-paper-border: rgba(126, 208, 167, 0.18);
		--close-gap-ink: #f4f1ea;
		--close-gap-muted: #d8e2da;
		--close-gap-accent: #68c79d;
		--close-gap-shadow: 0 30px 90px -44px rgba(0, 0, 0, 0.78);
	}

	:global([data-theme='dark']) .close-gap-response-modal__body,
	:global(:root:not([data-theme='light'])) .close-gap-response-modal__body {
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, #2f4d3e 46%, transparent) 0 1px,
				transparent 1px 100%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, #2f4d3e 40%, transparent) 0 1px,
				transparent 1px 2rem
			),
			linear-gradient(180deg, #101713 0%, #162119 100%);
	}

	@keyframes close-gap-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 820px) {
		.close-gap-response-modal {
			padding: 0;
		}

		.close-gap-response-modal__dialog {
			width: 100%;
			min-height: 100dvh;
			max-height: 100dvh;
			border: 0;
			border-radius: 0;
		}

		.close-gap-response-modal__body {
			padding: 0.7rem;
		}
	}
</style>
