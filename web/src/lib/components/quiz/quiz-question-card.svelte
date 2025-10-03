<script lang="ts">
	import {
		Card,
		CardContent,
		CardFooter,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { QuizFeedback } from '$lib/types/quiz';
	import type { HTMLAttributes } from 'svelte/elements';

	type Status = 'neutral' | 'correct' | 'incorrect';

	type Props = HTMLAttributes<HTMLDivElement> & {
		eyebrow?: string | null;
		title?: string;
		status?: Status;
		hint?: string;
		showHint?: boolean;
		feedback?: QuizFeedback | null;
		explanation?: string;
		showExplanation?: boolean;
		displayFooter?: boolean;
	};

	let {
		eyebrow = 'Term',
		title,
		status: statusProp = 'neutral' as Status,
		hint,
		showHint = false,
		feedback = null,
		explanation,
		showExplanation = false,
		displayFooter = true,
		class: className,
		...restProps
	}: Props = $props();

	const statusStyles: Record<Status, string> = {
		neutral:
			'border-[color:var(--app-content-border)] bg-[color:var(--app-content-bg)] shadow-[var(--app-content-shadow-primary)]/20 backdrop-blur-sm',
		correct:
			'border-emerald-200/70 bg-emerald-50/70 text-emerald-950 shadow-[0_24px_60px_-40px_rgba(16,185,129,0.55)] dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100',
		incorrect:
			'border-amber-200/70 bg-amber-50/80 text-amber-950 shadow-[0_24px_60px_-40px_rgba(217,119,6,0.5)] dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100'
	};

	const feedbackToneStyles = {
		success:
			'border-emerald-200/70 bg-emerald-50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100',
		warning:
			'border-amber-200/70 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100',
		info: 'border-primary/30 bg-primary/5 text-primary dark:border-primary/40 dark:bg-primary/10 dark:text-primary-100'
	} as const;

	const cardClass = $derived(
		cn(
			'p-6 md:p-8 border rounded-3xl transition-colors duration-300',
			statusStyles[statusProp],
			className
		)
	);

	const feedbackClass = $derived(
		feedback
			? feedbackToneStyles[
					feedback.tone ??
						(statusProp === 'correct' ? 'success' : statusProp === 'incorrect' ? 'warning' : 'info')
				]
			: undefined
	);
</script>

<Card class={cardClass} {...restProps}>
	<CardHeader class="p-0">
		<div class="space-y-3">
			{#if eyebrow !== null}
				<span
					class="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold tracking-[0.32em] text-primary/80 uppercase shadow-sm"
				>
					{eyebrow}
				</span>
			{/if}
			{#if title}
				<CardTitle class="text-xl leading-snug font-semibold text-foreground md:text-2xl">
					{title}
				</CardTitle>
			{/if}
		</div>
	</CardHeader>

	<CardContent class="space-y-6 p-0">
		<slot />

		{#if showHint && hint}
			<div
				class="dark:text-primary-100 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-primary shadow-sm dark:border-primary/40 dark:bg-primary/15"
			>
				<p
					class="dark:text-primary-100/70 text-xs font-semibold tracking-[0.22em] text-primary/70 uppercase"
				>
					Hint
				</p>
				<p class="mt-1 text-base leading-relaxed text-foreground/90 dark:text-foreground">
					{hint}
				</p>
			</div>
		{/if}

		{#if showExplanation && explanation}
			<div
				class="rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground dark:bg-muted/20"
			>
				<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground/80 uppercase">
					Explanation
				</p>
				<p class="mt-1 text-base leading-relaxed text-muted-foreground/90">
					{explanation}
				</p>
			</div>
		{/if}

		{#if feedback}
			<div class={cn('rounded-2xl border px-4 py-3 text-sm shadow-sm', feedbackClass)}>
				{#if feedback.heading}
					<p class="text-sm font-semibold tracking-tight">{feedback.heading}</p>
				{/if}
				<p class="mt-1 text-base leading-relaxed">{feedback.message}</p>
			</div>
		{/if}
	</CardContent>

	{#if displayFooter}
		<CardFooter class="flex flex-wrap items-center justify-between gap-3 p-0 pt-6">
			<slot name="footer" />
		</CardFooter>
	{/if}
</Card>
