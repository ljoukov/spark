<script lang="ts">
	import QuizQuestionCard from './quiz-question-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { QuizFeedback, QuizTypeAnswerQuestion } from '$lib/types/quiz';
	import { ChatInput } from '$lib/components/chat/index.js';

	type Status = 'neutral' | 'correct' | 'incorrect';
	type BusyAction = 'submit' | 'dontKnow' | 'continue';

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
		busy?: boolean;
		busyAction?: BusyAction | null;
		thinkingText?: string | null;
		submitPhase?: 'submitting' | 'grading';
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
		busy = false,
		busyAction = null,
		thinkingText = null,
		submitPhase: submitPhaseProp = 'submitting',
		onInput = undefined,
		onSubmit = undefined,
		onRequestHint = undefined,
		onDontKnow = undefined,
		onContinue = undefined
	}: Props = $props();

	const MAX_LINES = 7;
	const MAX_CHARS = 1000;

	function handleSubmit() {
		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}
		onSubmit?.({ value: trimmed });
	}

	function handleSubmitFromInput(detail: { value: string }) {
		value = detail.value;
		handleSubmit();
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
	const trimmedValue = $derived(value.trim());
	const isSubmitBusy = $derived(busy && busyAction === 'submit');
	const isDontKnowBusy = $derived(busy && busyAction === 'dontKnow');
	const isContinueBusy = $derived(busy && busyAction === 'continue');
	const inputDisabled = $derived(locked || busy);
	const submitPhase = $derived(submitPhaseProp ?? 'submitting');
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
	showExplanation={revealExplanation}
>
	<div class="space-y-3">
		{#if question.marks}
			<p class="text-xs font-semibold tracking-[0.2em] text-muted-foreground/70 uppercase">
				{question.marks} mark{question.marks === 1 ? '' : 's'}
			</p>
		{/if}
		<ChatInput
			bind:value
			disabled={inputDisabled}
			{placeholder}
			ariaLabel="Answer"
			maxLines={MAX_LINES}
			maxChars={MAX_CHARS}
			onInput={(detail) => onInput?.(detail)}
			onSubmit={handleSubmitFromInput}
		/>
	</div>

	{#if thinkingText}
		<div
			class="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-primary/90"
		>
			<p class="text-[0.65rem] font-semibold tracking-[0.22em] text-primary/70 uppercase">
				Thinking
			</p>
			<div
				class="mt-1 h-[5.25rem] overflow-hidden text-xs leading-5 whitespace-pre-wrap text-foreground/80"
			>
				{thinkingText}
			</div>
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
							<span>{submitPhase === 'submitting' ? 'Submitting…' : 'Grading…'}</span>
						{:else}
							{answerLabel}
						{/if}
					</Button>
				{/if}
			</div>
		</div>
	{/snippet}
</QuizQuestionCard>
