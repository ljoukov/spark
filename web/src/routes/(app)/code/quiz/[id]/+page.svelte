<script lang="ts">
	import {
		QuizProgress,
		QuizMultipleChoice,
		QuizTypeAnswer,
		QuizInfoCard
	} from '$lib/components/quiz/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { QuizFeedback, QuizProgressStep, QuizQuestion } from '$lib/types/quiz';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';

	type AttemptStatus = 'pending' | 'correct' | 'incorrect' | 'skipped';

	type AttemptState = {
		status: AttemptStatus;
		showHint: boolean;
		locked: boolean;
		selectedOptionId: string | null;
		value: string;
		showContinue: boolean;
		feedback: QuizFeedback | null;
		seen: boolean;
	};

	let { data }: { data: PageData } = $props();
	const quiz = data.quiz;

	function createInitialAttempt(seen = false): AttemptState {
		return {
			status: 'pending',
			showHint: false,
			locked: false,
			selectedOptionId: null,
			value: '',
			showContinue: false,
			feedback: null,
			seen
		};
	}

	function toCardStatus(status: AttemptStatus): 'neutral' | 'correct' | 'incorrect' {
		if (status === 'correct') {
			return 'correct';
		}
		if (status === 'incorrect' || status === 'skipped') {
			return 'incorrect';
		}
		return 'neutral';
	}

	const STORAGE_KEY = 'spark-code-progress';
	let attempts = $state(quiz.questions.map((_, idx) => createInitialAttempt(idx === 0)));
	let currentIndex = $state(0);
	let finishDialogOpen = $state(false);
	let progressPersisted = false;

	function handleFinishDialogChange(open: boolean) {
		finishDialogOpen = open;
	}

	function updateAttempt(index: number, updater: (value: AttemptState) => AttemptState) {
		attempts = attempts.map((attempt, idx) => (idx === index ? updater(attempt) : attempt));
	}

	const activeQuestion = $derived(quiz.questions[currentIndex] as QuizQuestion);
	const activeAttempt = $derived(attempts[currentIndex] ?? createInitialAttempt());
	const isLastQuestion = $derived(currentIndex === quiz.questions.length - 1);
	const continueLabel = $derived(isLastQuestion ? 'Done' : 'Continue');
	const progressSteps = $derived(
		quiz.questions.map<QuizProgressStep>((question, index) => {
			const attempt = attempts[index];
			const label = question.kind === 'info-card' ? `Step ${index + 1}` : `Question ${index + 1}`;
			if (!attempt || attempt.status === 'pending') {
				return {
					status: index === currentIndex ? 'active' : attempt?.seen ? 'seen' : 'pending',
					label
				};
			}
			if (attempt.status === 'skipped') {
				return { status: 'skipped', label };
			}
			return {
				status: attempt.status === 'correct' ? 'correct' : 'incorrect',
				label
			};
		})
	);

	const scoredAttempts = $derived(
		quiz.questions
			.map((question, index) => ({ question, attempt: attempts[index] }))
			.filter(
				(
					entry
				): entry is {
					question: QuizQuestion;
					attempt: AttemptState;
				} => entry.question.kind !== 'info-card'
			)
	);

	const isQuizComplete = $derived(attempts.every((attempt) => attempt.status !== 'pending'));
	const remainingCount = $derived(
		scoredAttempts.filter((entry) => entry.attempt.status === 'pending').length
	);

	function goToQuestion(index: number) {
		if (index < 0 || index >= quiz.questions.length || index === currentIndex) {
			return;
		}
		const target = attempts[index];
		if (target && (target.status !== 'pending' || target.seen)) {
			currentIndex = index;
		}
	}

	function handleOptionSelect(optionId: string) {
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (prev) => ({ ...prev, selectedOptionId: optionId }));
	}

	function handleMultipleSubmit(optionId: string) {
		const question = quiz.questions[currentIndex];
		if (question.kind !== 'multiple-choice') {
			return;
		}

		const correctOption = question.options.find((option) => option.id === question.correctOptionId);
		const isCorrect = optionId === question.correctOptionId;

		updateAttempt(currentIndex, (prev) => ({
			...prev,
			status: isCorrect ? 'correct' : 'incorrect',
			locked: true,
			selectedOptionId: optionId,
			showContinue: true,
			feedback: isCorrect
				? {
						heading: 'Nice work',
						message: 'That matches the DP condition we rely on here.'
					}
				: {
						heading: "Let's review",
						message: `We were looking for option ${correctOption?.label ?? '…'}. Check the explanation below and try the next one.`
					}
		}));
	}

	function handleHint() {
		updateAttempt(currentIndex, (prev) => ({ ...prev, showHint: true }));
	}

	function handleDontKnow() {
		const question = quiz.questions[currentIndex];

		if (question.kind === 'multiple-choice') {
			const correctOption = question.options.find(
				(option) => option.id === question.correctOptionId
			);
			updateAttempt(currentIndex, (prev) => ({
				...prev,
				status: 'incorrect',
				locked: true,
				showContinue: true,
				feedback: {
					heading: 'No worries',
					message: `Study option ${correctOption?.label ?? '…'} and the explanation below, then keep going.`
				}
			}));
			return;
		}

		updateAttempt(currentIndex, (prev) => ({
			...prev,
			status: 'incorrect',
			locked: true,
			showContinue: true,
			feedback: {
				heading: 'No worries',
				message: 'Read the explanation and keep the momentum going.'
			}
		}));
	}

	function handleTypeInput(value: string) {
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (prev) => ({ ...prev, value }));
	}

	function handleTypeSubmit(value: string) {
		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}
		const question = quiz.questions[currentIndex];
		if (question.kind !== 'type-answer') {
			return;
		}

		const accepted = [question.answer, ...(question.acceptableAnswers ?? [])].map((entry) =>
			entry.trim().toLowerCase()
		);
		const isCorrect = accepted.includes(trimmed.toLowerCase());

		updateAttempt(currentIndex, (prev) => ({
			...prev,
			value: trimmed,
			status: isCorrect ? 'correct' : 'incorrect',
			locked: true,
			showContinue: true,
			feedback: isCorrect
				? {
						heading: 'Great answer',
						message: 'Your reasoning lines up with the model solution.'
					}
				: {
						heading: "Here's the catch",
						message: `The answer we needed appears below—study it and move forward.`
					}
		}));
	}

	function handleInfoContinue() {
		const question = quiz.questions[currentIndex];
		if (question.kind !== 'info-card') {
			return;
		}

		updateAttempt(currentIndex, (prev) => ({
			...prev,
			status: 'correct',
			locked: true,
			showContinue: false,
			feedback: null
		}));

		advanceFlow();
	}

	function advanceFlow() {
		if (currentIndex < quiz.questions.length - 1) {
			currentIndex += 1;
			return;
		}

		if (typeof window !== 'undefined') {
			goto('/code');
		}
	}

	function handleAdvanceFromAttempt() {
		updateAttempt(currentIndex, (prev) => ({ ...prev, showContinue: false }));
		advanceFlow();
	}

	function handleFinishEarly() {
		attempts = attempts.map((attempt) =>
			attempt.status === 'pending'
				? {
						...attempt,
						status: 'skipped',
						locked: true,
						showContinue: false
					}
				: attempt
		);
		finishDialogOpen = false;
		currentIndex = Math.min(currentIndex, quiz.questions.length - 1);
		if (typeof window !== 'undefined') {
			goto('/code');
		}
	}

	function resetQuiz() {
		attempts = quiz.questions.map((_, idx) => createInitialAttempt(idx === 0));
		currentIndex = 0;
		finishDialogOpen = false;
		progressPersisted = false;
	}

	// Mark the current question as seen whenever it becomes active
	$effect(() => {
		const attempt = attempts[currentIndex];
		if (attempt && !attempt.seen) {
			updateAttempt(currentIndex, (prev) => ({ ...prev, seen: true }));
		}
	});

	$effect(() => {
		if (!isQuizComplete) {
			return;
		}

		if (quiz.progressKey && !progressPersisted && typeof window !== 'undefined') {
			try {
				const raw = window.sessionStorage.getItem(STORAGE_KEY);
				const parsed: unknown = raw ? JSON.parse(raw) : [];
				const existing = Array.isArray(parsed) ? parsed : [];
				const next = new Set<string>(existing);
				next.add(quiz.progressKey);
				window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
				progressPersisted = true;
			} catch (error) {
				console.error('Unable to persist quiz progress', error);
			}
		}
	});
