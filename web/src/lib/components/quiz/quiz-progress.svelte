<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { QuizProgressStep } from '$lib/types/quiz';

	type Props = {
		steps?: readonly QuizProgressStep[];
		currentIndex?: number;
		metaLabel?: string | null;
		total?: number;
		secondaryLabel?: string | null;
	};

	let {
		steps = [],
		currentIndex = 0,
		metaLabel = undefined,
		total,
		secondaryLabel = undefined
	}: Props = $props();

	const fallbackTotal = $derived(total ?? steps.length);
	const derivedSteps = $derived(
		steps.length
			? [...steps]
			: Array.from({ length: Math.max(fallbackTotal, 1) }, (_, idx): QuizProgressStep => ({
				status: idx < currentIndex ? 'correct' : idx === currentIndex ? 'active' : 'pending',
				label: `Question ${idx + 1}`
			}))
	);

	const safeCurrent = $derived(
		derivedSteps.length ? Math.min(Math.max(currentIndex, 0), derivedSteps.length - 1) : 0
	);

	const stepCount = $derived(derivedSteps.length || Math.max(fallbackTotal, 1));
	const resolvedLabel = $derived(
		metaLabel === null
			? null
			: metaLabel ?? `${Math.min(safeCurrent + 1, stepCount)} / ${stepCount}`
	);
	const secondaryDisplay = $derived(secondaryLabel?.trim() ?? '');
	const showMeta = $derived(
		resolvedLabel !== null || secondaryDisplay.length > 0
	);

	function segmentClass(status: QuizProgressStep['status']) {
		switch (status) {
			case 'correct':
				return 'bg-emerald-500 shadow-[0_4px_12px_-6px_rgba(16,185,129,0.45)]';
			case 'incorrect':
				return 'bg-amber-500 shadow-[0_4px_12px_-6px_rgba(217,119,6,0.5)]';
			case 'skipped':
				return 'bg-slate-300 dark:bg-slate-600';
			case 'active':
				return 'bg-primary shadow-[0_0_0_2px_rgba(59,130,246,0.18)]';
			default:
				return 'bg-muted';
		}
	}
</script>

<div class="flex w-full items-center gap-4 rounded-2xl border border-border bg-background/90 px-5 py-4 shadow-sm backdrop-blur">
	<div class="flex w-full items-center gap-3">
		<div
			class="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-primary/60 bg-primary/10 text-base font-semibold text-primary shadow-inner"
			aria-label={`Question ${safeCurrent + 1}`}
		>
			{Math.min(safeCurrent + 1, derivedSteps.length)}
		</div>

		<div class="flex flex-1 items-center gap-2" role="list" aria-label="Quiz progress">
			{#each derivedSteps as step, index}
				<div
					class={cn(
						'h-2 flex-1 rounded-full transition-all duration-200',
						segmentClass(step.status),
						index === safeCurrent ? 'ring-[3px] ring-primary/25 ring-offset-2 ring-offset-background' : ''
					)}
					role="listitem"
					aria-current={index === safeCurrent ? 'step' : undefined}
					aria-label={step.label ?? `Question ${index + 1}`}
				></div>
			{/each}
		</div>
	</div>

	{#if showMeta}
		<div class="flex shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground">
			{#if resolvedLabel}
				<span>{resolvedLabel}</span>
			{/if}
			{#if secondaryDisplay}
				<span class="hidden text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-muted-foreground/70 sm:inline">
					{secondaryDisplay}
				</span>
			{/if}
		</div>
	{/if}
</div>
