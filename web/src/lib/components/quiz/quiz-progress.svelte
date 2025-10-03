<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { cn } from '$lib/utils.js';
	import type { QuizProgressStep } from '$lib/types/quiz';

	type Props = {
		steps?: readonly QuizProgressStep[];
		currentIndex?: number;
		metaLabel?: string | null;
		total?: number;
	};

	const dispatch = createEventDispatcher<{
		navigate: { index: number };
		finish: void;
	}>();

	let { steps = [], currentIndex = 0, metaLabel = undefined, total }: Props = $props();

	const fallbackTotal = $derived(total ?? steps.length);
	const derivedSteps = $derived(
		steps.length
			? [...steps]
			: Array.from(
					{ length: Math.max(fallbackTotal, 1) },
					(_, idx): QuizProgressStep => ({
						status: idx < currentIndex ? 'correct' : idx === currentIndex ? 'active' : 'pending',
						label: `Question ${idx + 1}`
					})
				)
	);

	const safeCurrent = $derived(
		derivedSteps.length ? Math.min(Math.max(currentIndex, 0), derivedSteps.length - 1) : 0
	);

	const stepCount = $derived(derivedSteps.length || Math.max(fallbackTotal, 1));
	const resolvedLabel = $derived(
		metaLabel === null
			? null
			: (metaLabel ?? `${Math.min(safeCurrent + 1, stepCount)} / ${stepCount}`)
	);

	function segmentClass(status: QuizProgressStep['status']) {
		switch (status) {
			case 'correct':
				return 'bg-emerald-500 shadow-[0_4px_12px_-6px_rgba(16,185,129,0.45)]';
			case 'incorrect':
				return 'bg-amber-500 shadow-[0_4px_12px_-6px_rgba(217,119,6,0.5)]';
			case 'skipped':
				return 'bg-slate-300 dark:bg-slate-600';
			case 'seen':
				// Subtle clue for seen-but-unanswered: tint only (no shadow/ring)
				return 'bg-primary/15';
			case 'active':
				return 'bg-primary shadow-[0_0_0_2px_rgba(59,130,246,0.18)]';
			default:
				return 'bg-muted';
		}
	}

	function handleNavigate(index: number) {
		const step = derivedSteps[index];
		if (step && step.status !== 'pending' && index !== safeCurrent) {
			dispatch('navigate', { index });
		}
	}

	function handleFinish() {
		dispatch('finish');
	}
</script>

<div
	class="flex w-full items-center gap-4 rounded-3xl border border-border bg-background/95 px-4 py-2 shadow-sm backdrop-blur"
>
	<div class="flex w-full items-center gap-3">
		<div
			class="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-lg font-semibold text-primary shadow-inner"
			aria-label={`Question ${safeCurrent + 1}`}
		>
			{Math.min(safeCurrent + 1, derivedSteps.length)}
		</div>

		<div class="flex flex-1 items-center gap-2" role="list" aria-label="Quiz progress">
			{#each derivedSteps as step, index}
				{@const isActive = index === safeCurrent}
				{@const canNavigate = step.status !== 'pending' && index !== safeCurrent}
				{#if canNavigate}
					<div role="listitem" class="flex flex-1 items-center">
						<button
							type="button"
							class={cn(
								'block h-2 w-full cursor-pointer rounded-full transition-all duration-200 focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none',
								segmentClass(step.status)
							)}
							aria-label={step.label ?? `Question ${index + 1}`}
							onclick={() => handleNavigate(index)}
						></button>
					</div>
				{:else}
					<div
						class={cn(
							'h-2 flex-1 rounded-full transition-all duration-200',
							segmentClass(step.status),
							isActive ? 'ring-[3px] ring-primary/25 ring-offset-2 ring-offset-background' : ''
						)}
						role="listitem"
						aria-current={isActive ? 'step' : undefined}
						aria-label={step.label ?? `Question ${index + 1}`}
					></div>
				{/if}
			{/each}
		</div>
	</div>

	<div class="flex shrink-0 items-center gap-3 text-muted-foreground">
		{#if resolvedLabel}
			<span class="text-base font-semibold tracking-tight md:text-lg">{resolvedLabel}</span>
		{/if}
		<button
			type="button"
			class="flex size-8 items-center justify-center rounded-full border-2 border-border text-lg font-semibold text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive focus-visible:ring-4 focus-visible:ring-destructive/20 focus-visible:outline-none"
			aria-label="Finish quiz"
			onclick={handleFinish}
		>
			×
		</button>
	</div>
</div>
