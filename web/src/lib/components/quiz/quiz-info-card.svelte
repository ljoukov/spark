<script lang="ts">
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { QuizInfoCardQuestion } from '$lib/types/quiz';

	type Status = 'neutral' | 'correct' | 'incorrect';
	type BusyAction = 'submit' | 'dontKnow' | 'continue';

	type Props = {
		question: QuizInfoCardQuestion;
		continueLabel?: string;
		status?: Status;
		busy?: boolean;
		busyAction?: BusyAction | null;
		onContinue?: () => void;
	};

	let {
		question,
		continueLabel = question.continueLabel ?? 'Next',
		status: statusProp = 'neutral' as Status,
		busy = false,
		busyAction = null,
		onContinue = undefined
	}: Props = $props();

	const eyebrow = $derived(question.eyebrow ?? 'Concept spotlight');
	const isContinueBusy = $derived(busy && busyAction === 'continue');

	function handleContinue() {
		onContinue?.();
	}
</script>

<QuizQuestionCard
	title={question.prompt}
	titleHtml={question.promptHtml}
	status={statusProp}
	{eyebrow}
	displayFooter={true}
>
	<div class="space-y-4">
		{#if question.bodyHtml}
			<div class="info-markdown text-base leading-relaxed text-foreground/90">
				{@html question.bodyHtml}
			</div>
		{:else}
			<p class="text-base leading-relaxed text-foreground/90">
				{question.body}
			</p>
		{/if}
	</div>

	{#snippet footer()}
		<div class="ml-auto flex items-center gap-2">
			<Button size="lg" onclick={handleContinue} disabled={busy}>
				{#if isContinueBusy}
					<span
						class="mr-2 inline-flex size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
					></span>
					<span>Loading…</span>
				{:else}
					{continueLabel}
				{/if}
			</Button>
		</div>
	{/snippet}
</QuizQuestionCard>

<style>
	.info-markdown :global(p) {
		margin: 0 0 0.75rem;
	}

	.info-markdown :global(p:last-child) {
		margin-bottom: 0;
	}

	.info-markdown :global(ul),
	.info-markdown :global(ol) {
		margin: 0.25rem 0 0.5rem 1.25rem;
		padding: 0;
	}

	.info-markdown :global(li + li) {
		margin-top: 0.35rem;
	}

	.info-markdown :global(strong) {
		font-weight: 600;
	}

	.info-markdown :global(code) {
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
</style>
