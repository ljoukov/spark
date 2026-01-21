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
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Status = 'neutral' | 'correct' | 'incorrect';

	type Props = HTMLAttributes<HTMLDivElement> & {
		eyebrow?: string | null;
		title?: string;
		status?: Status;
		hint?: string;
		hintHtml?: string;
		showHint?: boolean;
		feedback?: QuizFeedback | null;
		explanation?: string;
		explanationHtml?: string;
		showExplanation?: boolean;
		displayFooter?: boolean;
		titleHtml?: string;
		children?: Snippet;
		footer?: Snippet;
	};

	let {
		eyebrow = 'Term',
		title,
		status: statusProp = 'neutral' as Status,
		hint,
		hintHtml,
		showHint = false,
		feedback = null,
		explanation,
		explanationHtml,
		showExplanation = false,
		displayFooter = true,
		titleHtml,
		children,
		footer,
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
					{#if titleHtml}
						<span class="markdown-title">{@html titleHtml}</span>
					{:else}
						{title}
					{/if}
				</CardTitle>
			{/if}
		</div>
	</CardHeader>

	<CardContent class="p-0">
		{@render children?.()}

		{#if showHint && (hintHtml || hint)}
			<div
				class="dark:text-primary-100 mt-6 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-primary shadow-sm dark:border-primary/40 dark:bg-primary/15"
			>
				<p
					class="dark:text-primary-100/70 text-xs font-semibold tracking-[0.22em] text-primary/70 uppercase"
				>
					Hint
				</p>
				{#if hintHtml}
					<div
						class="markdown mt-1 text-base leading-relaxed text-foreground/90 dark:text-foreground"
					>
						{@html hintHtml}
					</div>
				{:else if hint}
					<p class="mt-1 text-base leading-relaxed text-foreground/90 dark:text-foreground">
						{hint}
					</p>
				{/if}
			</div>
		{/if}

		{#if showExplanation && (explanationHtml || explanation)}
			<div
				class="mt-6 rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground dark:bg-muted/20"
			>
				<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground/80 uppercase">
					Explanation
				</p>
				{#if explanationHtml}
					<div class="markdown mt-1 text-base leading-relaxed text-muted-foreground/90">
						{@html explanationHtml}
					</div>
				{:else if explanation}
					<p class="mt-1 text-base leading-relaxed text-muted-foreground/90">
						{explanation}
					</p>
				{/if}
			</div>
		{/if}

		{#if feedback}
			<div class={cn('mt-6 rounded-2xl border px-4 py-3 text-sm shadow-sm', feedbackClass)}>
				{#if feedback.heading}
					<p class="text-sm font-semibold tracking-tight">{feedback.heading}</p>
				{/if}
				{#if feedback.messageHtml}
					<div class="markdown mt-1 text-base leading-relaxed">
						{@html feedback.messageHtml}
					</div>
				{:else}
					<p class="mt-1 text-base leading-relaxed">{feedback.message}</p>
				{/if}
			</div>
		{/if}
	</CardContent>

	{#if displayFooter}
		<CardFooter class="flex flex-wrap items-center justify-between gap-3 p-0 pt-6">
			{@render footer?.()}
		</CardFooter>
	{/if}
</Card>

<style>
	.markdown {
		display: block;
	}

	.markdown-title {
		display: block;
	}

	.markdown :global(p),
	.markdown-title :global(p) {
		margin: 0 0 0.75rem;
	}

	.markdown :global(p:last-child),
	.markdown-title :global(p:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0.5rem 0 0.75rem 1.25rem;
		padding: 0;
	}

	.markdown :global(li + li) {
		margin-top: 0.35rem;
	}

	.markdown :global(code),
	.markdown-title :global(code) {
		font-family: var(
			--font-mono,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			'Liberation Mono',
			'Courier New',
			monospace
		);
		font-size: 0.95em;
		padding: 0.1rem 0.25rem;
		border-radius: 0.35rem;
		background-color: color-mix(in srgb, currentColor 12%, transparent);
	}

	.markdown :global(pre),
	.markdown-title :global(pre) {
		margin: 0.85rem 0 1rem;
		padding: 0.95rem 1rem;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		background: color-mix(in srgb, currentColor 10%, transparent);
		overflow-x: auto;
		font-weight: 500;
	}

	.markdown :global(pre code),
	.markdown-title :global(pre code) {
		display: block;
		padding: 0;
		background: transparent;
		font-family: var(
			--font-mono,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			'Liberation Mono',
			'Courier New',
			monospace
		);
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.markdown :global(strong),
	.markdown-title :global(strong) {
		font-weight: 600;
	}

	.markdown :global(em),
	.markdown-title :global(em) {
		font-style: italic;
	}
</style>
