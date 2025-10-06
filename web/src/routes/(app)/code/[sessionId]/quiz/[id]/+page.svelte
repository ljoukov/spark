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
import { goto, invalidateAll } from '$app/navigation';
import { createSessionStateStore, type SessionUpdateOptions } from '$lib/client/sessionState';
	import type { PlanItemState, PlanItemQuizState, QuizQuestionState } from '@spark/schemas';
	import { onDestroy } from 'svelte';

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
		dontKnow: boolean;
		firstViewedAt: Date | null;
		answeredAt: Date | null;
	};

	let { data }: { data: PageData } = $props();
	const quiz = data.quiz;
	const SYNC_ERROR_MESSAGE = "We couldn't save your latest progress. Check your connection and try again.";
	const sessionStateStore = createSessionStateStore(data.sessionId, data.sessionState);
	let planItemState = $state<PlanItemState | null>(data.planItemState ?? null);
	let completionSyncError = $state<string | null>(null);
	const stopSessionState = sessionStateStore.subscribe((value) => {
		planItemState = (value.items[data.planItem.id] as PlanItemState | undefined) ?? null;
		if (planItemState?.status === 'completed') {
			completionSyncError = null;
		}
	});

	function createInitialAttempt(seen = false): AttemptState {
		return {
			status: 'pending',
			showHint: false,
			locked: false,
			selectedOptionId: null,
			value: '',
			showContinue: false,
			feedback: null,
			seen,
			dontKnow: false,
			firstViewedAt: null,
			answeredAt: null
		};
	}

	function getQuestionByIndex(index: number): QuizQuestion | null {
		return quiz.questions[index] ?? null;
	}

	function getQuestionId(index: number): string | null {
		return getQuestionByIndex(index)?.id ?? null;
	}

	function buildFeedback(
		question: QuizQuestion,
		status: AttemptStatus,
		selectedOptionId: string | null,
		dontKnow: boolean
	): QuizFeedback | null {
		const resolvedStatus: AttemptStatus = status === 'skipped' ? 'incorrect' : status;
		if (resolvedStatus === 'pending') {
			return null;
		}
		if (question.kind === 'multiple-choice') {
			if (resolvedStatus === 'correct') {
				return question.correctFeedback;
			}
			const correctOption = question.options.find((option) => option.id === question.correctOptionId);
			return {
				heading: dontKnow ? 'No worries' : "Let's review",
				message: dontKnow
					? `Study option ${correctOption?.label ?? '…'} and the explanation above, then keep going.`
					: `We were looking for option ${correctOption?.label ?? '…'}. Check the explanation above and try the next one.`
			};
		}
		if (question.kind === 'type-answer') {
			if (resolvedStatus === 'correct') {
				return question.correctFeedback;
			}
			return {
				heading: dontKnow ? 'No worries' : "Here's the catch",
				message: dontKnow
					? 'Read the explanation and keep the momentum going.'
					: 'The answer we needed appears below—study it and move forward.'
			};
		}
		return null;
	}

	function cloneQuizState(state: PlanItemState): { base: PlanItemState; quiz: PlanItemQuizState } {
		const existingQuiz = state.quiz ?? { lastQuestionIndex: undefined, questions: {}, serverCompletedAt: undefined };
		const clonedQuiz: PlanItemQuizState = {
			lastQuestionIndex: existingQuiz.lastQuestionIndex,
			questions: { ...existingQuiz.questions },
			serverCompletedAt: existingQuiz.serverCompletedAt ?? undefined
		};
		return {
			base: {
				...state,
				quiz: clonedQuiz
			},
			quiz: clonedQuiz
		};
	}

	async function persistQuizState(
		mutator: (state: PlanItemState, quizState: PlanItemQuizState) => PlanItemState,
		options?: SessionUpdateOptions
	): Promise<void> {
		try {
			await sessionStateStore.updateItem(
				data.planItem.id,
				(current) => {
					const { base, quiz } = cloneQuizState(current);
					const next = mutator(base, quiz);
					if (options?.markInProgress && next.status === 'not_started') {
						next.status = 'in_progress';
						next.startedAt = next.startedAt ?? new Date();
					}
					return next;
				},
				options
			);
		} catch (error) {
			console.error('Failed to persist quiz session state', error);
			throw error;
		}
	}

	async function persistQuestionState(
		questionId: string,
		overrides: Partial<QuizQuestionState>,
		options?: SessionUpdateOptions
	): Promise<void> {
		await persistQuizState((state, quizState) => {
			const nextQuestionState = mergeQuestionState(quizState.questions[questionId], overrides);
			quizState.questions[questionId] = nextQuestionState;
			// Keep the pointer anchored on the current question when answering/skipping,
			// so the UI shows feedback + explanation instead of jumping ahead.
			if (overrides.status && overrides.status !== 'pending') {
				quizState.lastQuestionIndex = currentIndex;
				quizState.lastQuestionId = questionId;
			}
			return state;
		}, options);
	}

	async function persistLastQuestionIndex(index: number, options?: SessionUpdateOptions): Promise<void> {
		const questionId = getQuestionId(index);
		await persistQuizState(
			(state, quizState) => {
				quizState.lastQuestionIndex = index;
				if (questionId) {
					quizState.lastQuestionId = questionId;
				} else {
					delete quizState.lastQuestionId;
				}
				return state;
			},
			options
		);
	}

	function mergeQuestionState(
		existing: QuizQuestionState | undefined,
		overrides: Partial<QuizQuestionState>
	): QuizQuestionState {
		const result: QuizQuestionState = {
			status: overrides.status ?? existing?.status ?? 'pending'
		};
		const selectedOptionId = overrides.selectedOptionId ?? existing?.selectedOptionId ?? undefined;
		if (selectedOptionId) {
			result.selectedOptionId = selectedOptionId;
		}
		const resolvedTypedValue = overrides.typedValue ?? existing?.typedValue ?? undefined;
		if (typeof resolvedTypedValue === 'string' && resolvedTypedValue.trim().length > 0) {
			result.typedValue = resolvedTypedValue.trim();
		}
		const hintUsed = overrides.hintUsed ?? existing?.hintUsed;
		if (hintUsed) {
			result.hintUsed = true;
		}
		const dontKnow = overrides.dontKnow ?? existing?.dontKnow;
		if (dontKnow) {
			result.dontKnow = true;
		}
		const firstViewedAt = overrides.firstViewedAt ?? existing?.firstViewedAt;
		if (firstViewedAt) {
			result.firstViewedAt = firstViewedAt;
		}
		const answeredAt = overrides.answeredAt ?? existing?.answeredAt;
		if (answeredAt) {
			result.answeredAt = answeredAt;
		}
		return result;
	}

	function hydrateFromPlanState(state: PlanItemState | null): void {
		if (!state?.quiz) {
			return;
		}
		const quizState = state.quiz;
		const nextAttempts = quiz.questions.map((question, index) => {
			const saved = quizState.questions[question.id];
			if (!saved) {
				return createInitialAttempt(index === 0);
			}
			const status = saved.status;
			const seen = Boolean(saved.firstViewedAt) || status !== 'pending' || index === 0;
			const locked = status !== 'pending';
			const showContinue = question.kind === 'info-card' ? false : status !== 'pending';
			const feedback = buildFeedback(
				question,
				status === 'skipped' ? 'incorrect' : status,
				saved.selectedOptionId ?? null,
				Boolean(saved.dontKnow)
			);
			return {
				status,
				showHint: Boolean(saved.hintUsed),
				locked,
				selectedOptionId: saved.selectedOptionId ?? null,
				value: saved.typedValue ?? '',
				showContinue,
				feedback,
				seen,
				dontKnow: Boolean(saved.dontKnow),
				firstViewedAt: saved.firstViewedAt ?? null,
				answeredAt: saved.answeredAt ?? null
			};
		});
		attempts = nextAttempts;
		const firstPendingIndex = nextAttempts.findIndex((attempt) => attempt.status === 'pending');
		let nextIndex = currentIndex;
		let pointerDefined = false;
		if (quizState.lastQuestionId) {
			const idMatch = quiz.questions.findIndex((question) => question.id === quizState.lastQuestionId);
			if (idMatch >= 0) {
				nextIndex = idMatch;
			}
			pointerDefined = true;
		} else if (typeof quizState.lastQuestionIndex === 'number') {
			nextIndex = Math.min(
				Math.max(quizState.lastQuestionIndex, 0),
				nextAttempts.length - 1
			);
			pointerDefined = true;
		}
		if (!pointerDefined && firstPendingIndex >= 0 && firstPendingIndex > nextIndex) {
			nextIndex = firstPendingIndex;
		}
		currentIndex = nextIndex;
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

	let attempts = $state(quiz.questions.map((_, idx) => createInitialAttempt(idx === 0)));
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
			void persistLastQuestionIndex(index, { sync: false });
		}
	}

	function handleOptionSelect(optionId: string) {
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (prev) => ({ ...prev, selectedOptionId: optionId, dontKnow: false }));
	}

	async function handleMultipleSubmit(optionId: string) {
		const question = quiz.questions[currentIndex];
		if (question.kind !== 'multiple-choice') {
			return;
		}

		const attempt = attempts[currentIndex] ?? createInitialAttempt();
		const isCorrect = optionId === question.correctOptionId;
		const status: AttemptStatus = isCorrect ? 'correct' : 'incorrect';
		const now = new Date();
		const feedback = buildFeedback(question, status, optionId, false);
		const firstViewedAt = attempt.firstViewedAt ?? now;

		updateAttempt(currentIndex, (prev) => ({
			...prev,
			status,
			locked: true,
			selectedOptionId: optionId,
			showContinue: true,
			feedback,
			dontKnow: false,
			answeredAt: now,
			firstViewedAt
		}));



		completionSyncError = null;
		try {
			await persistQuestionState(
				question.id,
				{
					status,
					selectedOptionId: optionId,
					hintUsed: attempt.showHint ? true : undefined,
					dontKnow: false,
					firstViewedAt,
					answeredAt: now
				},
				{ sync: true, markInProgress: true }
			);
		} catch (error) {
			console.error('Failed to sync multiple-choice submission', error);
			completionSyncError = SYNC_ERROR_MESSAGE;
		}
	}

	function handleHint() {
		const question = getQuestionByIndex(currentIndex);
		if (!question) {
			return;
		}
	const attempt = attempts[currentIndex] ?? createInitialAttempt();
	const now = attempt.firstViewedAt ?? new Date();
	updateAttempt(currentIndex, (prev) => ({
		...prev,
		showHint: true,
		seen: true,
		firstViewedAt: prev.firstViewedAt ?? now
	}));

	void persistQuestionState(
		question.id,
		{
			hintUsed: true,
			firstViewedAt: now
		},
		{ sync: false }
	);
}

	async function handleDontKnow() {
		const question = getQuestionByIndex(currentIndex);
		if (!question) {
			return;
		}
		const now = new Date();
		const attempt = attempts[currentIndex] ?? createInitialAttempt();
		const firstViewedAt = attempt.firstViewedAt ?? now;
		const feedback = buildFeedback(question, 'incorrect', attempt.selectedOptionId, true);
	updateAttempt(currentIndex, (prev) => ({
		...prev,
		status: 'incorrect',
		locked: true,
		showContinue: true,
		feedback,
		dontKnow: true,
		answeredAt: now,
		firstViewedAt
	}));

		completionSyncError = null;
		try {
			await persistQuestionState(
				question.id,
				{
					status: 'incorrect',
					dontKnow: true,
					selectedOptionId: question.kind === 'multiple-choice' ? attempt.selectedOptionId ?? undefined : undefined,
					firstViewedAt,
					answeredAt: now
				},
				{ sync: true, markInProgress: true }
			);
		} catch (error) {
			console.error("Failed to sync 'don't know' submission", error);
			completionSyncError = SYNC_ERROR_MESSAGE;
		}
}

	function handleTypeInput(value: string) {
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (prev) => ({ ...prev, value, dontKnow: false }));
	}

	async function handleTypeSubmit(value: string) {
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

		const attempt = attempts[currentIndex] ?? createInitialAttempt();
		const status: AttemptStatus = isCorrect ? 'correct' : 'incorrect';
		const now = new Date();
		const firstViewedAt = attempt.firstViewedAt ?? now;
		const feedback = buildFeedback(question, status, null, false);

	updateAttempt(currentIndex, (prev) => ({
		...prev,
		value: trimmed,
		status,
		locked: true,
		showContinue: true,
		feedback,
		dontKnow: false,
		answeredAt: now,
		firstViewedAt
	}));


		completionSyncError = null;
		try {
			await persistQuestionState(
				question.id,
				{
					status,
					typedValue: trimmed,
					hintUsed: attempt.showHint ? true : undefined,
					dontKnow: false,
					firstViewedAt,
					answeredAt: now
				},
				{ sync: true, markInProgress: true }
			);
		} catch (error) {
			console.error('Failed to sync typed answer submission', error);
			completionSyncError = SYNC_ERROR_MESSAGE;
		}
	}

	async function handleInfoContinue() {
		const index = currentIndex;
		const question = quiz.questions[index];
		if (question.kind !== 'info-card') {
			return;
		}
		const attempt = attempts[index] ?? createInitialAttempt();
		const now = new Date();
		const firstViewedAt = attempt.firstViewedAt ?? now;
	updateAttempt(index, (prev) => ({
		...prev,
		status: 'correct',
		locked: true,
		showContinue: false,
		feedback: null,
		dontKnow: false,
		answeredAt: now,
		firstViewedAt
	}));

		completionSyncError = null;
	try {
		await persistQuestionState(
			question.id,
			{
				status: 'correct',
				dontKnow: false,
				firstViewedAt,
				answeredAt: now
			},
			{ sync: true, markInProgress: true }
		);
	} catch (error) {
		console.error('Failed to sync info card progression', error);
		completionSyncError = SYNC_ERROR_MESSAGE;
		updateAttempt(index, (prev) => ({ ...prev, showContinue: true }));
		return;
	}

		try {
			const advanced = await advanceFlow();
			if (!advanced) {
				completionSyncError = SYNC_ERROR_MESSAGE;
				updateAttempt(index, (prev) => ({ ...prev, showContinue: true }));
			}
		} catch (error) {
			console.error('Failed to advance after info card', error);
			completionSyncError = SYNC_ERROR_MESSAGE;
			updateAttempt(index, (prev) => ({ ...prev, showContinue: true }));
		}
}

