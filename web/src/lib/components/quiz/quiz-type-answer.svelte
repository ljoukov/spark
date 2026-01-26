<script lang="ts">
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { QuizFeedback, QuizTypeAnswerQuestion } from '$lib/types/quiz';

	type Status = 'neutral' | 'correct' | 'incorrect';
	type BusyAction = 'submit' | 'dontKnow' | 'continue';

	type Props = {
		question: QuizTypeAnswerQuestion;
		value?: string;
		status?: Status;
		showHint?: boolean;
		locked?: boolean;
		feedback?: QuizFeedback | null;
		score?: { awarded: number; max: number } | null;
		showExplanation?: boolean;
		showContinue?: boolean;
		answerLabel?: string;
		continueLabel?: string;
		hintLabel?: string;
		dontKnowLabel?: string;
		placeholder?: string;
		eyebrow?: string | null;
		busy?: boolean;
		busyAction?: BusyAction | null;
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
		score = null,
		showExplanation: showExplanationProp = undefined,
		showContinue = false,
		answerLabel = 'Submit',
		continueLabel = 'Continue',
		hintLabel = 'Show hint',
		dontKnowLabel = "Don't know?",
		placeholder = question.placeholder ?? 'Type your answer',
		eyebrow = undefined,
		busy = false,
		busyAction = null,
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
	const isSubmitBusy = $derived(busy && busyAction === 'submit');
	const isDontKnowBusy = $derived(busy && busyAction === 'dontKnow');
	const isContinueBusy = $derived(busy && busyAction === 'continue');
	const inputDisabled = $derived(locked || busy);
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
		<div class="flex items-center justify-between gap-3">
			<p class="text-sm font-medium tracking-[0.18em] text-muted-foreground/80 uppercase">
				Your answer
			</p>
				{#if score && Number.isFinite(score.awarded) && Number.isFinite(score.max)}
					<span class="text-xs font-semibold tracking-[0.2em] text-muted-foreground/70 uppercase">
						Score: {score.awarded}/{score.max}
					</span>
			{:else if question.marks}
				<span class="text-xs font-semibold tracking-[0.2em] text-muted-foreground/70 uppercase">
					{question.marks} mark{question.marks === 1 ? '' : 's'}
				</span>
			{/if}
		</div>
		<Input
			class="h-12 w-full rounded-2xl border-2 border-input bg-background px-4 text-base shadow-sm transition-colors focus-visible:border-ring"
			type="text"
			bind:value
			oninput={handleInput}
			onkeydown={handleKeyDown}
			disabled={inputDisabled}
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
				{#if question.answerHtml}
					<span class="markdown">{@html question.answerHtml}</span>
				{:else}
					{question.answer}
				{/if}
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
					<Button size="lg" onclick={handleSubmit} disabled={!trimmedValue || inputDisabled}>
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
