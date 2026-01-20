<script lang="ts">
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { QuizFeedback, QuizTypeAnswerQuestion } from '$lib/types/quiz';

	type Status = 'neutral' | 'correct' | 'incorrect';

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
		onInput?: (detail: { value: string }) => void;
		onSubmit?: (detail: { value: string }) => void;
		onRequestHint?: () => void;
		onDontKnow?: () => void;
		onContinue?: () => void;
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
		eyebrow = undefined,
		onInput = undefined,
		onSubmit = undefined,
		onRequestHint = undefined,
		onDontKnow = undefined,
		onContinue = undefined
	}: Props = $props();

	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		value = target.value;
		onInput?.({ value });
	}

	function handleSubmit() {
		if (!value.trim()) {
			return;
		}
		onSubmit?.({ value: value.trim() });
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
			Your answer
		</p>
		<Input
			class="h-12 w-full rounded-2xl border-2 border-input bg-background px-4 text-base shadow-sm transition-colors focus-visible:border-ring"
			type="text"
			bind:value
			oninput={handleInput}
			onkeydown={handleKeyDown}
			disabled={locked}
			autocomplete="off"
			spellcheck="false"
			{placeholder}
		/>
	</div>

	{#if showAnswerPanel}
		<div
			class="rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
		>
			<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground/80 uppercase">
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

	{#snippet footer()}
		<div class="flex w-full flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				{#if question.hint}
					<Button variant="ghost" size="sm" onclick={handleHint} disabled={showHint}>
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
	{/snippet}
</QuizQuestionCard>