async function finalizeCompletion(mode: 'auto' | 'manual'): Promise<boolean> {
	const completedAt = new Date();
	try {
		await sessionStateStore.markStatus(
			data.planItem.id,
			'completed',
			{
				completedAt
			},
			{ quizCompletion: { quizId: quiz.id } }
		);
		completionSyncError = null;
		return true;
	} catch (error) {
		console.error('Failed to persist quiz completion state', error);
		completionSyncError = SYNC_ERROR_MESSAGE;
		return false;
	}
}

	async function advanceFlow(): Promise<boolean> {
		if (currentIndex < quiz.questions.length - 1) {
			const nextIndex = currentIndex + 1;

			await persistLastQuestionIndex(nextIndex, { sync: true });
			currentIndex = nextIndex;
			return true;
		}


		await persistLastQuestionIndex(currentIndex, { sync: true });
        const synced = await finalizeCompletion('manual');
        if (synced && typeof window !== 'undefined') {
            await invalidateAll();
            goto(`/code/${data.sessionId}`, { invalidateAll: true });
            return true;
        }
		return synced;
	}

	async function retryFinalize(): Promise<void> {
		completionSyncError = null;

    const synced = await finalizeCompletion('manual');
    if (synced && typeof window !== 'undefined') {
        await invalidateAll();
        goto(`/code/${data.sessionId}`, { invalidateAll: true });
    }
	}

	async function handleAdvanceFromAttempt() {
		const index = currentIndex;
		updateAttempt(index, (prev) => ({ ...prev, showContinue: false }));

		completionSyncError = null;
		try {
			const advanced = await advanceFlow();
			if (!advanced) {
				completionSyncError = SYNC_ERROR_MESSAGE;
				updateAttempt(index, (prev) => ({ ...prev, showContinue: true }));
			}
		} catch (error) {
			console.error('Failed to sync progression while advancing', error);
			completionSyncError = SYNC_ERROR_MESSAGE;
			updateAttempt(index, (prev) => ({ ...prev, showContinue: true }));
		}
	}

	async function handleQuit() {
		finishDialogOpen = false;

		try {
			await persistLastQuestionIndex(currentIndex, { sync: true });
		} catch (error) {
			console.error('Failed to persist progress before quitting', error);
		}
		if (typeof window !== 'undefined') {
			await invalidateAll();
			goto(`/code/${data.sessionId}`, { invalidateAll: true });
		}
	}

	function resetQuiz() {
		attempts = quiz.questions.map((_, idx) => createInitialAttempt(idx === 0));
		currentIndex = 0;
		finishDialogOpen = false;
		completionSyncError = null;
	}

	// Mark the current question as seen whenever it becomes active
	$effect(() => {
		const questionId = getQuestionId(currentIndex);
		if (!questionId) {
			return;
		}
		const attempt = attempts[currentIndex];
		if (!attempt) {
			return;
		}
		if (!attempt.seen) {
			const now = attempt.firstViewedAt ?? new Date();
			updateAttempt(currentIndex, (prev) => ({
				...prev,
				seen: true,
				firstViewedAt: prev.firstViewedAt ?? now
			}));
			if (!attempt.firstViewedAt) {
				void persistQuestionState(questionId, { firstViewedAt: now }, { sync: false });
			}
		} else if (!attempt.firstViewedAt) {
			const now = new Date();
			updateAttempt(currentIndex, (prev) => ({ ...prev, firstViewedAt: now }));
			void persistQuestionState(questionId, { firstViewedAt: now }, { sync: false });
		}
	});

	$effect(() => {
		hydrateFromPlanState(planItemState);
	});

	onDestroy(() => {
		stopSessionState();
		sessionStateStore.stop();
	});
