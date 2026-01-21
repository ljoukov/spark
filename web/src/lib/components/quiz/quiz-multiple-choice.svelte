<script lang="ts">
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { QuizFeedback, QuizMultipleChoiceQuestion } from '$lib/types/quiz';
	import { cn } from '$lib/utils.js';

	type Status = 'neutral' | 'correct' | 'incorrect';
	type BusyAction = 'submit' | 'dontKnow' | 'continue';

	type Props = {
		question: QuizMultipleChoiceQuestion;
		selectedOptionId?: string | null;
		status?: Status;
		showHint?: boolean;
		locked?: boolean;
		feedback?: QuizFeedback | null;
		showExplanation?: boolean;
		showContinue?: boolean;
		answerLabel?: string;
		continueLabel?: string;
		hintLabel?: string;
		dontKnowLabel?: string;
		eyebrow?: string | null;
		busy?: boolean;
		busyAction?: BusyAction | null;
		onSelect?: (detail: { optionId: string }) => void;
		onSubmit?: (detail: { optionId: string }) => void;
		onRequestHint?: () => void;
		onDontKnow?: () => void;
		onContinue?: () => void;
	};

	let {
		question,
		selectedOptionId = $bindable<string | null>(null),
		status: statusProp = 'neutral' as Status,
		showHint = false,
		locked = false,
		feedback = null,
		showExplanation: showExplanationProp = undefined,
		showContinue = false,
		answerLabel = 'Submit',
		continueLabel = 'Continue',
		hintLabel = 'Show hint',
		dontKnowLabel = "Don't know?",
		eyebrow = undefined,
		busy = false,
		busyAction = null,
		onSelect = undefined,
		onSubmit = undefined,
		onRequestHint = undefined,
		onDontKnow = undefined,
		onContinue = undefined
	}: Props = $props();

	function optionState(optionId: string) {
		if (statusProp === 'correct') {
			return optionId === question.correctOptionId
				? 'correct'
				: optionId === selectedOptionId
					? 'selected'
					: 'idle';
		}

		if (statusProp === 'incorrect') {
			if (optionId === question.correctOptionId) {
				return 'correct';
			}
			return optionId === selectedOptionId ? 'incorrect' : 'idle';
		}

		return optionId === selectedOptionId ? 'selected' : 'idle';
	}

	function optionClasses(optionId: string) {
		const state = optionState(optionId);
		return cn(
			'flex w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
			state === 'selected' && statusProp === 'neutral'
				? 'border-primary/60 bg-primary/10 shadow-[0_18px_45px_-30px_rgba(59,130,246,0.65)]'
				: '',
			state === 'correct'
				? 'border-emerald-300 bg-emerald-50/80 text-emerald-900 shadow-[0_18px_45px_-30px_rgba(16,185,129,0.65)] dark:border-emerald-400/60 dark:bg-emerald-500/10 dark:text-emerald-100'
				: '',
			state === 'incorrect'
				? 'border-amber-300 bg-amber-50/80 text-amber-900 shadow-[0_18px_45px_-30px_rgba(217,119,6,0.5)] dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100'
				: '',
			state === 'idle' && statusProp === 'neutral'
				? 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
				: '',
			locked && statusProp === 'neutral' ? 'opacity-90' : ''
		);
	}

	function bulletClasses(optionId: string) {
		const state = optionState(optionId);
		return cn(
			'flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
			state === 'correct'
				? 'border-emerald-400 bg-emerald-500 text-white'
				: state === 'incorrect'
					? 'border-amber-400 bg-amber-500 text-white'
					: state === 'selected'
						? 'border-primary/80 bg-primary text-primary-foreground'
						: 'border-border bg-background text-muted-foreground'
		);
	}

	function handleSelect(optionId: string) {
		if (locked && statusProp !== 'neutral') {
			return;
		}
		selectedOptionId = optionId;
		onSelect?.({ optionId });
	}

	function handleSubmit() {
		if (!selectedOptionId) {
			return;
		}
		onSubmit?.({ optionId: selectedOptionId });
	}

	function handleHint() {
		onRequestHint?.();
	}

	function handleDontKnow() {
		onDontKnow?.();
	}

	function handleContinue() {
		onContinue?.();
	}

	const revealExplanation = $derived(showExplanationProp ?? statusProp !== 'neutral');
	const isSubmitBusy = $derived(busy && busyAction === 'submit');
	const isDontKnowBusy = $derived(busy && busyAction === 'dontKnow');
	const isContinueBusy = $derived(busy && busyAction === 'continue');
	const inputDisabled = $derived(busy || (locked && statusProp !== 'neutral'));
	const submitDisabled = $derived(!selectedOptionId || locked || busy);
</script>

<QuizQuestionCard
	title={question.prompt}
	titleHtml={question.promptHtml}
	{eyebrow}
	status={statusProp}
	hint={question.hint}
	hintHtml={question.hintHtml}
	{showHint}
	{feedback}
	explanation={question.explanation}
	explanationHtml={question.explanationHtml}
	showExplanation={revealExplanation}
>
	<div class="space-y-4">
		<p class="text-sm font-medium tracking-[0.18em] text-muted-foreground/80 uppercase">
			Choose an answer
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each question.options as option}
				<button
					type="button"
					class={optionClasses(option.id)}
					onclick={() => handleSelect(option.id)}
					disabled={inputDisabled}
					aria-pressed={option.id === selectedOptionId}
				>
					<span class={bulletClasses(option.id)}>{option.label}</span>
					<span class="option-text text-base leading-relaxed font-medium text-foreground">
						{#if option.textHtml}
							<span class="markdown-option">{@html option.textHtml}</span>
						{:else}
							{option.text}
						{/if}
					</span>
				</button>
			{/each}
		</div>
	</div>

	{#snippet footer()}
		<div class="flex w-full flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				{#if question.hint}
					<Button variant="ghost" size="sm" onclick={handleHint} disabled={showHint || busy}>
						{hintLabel}
					</Button>
				{/if}
				<Button variant="ghost" size="sm" onclick={handleDontKnow} disabled={inputDisabled}>
					{#if isDontKnowBusy}
						<span
							class="mr-2 inline-flex size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
						></span>
						<span>Submitting…</span>
					{:else}
						{dontKnowLabel}
					{/if}
				</Button>
			</div>

			<div class="ml-auto flex items-center gap-2">
				{#if showContinue}
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
				{:else}
					<Button size="lg" onclick={handleSubmit} disabled={submitDisabled}>
						{#if isSubmitBusy}
							<span
								class="mr-2 inline-flex size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
							></span>
							<span>Submitting…</span>
						{:else}
							{answerLabel}
						{/if}
					</Button>
				{/if}
			</div>
		</div>
	{/snippet}
</QuizQuestionCard>

<style>
	.option-text {
		flex: 1;
		text-align: left;
	}

	.markdown-option {
		display: block;
	}

	.markdown-option :global(p) {
		margin: 0 0 0.5rem;
	}

	.markdown-option :global(p:last-child) {
		margin-bottom: 0;
	}

	.markdown-option :global(ul),
	.markdown-option :global(ol) {
		margin: 0.25rem 0 0.5rem 1.25rem;
		padding: 0;
	}

	.markdown-option :global(li + li) {
		margin-top: 0.35rem;
	}

	.markdown-option :global(strong) {
		font-weight: 600;
	}

	.markdown-option :global(code) {
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
