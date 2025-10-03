<script lang="ts">
        import { goto } from '$app/navigation';
        import {
                QuizProgress,
                QuizMultipleChoice,
                QuizTypeAnswer,
                QuizInfoCard
        } from '$lib/components/quiz/index.js';
        import { Button } from '$lib/components/ui/button/index.js';
        import * as Dialog from '$lib/components/ui/dialog/index.js';
        import { codeProgress } from '$lib/stores/codeProgress';
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
		seen: boolean;
	};

	let { data }: { data: PageData } = $props();
	const quiz = data.quiz;

        function createInitialAttempt(question: QuizQuestion, seen = false): AttemptState {
                return {
                        status: 'pending',
                        showHint: false,
                        locked: false,
                        selectedOptionId: null,
                        value: '',
                        showContinue: question.kind === 'info-card',
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

        let attempts = $state(
                quiz.questions.map((question, idx) => createInitialAttempt(question, idx === 0))
        );
        let currentIndex = $state(0);
        let finishDialogOpen = $state(false);
        let resultsDialogOpen = $state(false);
        let redirecting = false;
        let hasMarkedProgress = false;

        function handleFinishDialogChange(open: boolean) {
                finishDialogOpen = open;
        }

        function updateAttempt(index: number, updater: (value: AttemptState) => AttemptState) {
                attempts = attempts.map((attempt, idx) => (idx === index ? updater(attempt) : attempt));
        }

        const activeQuestion = $derived(quiz.questions[currentIndex] as QuizQuestion);
        const activeAttempt = $derived(
                attempts[currentIndex] ?? createInitialAttempt(activeQuestion, true)
        );
        const interactiveIndexes = $derived(
                quiz.questions.reduce<number[]>((accumulator, question, index) => {
                        if (question.kind !== 'info-card') {
                                accumulator.push(index);
                        }
                        return accumulator;
                }, [])
        );
        const progressSteps = $derived(
                quiz.questions.map<QuizProgressStep>((_, index) => {
                        const attempt = attempts[index];
			const label = `Question ${index + 1}`;
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

        const interactiveCount = $derived(interactiveIndexes.length);
        const correctCount = $derived(
                interactiveIndexes.filter((index) => attempts[index]?.status === 'correct').length
        );
        const incorrectCount = $derived(
                interactiveIndexes.filter((index) => attempts[index]?.status === 'incorrect').length
        );
        const skippedCount = $derived(
                interactiveIndexes.filter((index) => attempts[index]?.status === 'skipped').length
        );
        const remainingCount = $derived(
                interactiveCount - correctCount - incorrectCount - skippedCount
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

        function continueFlow() {
                if (currentIndex < quiz.questions.length - 1) {
                        currentIndex += 1;
                        return;
                }
                openResults();
        }

        function handleFinishEarly() {
                attempts = attempts.map((attempt, index) => {
                        if (attempt.status !== 'pending') {
                                return attempt;
                        }
                        const question = quiz.questions[index];
                        if (question.kind === 'info-card') {
                                return {
                                        ...attempt,
                                        status: 'correct',
                                        locked: true,
                                        showContinue: false
                                };
                        }
                        return {
                                ...attempt,
                                status: 'skipped',
                                locked: true,
                                showContinue: false
                        };
                });
                finishDialogOpen = false;
                currentIndex = Math.min(currentIndex, quiz.questions.length - 1);
                openResults();
        }

        function resetQuiz() {
                attempts = quiz.questions.map((question, idx) => createInitialAttempt(question, idx === 0));
                currentIndex = 0;
                finishDialogOpen = false;
                resultsDialogOpen = false;
                redirecting = false;
                hasMarkedProgress = false;
        }

        // Mark the current question as seen whenever it becomes active
        $effect(() => {
                const attempt = attempts[currentIndex];
                if (attempt && !attempt.seen) {
                        updateAttempt(currentIndex, (prev) => ({ ...prev, seen: true }));
                }
        });

        function handleInfoCardContinue() {
                updateAttempt(currentIndex, (prev) => ({
                        ...prev,
                        status: 'correct',
                        locked: true,
                        showContinue: false
                }));
                continueFlow();
        }

        function openResults() {
                finishDialogOpen = false;
                resultsDialogOpen = true;
                if (!hasMarkedProgress && quiz.progressKey) {
                        codeProgress.markComplete(quiz.progressKey);
                        hasMarkedProgress = true;
                }
        }

        function handleResultsDialogChange(open: boolean) {
                resultsDialogOpen = open;
                if (!open) {
                        returnToPlan();
                }
        }

        function returnToPlan() {
                if (redirecting) {
                        return;
                }
                redirecting = true;
                resultsDialogOpen = false;
                void goto('/code');
        }

        const continueLabel = $derived(() => {
                if (currentIndex === quiz.questions.length - 1) {
                        return 'Done';
                }
                if (activeQuestion.kind === 'info-card') {
                        return activeQuestion.actionLabel ?? 'Next';
                }
                return 'Next question';
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
                                continueLabel={continueLabel}
                                on:select={(event) => handleOptionSelect(event.detail.optionId)}
                                on:submit={(event) => handleMultipleSubmit(event.detail.optionId)}
                                on:requestHint={handleHint}
                                on:dontKnow={handleDontKnow}
                                on:continue={continueFlow}
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
                                continueLabel={continueLabel}
                                on:input={(event) => handleTypeInput(event.detail.value)}
                                on:submit={(event) => handleTypeSubmit(event.detail.value)}
                                on:requestHint={handleHint}
                                on:dontKnow={handleDontKnow}
                                on:continue={continueFlow}
                        />
                {:else if activeQuestion.kind === 'info-card'}
                        <QuizInfoCard
                                question={activeQuestion}
                                continueLabel={continueLabel}
                                on:continue={handleInfoCardContinue}
                        />
                {/if}
        </section>
</div>

<Dialog.Root open={finishDialogOpen} onOpenChange={handleFinishDialogChange}>
	<Dialog.Content
		class="finish-dialog bg-background/98 max-w-lg overflow-hidden rounded-3xl p-0 shadow-[0_35px_90px_-40px_rgba(15,23,42,0.45)] dark:shadow-[0_35px_90px_-40px_rgba(2,6,23,0.75)]"
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
		<div class="finish-footer flex flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-end">
			<Button variant="outline" class="w-full sm:w-auto sm:min-w-[9rem]" onclick={resetQuiz}
				>Restart quiz</Button
			>
			<Button class="finish-cancel w-full sm:w-auto sm:min-w-[9rem]" onclick={() => (finishDialogOpen = false)}>
				Keep practicing
			</Button>
			<Button class="finish-continue w-full sm:w-auto sm:min-w-[9rem]" onclick={handleFinishEarly}
				>Finish now</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={resultsDialogOpen} onOpenChange={handleResultsDialogChange}>
        <Dialog.Content
                class="bg-background/98 max-w-lg overflow-hidden rounded-3xl p-0 shadow-[0_35px_90px_-40px_rgba(15,23,42,0.45)] dark:shadow-[0_35px_90px_-40px_rgba(2,6,23,0.75)]"
        >
                <div class="space-y-3 border-b border-border/60 bg-gradient-to-br from-primary/10 via-background to-background px-6 py-6">
                        <h2 class="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                                {interactiveCount > 0 ? 'Quiz complete' : 'Deck complete'}
                        </h2>
                        <p class="text-sm leading-relaxed text-muted-foreground">
                                {#if interactiveCount > 0}
                                        You answered {correctCount} of {interactiveCount} check-ins correctly.
                                {:else}
                                        Nice! You worked through every card in the deck.
                                {/if}
                        </p>
                </div>
                <div class="flex flex-col gap-4 px-6 py-6">
                        <div class="flex flex-wrap gap-3 text-sm font-semibold">
                                <span
                                        class="inline-flex items-center rounded-full bg-emerald-100/80 px-3 py-1 text-emerald-700 shadow-sm dark:bg-emerald-500/20 dark:text-emerald-100"
                                >
                                        Correct · {correctCount}
                                </span>
                                {#if incorrectCount > 0}
                                        <span
                                                class="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-amber-700 shadow-sm dark:bg-amber-500/20 dark:text-amber-100"
                                        >
                                                Incorrect · {incorrectCount}
                                        </span>
                                {/if}
                                {#if skippedCount > 0}
                                        <span
                                                class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-slate-600 shadow-sm dark:bg-slate-500/20 dark:text-slate-200"
                                        >
                                                Skipped · {skippedCount}
                                        </span>
                                {/if}
                                <span
                                        class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-primary shadow-sm dark:bg-primary/20 dark:text-primary-100"
                                >
                                        Cards · {quiz.questions.length}
                                </span>
                        </div>
                        <div class="flex justify-end">
                                <Button size="lg" onclick={returnToPlan}>Done · back to plan</Button>
                        </div>
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