</script>

<svelte:head>
	<title>{quiz.title} · Spark Quiz</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-4 md:py-4">
	{#if completionSyncError}
		<div class="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
			<span class="flex-1">{completionSyncError}</span>
			<Button size="sm" variant="outline" onclick={() => void retryFinalize()} class="shrink-0">
				Retry save
			</Button>
		</div>
	{/if}
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
				on:submit={(event) => void handleMultipleSubmit(event.detail.optionId)}
				on:requestHint={handleHint}
				on:dontKnow={() => void handleDontKnow()}
				on:continue={() => void handleAdvanceFromAttempt()}
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
				on:submit={(event) => void handleTypeSubmit(event.detail.value)}
				on:requestHint={handleHint}
				on:dontKnow={() => void handleDontKnow()}
				on:continue={() => void handleAdvanceFromAttempt()}
			/>
		{:else if activeQuestion.kind === 'info-card'}
			<QuizInfoCard
				question={activeQuestion}
				status={toCardStatus(activeAttempt.status)}
				{continueLabel}
				on:continue={() => void handleInfoContinue()}
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
				Take a break?
			</h2>
			<p class="text-sm leading-relaxed text-muted-foreground">
				You still have {remainingCount} unanswered {remainingCount === 1 ? 'question' : 'questions'}. Your progress is saved — hop back in whenever you're ready.
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
			<Button class="finish-continue w-full sm:w-auto sm:min-w-[9rem]" onclick={handleQuit}
				>Quit now</Button
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
