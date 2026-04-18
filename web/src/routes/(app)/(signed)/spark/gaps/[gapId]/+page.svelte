<script lang="ts">
	import { goto } from '$app/navigation';
	import GapGuidedMode from '$lib/components/spark/gaps/GapGuidedMode.svelte';
	import { fallbackGuidedPresentation } from '$lib/spark/gaps/guidedPresentation';
	import type { SparkLearningGapGuidedPresentation } from '@spark/schemas';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const gap = $derived(data.gap);
	const guidedPresentation = $derived(
		(gap.presentations?.v17 ?? fallbackGuidedPresentation(gap)) satisfies SparkLearningGapGuidedPresentation
	);

	function closeGap(): void {
		void goto('/spark/sheets');
	}
</script>

<svelte:head>
	<title>Spark · {gap.title}</title>
</svelte:head>

<section class="gap-page">
	<GapGuidedMode
		gapId={gap.id}
		subjectLabel={gap.subjectLabel}
		presentation={guidedPresentation}
		onDone={closeGap}
	/>
</section>

<style>
	.gap-page {
		display: block;
		width: 100%;
		min-height: 100dvh;
		overflow: visible;
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
			linear-gradient(180deg, #f7fbf5 0%, #fffdf5 44%, #f7fbf5 100%);
		background-size:
			2.1rem 2.1rem,
			100% 2rem,
			100% 100%;
		color: var(--foreground);
	}

	:global([data-theme='dark'] .gap-page),
	:global(:root:not([data-theme='light']) .gap-page) {
		--background: #111713;
		--foreground: #f4f1ea;
		--card: #18211c;
		--card-foreground: #f4f1ea;
		--popover: #18211c;
		--popover-foreground: #f4f1ea;
		--primary: #79caa1;
		--primary-foreground: #0d1510;
		--secondary: #1d2a22;
		--secondary-foreground: #f4f1ea;
		--muted: #1d2a22;
		--muted-foreground: #b8c7bd;
		--accent: #203528;
		--accent-foreground: #f4f1ea;
		--border: rgba(126, 208, 167, 0.18);
		--input: rgba(126, 208, 167, 0.22);
		--ring: rgba(126, 208, 167, 0.52);
		--app-content-bg: rgba(24, 33, 28, 0.9);
		--app-content-border: rgba(126, 208, 167, 0.18);
		--app-content-shadow-primary: 0 48px 140px -60px rgba(0, 0, 0, 0.82);
		--app-content-shadow-secondary: 0 40px 110px -70px rgba(0, 0, 0, 0.7);
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
			linear-gradient(180deg, #101713 0%, #162119 48%, #101713 100%);
	}

	@media (max-width: 71.875rem) {
		:global(.app-shell:has(.gap-page) .sheet-close-button) {
			top: calc(env(safe-area-inset-top, 0px) + 1.5rem);
		}
	}

	@media (max-width: 43.75rem) {
		:global(.app-shell:has(.gap-page) .sheet-close-button) {
			top: calc(env(safe-area-inset-top, 0px) + 1.2rem);
		}
	}
</style>
