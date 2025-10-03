<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { QuizFeedback, QuizTypeAnswerQuestion } from '$lib/types/quiz';

	type Status = 'neutral' | 'correct' | 'incorrect';

	const dispatch = createEventDispatcher<{
		input: { value: string };
		submit: { value: string };
		requestHint: void;
		dontKnow: void;
		continue: void;
	}>();

	type Props = {
		question: QuizTypeAnswerQuestion;
		value?: string;
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
		placeholder?: string;
		eyebrow?: string | null;
	};

	let {
		question,
		value = $bindable(''),
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
		placeholder = question.placeholder ?? 'Type your answer',
		eyebrow = undefined
	}: Props = $props();

	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		value = target.value;
		dispatch('input', { value });
	}

	function handleSubmit() {
		if (!value.trim()) {
			return;
		}
		dispatch('submit', { value: value.trim() });
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

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSubmit();
		}
	}

	const revealExplanation = $derived(showExplanationProp ?? statusProp !== 'neutral');
	const showAnswerPanel = $derived(statusProp !== 'neutral');
	const trimmedValue = $derived(value.trim());
</script>

<QuizQuestionCard
		title={question.prompt}
		eyebrow={eyebrow}
	status={statusProp}
	hint={question.hint}
	showHint={showHint}
	feedback={feedback}
	explanation={question.explanation}
	showExplanation={revealExplanation}
>
	<div class="space-y-4">
		<p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
			Your answer
		</p>
		<Input
			class="h-12 w-full rounded-2xl border-2 border-input bg-background px-4 text-base shadow-sm transition-colors focus-visible:border-ring"
			type="text"
			bind:value={value}
			oninput={handleInput}
			onkeydown={handleKeyDown}
			disabled={locked}
			autocomplete="off"
			spellcheck="false"
			placeholder={placeholder}
		/>
	</div>

	{#if showAnswerPanel}
		<div class="rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
			<p class="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">
				Correct answer
			</p>
			<p class="mt-1 text-base leading-relaxed text-foreground/90">
				{question.answer}
			</p>
			{#if question.acceptableAnswers?.length}
				<p class="mt-3 text-sm text-muted-foreground/90">
					Also accepted: {question.acceptableAnswers.join(', ')}
				</p>
			{/if}
		</div>
	{/if}

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
			<Button variant="ghost" size="sm" onclick={handleDontKnow} disabled={locked}>
				{dontKnowLabel}
			</Button>
		</div>

		<div class="ml-auto flex items-center gap-2">
			{#if showContinue}
				<Button size="lg" onclick={handleContinue}>{continueLabel}</Button>
			{:else}
				<Button size="lg" onclick={handleSubmit} disabled={!trimmedValue || locked}>
					{answerLabel}
				</Button>
			{/if}
		</div>
	</div>
</QuizQuestionCard>
