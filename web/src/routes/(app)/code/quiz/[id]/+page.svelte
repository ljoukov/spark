<script lang="ts">
	import { QuizProgress, QuizMultipleChoice, QuizTypeAnswer } from '$lib/components/quiz/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { QuizFeedback, QuizProgressStep, QuizQuestion } from '$lib/types/quiz';
	import type { PageData } from './$types';

	type AttemptStatus = 'pending' | 'correct' | 'incorrect' | 'skipped';

	type AttemptState = {
		status: AttemptStatus;
		showHint: boolean;
		locked: boolean;
		selectedOptionId: string | null;
		value: string;
		showContinue: boolean;
		feedback: QuizFeedback | null;
	};

	let { data }: { data: PageData } = $props();
	const quiz = data.quiz;

	function createInitialAttempt(): AttemptState {
		return {
			status: 'pending',
			showHint: false,
			locked: false,
			selectedOptionId: null,
			value: '',
			showContinue: false,
			feedback: null
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

	let attempts = $state(quiz.questions.map(createInitialAttempt));
	let currentIndex = $state(0);
	let finishDialogOpen = $state(false);

	function handleFinishDialogChange(open: boolean) {
		finishDialogOpen = open;
	}

	function updateAttempt(index: number, updater: (value: AttemptState) => AttemptState) {
		attempts = attempts.map((attempt, idx) => (idx === index ? updater(attempt) : attempt));
	}

	const activeQuestion = $derived(quiz.questions[currentIndex] as QuizQuestion);
	const activeAttempt = $derived(attempts[currentIndex] ?? createInitialAttempt());
	const progressSteps = $derived(
		quiz.questions.map<QuizProgressStep>((_, index) => {
			const attempt = attempts[index];
			const label = `Question ${index + 1}`;
			if (!attempt || attempt.status === 'pending') {
				return {
					status: index === currentIndex ? 'active' : 'pending',
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

	const isQuizComplete = $derived(attempts.every((attempt) => attempt.status !== 'pending'));
	const correctCount = $derived(attempts.filter((attempt) => attempt.status === 'correct').length);
	const incorrectCount = $derived(
		attempts.filter((attempt) => attempt.status === 'incorrect').length
	);
	const skippedCount = $derived(attempts.filter((attempt) => attempt.status === 'skipped').length);
	const remainingCount = $derived(
		quiz.questions.length - correctCount - incorrectCount - skippedCount
	);

	function goToQuestion(index: number) {
		if (index >= 0 && index < currentIndex) {
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

	function goToNextQuestion() {
		if (currentIndex < quiz.questions.length - 1) {
			currentIndex += 1;
		}
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
	}

	function resetQuiz() {
		attempts = quiz.questions.map(createInitialAttempt);
		currentIndex = 0;
		finishDialogOpen = false;
	}
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
				on:select={(event) => handleOptionSelect(event.detail.optionId)}
				on:submit={(event) => handleMultipleSubmit(event.detail.optionId)}
				on:requestHint={handleHint}
				on:dontKnow={handleDontKnow}
				on:continue={goToNextQuestion}
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
				on:input={(event) => handleTypeInput(event.detail.value)}
				on:submit={(event) => handleTypeSubmit(event.detail.value)}
				on:requestHint={handleHint}
				on:dontKnow={handleDontKnow}
				on:continue={goToNextQuestion}
			/>
		{/if}
	</section>

	{#if isQuizComplete}
		<section
			class="space-y-4 rounded-3xl border border-emerald-200/60 bg-emerald-50/70 p-6 text-emerald-900 shadow-[0_24px_60px_-40px_rgba(16,185,129,0.45)] dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100"
		>
			<h2 class="text-2xl font-semibold">Quiz complete</h2>
			<p class="text-base leading-relaxed">
				You answered {correctCount} of {quiz.questions.length} questions correctly.
			</p>
			<div class="flex flex-wrap gap-3 text-sm font-semibold">
				<span
					class="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-emerald-700 shadow-sm dark:bg-emerald-400/10 dark:text-emerald-100"
				>
					Correct · {correctCount}
				</span>
				<span
					class="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-amber-700 shadow-sm dark:bg-amber-500/20 dark:text-amber-100"
				>
					Incorrect · {incorrectCount}
				</span>
				{#if skippedCount > 0}
					<span
						class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-slate-600 shadow-sm dark:bg-slate-500/20 dark:text-slate-200"
					>
						Skipped · {skippedCount}
					</span>
				{/if}
			</div>
		</section>
	{/if}
</div>

<Dialog.Root open={finishDialogOpen} onOpenChange={handleFinishDialogChange}>
	<Dialog.Content
		class="finish-dialog border-border/60 bg-background/98 max-w-lg overflow-hidden rounded-3xl border p-0 shadow-[0_35px_90px_-40px_rgba(15,23,42,0.45)] dark:shadow-[0_35px_90px_-40px_rgba(2,6,23,0.75)]"
	>
		<div
			class="border-border/60 from-primary/15 via-background to-background dark:from-primary/12 space-y-3 border-b bg-gradient-to-br px-6 py-6"
		>
			<h2 class="text-foreground text-xl font-semibold tracking-tight md:text-2xl">
				Wrap up this quiz?
			</h2>
			<p class="text-muted-foreground text-sm leading-relaxed">
				You still have {remainingCount} unanswered question(s). Choose what you would like to do next.
			</p>
		</div>
		<div class="flex flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-end">
			<Button variant="outline" class="sm:min-w-[9rem]" onclick={resetQuiz}>Restart quiz</Button>
			<Button
				variant="ghost"
				class="text-muted-foreground hover:text-foreground sm:min-w-[9rem]"
				onclick={() => (finishDialogOpen = false)}
			>
				Keep practicing
			</Button>
			<Button class="sm:min-w-[9rem]" onclick={handleFinishEarly}>Finish now</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