</script>

<svelte:head>
	<title>{quiz.title} · Spark Quiz</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-4 md:py-4">
	<QuizProgress
		steps={progressSteps}
		{currentIndex}
		total={quiz.questions.length}
		on:navigate={(event) => goToQuestion(event.detail.index)}
		on:finish={() => (finishDialogOpen = true)}
	/>

	<section class="flex flex-col gap-6">
		{#if activeQuestion.kind === 'multiple-choice'}
			<QuizMultipleChoice
				question={activeQuestion}
				eyebrow={quiz.topic ?? null}
				selectedOptionId={activeAttempt.selectedOptionId}
				status={toCardStatus(activeAttempt.status)}
				showHint={activeAttempt.showHint}
				locked={activeAttempt.locked}
				feedback={activeAttempt.feedback}
				showContinue={activeAttempt.showContinue}
				{continueLabel}
				on:select={(event) => handleOptionSelect(event.detail.optionId)}
				on:submit={(event) => handleMultipleSubmit(event.detail.optionId)}
				on:requestHint={handleHint}
				on:dontKnow={handleDontKnow}
				on:continue={handleAdvanceFromAttempt}
			/>
		{:else if activeQuestion.kind === 'type-answer'}
			<QuizTypeAnswer
				question={activeQuestion}
				eyebrow={quiz.topic ?? null}
				value={activeAttempt.value}
				status={toCardStatus(activeAttempt.status)}
				showHint={activeAttempt.showHint}
				locked={activeAttempt.locked}
				feedback={activeAttempt.feedback}
				showContinue={activeAttempt.showContinue}
				{continueLabel}
				on:input={(event) => handleTypeInput(event.detail.value)}
				on:submit={(event) => handleTypeSubmit(event.detail.value)}
				on:requestHint={handleHint}
				on:dontKnow={handleDontKnow}
				on:continue={handleAdvanceFromAttempt}
			/>
		{:else if activeQuestion.kind === 'info-card'}
			<QuizInfoCard
				question={activeQuestion}
				status={toCardStatus(activeAttempt.status)}
				{continueLabel}
				on:continue={handleInfoContinue}
			/>
		{/if}
	</section>
</div>

<Dialog.Root open={finishDialogOpen} onOpenChange={handleFinishDialogChange}>
	<Dialog.Content
		class="finish-dialog max-w-lg overflow-hidden rounded-3xl bg-background/98 p-0 shadow-[0_35px_90px_-40px_rgba(15,23,42,0.45)] dark:shadow-[0_35px_90px_-40px_rgba(2,6,23,0.75)]"
	>
		<div
			class="space-y-3 border-b border-border/60 bg-gradient-to-br from-primary/15 via-background to-background px-6 py-6 dark:from-primary/12"
		>
			<h2 class="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
				Wrap up this quiz?
			</h2>
			<p class="text-sm leading-relaxed text-muted-foreground">
				You still have {remainingCount} unanswered question(s). Choose what you would like to do next.
			</p>
		</div>
		<div
			class="finish-footer flex flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-end"
		>
			<Button variant="outline" class="w-full sm:w-auto sm:min-w-[9rem]" onclick={resetQuiz}
				>Restart quiz</Button
			>
			<Button
				class="finish-cancel w-full sm:w-auto sm:min-w-[9rem]"
				onclick={() => (finishDialogOpen = false)}
			>
				Keep practicing
			</Button>
			<Button class="finish-continue w-full sm:w-auto sm:min-w-[9rem]" onclick={handleFinishEarly}
				>Finish now</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	/* Dialog container: strong, theme-aware border for clarity */
	:global(.finish-dialog) {
		--finish-border: rgba(15, 23, 42, 0.18);
		border-radius: 1.5rem;
		background: color-mix(in srgb, hsl(var(--background)) 98%, transparent 2%);
		/* crisp outer ring + soft elevation */
		box-shadow:
			0 0 0 1px var(--finish-border),
			0 35px 90px -40px rgba(15, 23, 42, 0.45);
	}

	/* Dark theme border contrast */
	:global([data-theme='dark'] .finish-dialog) {
		--finish-border: rgba(148, 163, 184, 0.38);
		box-shadow:
			0 0 0 1px var(--finish-border),
			0 35px 90px -40px rgba(2, 6, 23, 0.75);
	}

	:global(.finish-cancel) {
		background: #0284c7 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(14, 165, 233, 0.35);
	}

	:global(.finish-cancel:hover) {
		background: #0ea5e9 !important;
	}

	:global(.finish-continue) {
		background: #f97316 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(251, 146, 60, 0.35);
	}

	:global(.finish-continue:hover) {
		background: #fb923c !important;
	}

	@media (min-width: 40rem) {
		:global(.finish-footer) {
			flex-direction: row;
			align-items: center;
		}
	}
</style>
