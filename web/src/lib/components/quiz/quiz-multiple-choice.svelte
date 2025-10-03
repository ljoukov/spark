<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { QuizFeedback, QuizMultipleChoiceQuestion } from '$lib/types/quiz';
	import { cn } from '$lib/utils.js';

	type Status = 'neutral' | 'correct' | 'incorrect';

	const dispatch = createEventDispatcher<{
		select: { optionId: string };
		submit: { optionId: string };
		requestHint: void;
		dontKnow: void;
		continue: void;
	}>();

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
		answerLabel = 'Answer',
		continueLabel = 'Continue',
		hintLabel = 'Show hint',
		dontKnowLabel = "Don't know?"
	}: Props = $props();

	function optionState(optionId: string) {
		if (statusProp === 'correct') {
			return optionId === question.correctOptionId ? 'correct' : optionId === selectedOptionId ? 'selected' : 'idle';
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
			state === 'idle' && statusProp === 'neutral' ? 'border-border bg-background hover:border-primary/30 hover:bg-primary/5' : '',
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
		dispatch('select', { optionId });
	}

	function handleSubmit() {
		if (!selectedOptionId) {
			return;
		}
		dispatch('submit', { optionId: selectedOptionId });
	}

	function handleHint() {
		dispatch('requestHint');
	}

	function handleDontKnow() {
		dispatch('dontKnow');
	}

	function handleContinue() {
		dispatch('continue');
	}

	const revealExplanation = $derived(showExplanationProp ?? statusProp !== 'neutral');
	const submitDisabled = $derived(!selectedOptionId || locked);
</script>

<QuizQuestionCard
	title={question.prompt}
	status={statusProp}
	hint={question.hint}
	showHint={showHint}
	feedback={feedback}
	explanation={question.explanation}
	showExplanation={revealExplanation}
>
	<div class="space-y-4">
		<p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
			Choose an answer
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each question.options as option}
				<button
					type="button"
					class={optionClasses(option.id)}
					onclick={() => handleSelect(option.id)}
					disabled={locked && statusProp !== 'neutral'}
					aria-pressed={option.id === selectedOptionId}
				>
					<span class={bulletClasses(option.id)}>{option.label}</span>
					<span class="text-base font-medium leading-relaxed text-foreground">
						{option.text}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<div slot="footer" class="flex w-full flex-wrap items-center gap-3">
		<div class="flex items-center gap-2">
			{#if question.hint}
				<Button
					variant="ghost"
					size="sm"
					onclick={handleHint}
					disabled={showHint}
				>
					{hintLabel}
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="sm"
				onclick={handleDontKnow}
				disabled={locked && statusProp !== 'neutral'}
			>
				{dontKnowLabel}
			</Button>
		</div>

		<div class="ml-auto flex items-center gap-2">
			{#if showContinue}
				<Button size="lg" onclick={handleContinue}>{continueLabel}</Button>
			{:else}
				<Button
					size="lg"
					onclick={handleSubmit}
					disabled={submitDisabled}
				>
					{answerLabel}
				</Button>
			{/if}
		</div>
	</div>
</QuizQuestionCard>
