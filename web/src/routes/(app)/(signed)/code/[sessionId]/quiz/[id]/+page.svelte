<script lang="ts">
	import {
		QuizProgress,
		QuizMultipleChoice,
		QuizTypeAnswer,
		QuizInfoCard
	} from '$lib/components/quiz/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import TakeBreakDialogContent from '$lib/components/dialog/take-break-dialog-content.svelte';
	import type { QuizFeedback, QuizProgressStep, QuizQuestion } from '$lib/types/quiz';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { createSessionStateStore, type SessionUpdateOptions } from '$lib/client/sessionState';
	import { streamSse } from '$lib/client/sse';
	import { renderMarkdownOptional } from '$lib/markdown';
	import type { PlanItemState, PlanItemQuizState, QuizQuestionState } from '@spark/schemas';
	import { z } from 'zod';

	type AttemptStatus = 'pending' | 'correct' | 'incorrect' | 'skipped';

	type AttemptState = {
		status: AttemptStatus;
		showHint: boolean;
		locked: boolean;
		selectedOptionId: string | null;
		value: string;
		showContinue: boolean;
		feedback: QuizFeedback | null;
		grade: QuizQuestionState['grade'] | null;
		gradingError: boolean;
		streamingThoughts: string;
		submitPhase: 'submitting' | 'grading' | null;
		seen: boolean;
		dontKnow: boolean;
		firstViewedAt: Date | null;
		answeredAt: Date | null;
	};

	type FinishState = 'confirm' | 'saving';

	const typeAnswerGradeResponseSchema = z.object({
		status: z.literal('ok'),
		result: z.enum(['correct', 'partial', 'incorrect']),
		awardedMarks: z.number().int().nonnegative(),
		maxMarks: z.number().int().positive(),
		feedback: z.string().min(1),
		feedbackHtml: z.string().optional()
	});

	type TypeAnswerGradeResponse = z.infer<typeof typeAnswerGradeResponseSchema>;

	const props = $props<{ data: PageData }>();
	const data = $derived(props.data);
	const quiz = $derived(data.quiz);
	const sessionId = $derived(data.sessionId);
	const planItemId = $derived(data.planItem.id);
	const sessionState = $derived(data.sessionState);
	const planItemStateData = $derived(data.planItemState);
	const gradeFeedbackHtml = $derived(data.gradeFeedbackHtml);
	const quizId = $derived(data.quiz.id);
	const SYNC_ERROR_MESSAGE =
		"We couldn't save your latest progress. Check your connection and try again.";
	let sessionStateStore: ReturnType<typeof createSessionStateStore> | null = null;
	let planItemState = $state<PlanItemState | null>(null);
	let completionSyncError = $state<string | null>(null);
	let pendingAction = $state<'submit' | 'dontKnow' | 'continue' | null>(null);
	let gradeFeedbackHtmlByQuestionId = $state<Record<string, string>>({});

	$effect(() => {
		const store = createSessionStateStore(sessionId, sessionState);
		sessionStateStore = store;
		planItemState = planItemStateData ?? null;
		gradeFeedbackHtmlByQuestionId = gradeFeedbackHtml ?? {};
		completionSyncError = null;
		const stop = store.subscribe((value) => {
			const nextPlanItemState = (value.items[planItemId] as PlanItemState | undefined) ?? null;
			planItemState = nextPlanItemState;
			if (nextPlanItemState?.status === 'completed') {
				completionSyncError = null;
			}
		});
		return () => {
			stop();
			store.stop();
			sessionStateStore = null;
		};
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
			grade: null,
			gradingError: false,
			streamingThoughts: '',
			submitPhase: null,
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
			const correctOption = question.options.find(
				(option) => option.id === question.correctOptionId
			);
			return {
				heading: dontKnow ? 'No worries' : "Let's review",
				message: dontKnow
					? `Study option ${correctOption?.label ?? '…'} and the explanation above, then keep going.`
					: `We were looking for option ${correctOption?.label ?? '…'}. Check the explanation above and try the next one.`
			};
		}
		if (question.kind === 'type-answer') {
			return null;
		}
		return null;
	}

	function buildGradeFeedback(
		grade: NonNullable<QuizQuestionState['grade']>,
		messageHtml?: string
	): QuizFeedback {
		return {
			message: grade.feedback,
			messageHtml,
			tone: grade.tone
		};
	}

	function buildGradeState(response: TypeAnswerGradeResponse): QuizQuestionState['grade'] {
		const tone: QuizFeedback['tone'] =
			response.result === 'correct'
				? 'success'
				: response.result === 'partial'
					? 'info'
					: 'warning';
		return {
			awardedMarks: response.awardedMarks,
			maxMarks: response.maxMarks,
			feedback: response.feedback,
			tone
		};
	}

	function supportsServerGrading(question: QuizQuestion): boolean {
		if (question.kind !== 'type-answer') {
			return false;
		}
		if (typeof question.marks !== 'number' || !Number.isFinite(question.marks)) {
			return false;
		}
		return true;
	}

	async function requestTypeAnswerGradeStream(
		questionId: string,
		answer: string,
		onThoughtDelta: (delta: string) => void,
		onTextDelta: (delta: string) => void
	): Promise<TypeAnswerGradeResponse> {
		let result: TypeAnswerGradeResponse | null = null;
		await streamSse(
			`/api/code/${sessionId}/quiz/${quizId}/grade`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					questionId,
					answer
				})
			},
			{
				onEvent: (event) => {
					if (event.event === 'thought') {
						onThoughtDelta(event.data);
						return;
					}
					if (event.event === 'text') {
						onTextDelta(event.data);
						return;
					}
					if (event.event === 'done') {
						const parsed = typeAnswerGradeResponseSchema.parse(JSON.parse(event.data));
						result = parsed;
						return;
					}
					if (event.event === 'error') {
						let message = 'Unable to grade this response right now';
						try {
							const payload = JSON.parse(event.data) as { message?: string };
							if (payload?.message) {
								message = payload.message;
							}
						} catch {
							// ignore
						}
						throw new Error(message);
					}
				}
			}
		);
		if (!result) {
			throw new Error('Grade stream closed without a result');
		}
		return result;
	}

	function cloneQuizState(state: PlanItemState): { base: PlanItemState; quiz: PlanItemQuizState } {
		const existingQuiz = state.quiz ?? {
			lastQuestionIndex: undefined,
			questions: {},
			serverCompletedAt: undefined
		};
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
		if (!sessionStateStore) {
			throw new Error('Quiz session state is not ready yet.');
		}
		try {
			await sessionStateStore.updateItem(
				planItemId,
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

	async function persistLastQuestionIndex(
		index: number,
		options?: SessionUpdateOptions
	): Promise<void> {
		const questionId = getQuestionId(index);
		await persistQuizState((state, quizState) => {
			quizState.lastQuestionIndex = index;
			if (questionId) {
				quizState.lastQuestionId = questionId;
			} else {
				delete quizState.lastQuestionId;
			}
			return state;
		}, options);
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
		const grade = overrides.grade ?? existing?.grade;
		if (grade) {
			result.grade = grade;
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
			const gradeFeedback =
				question.kind === 'type-answer' && saved.grade
					? buildGradeFeedback(saved.grade, gradeFeedbackHtmlByQuestionId[question.id])
					: null;
			const feedback =
				gradeFeedback ??
				buildFeedback(
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
				grade: saved.grade ?? null,
				gradingError: false,
				streamingThoughts: '',
				submitPhase: null,
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
			const idMatch = quiz.questions.findIndex(
				(question) => question.id === quizState.lastQuestionId
			);
			if (idMatch >= 0) {
				nextIndex = idMatch;
			}
			pointerDefined = true;
		} else if (typeof quizState.lastQuestionIndex === 'number') {
			nextIndex = Math.min(Math.max(quizState.lastQuestionIndex, 0), nextAttempts.length - 1);
			pointerDefined = true;
		}
		if (!pointerDefined && firstPendingIndex >= 0 && firstPendingIndex > nextIndex) {
			nextIndex = firstPendingIndex;
		}
		const previousIndex = untrack(() => currentIndex);
		if (previousIndex !== nextIndex) {
			currentIndex = nextIndex;
		}
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

	let attempts = $state<AttemptState[]>([]);
	let currentIndex = $state(0);
	let finishDialogOpen = $state(false);
	let finishState = $state<FinishState>('confirm');
	let finishMode = $state<'quit' | 'finalize' | null>(null);
	let quitPending = $state(false);

	function closeFinishDialog() {
		finishDialogOpen = false;
		finishState = 'confirm';
		finishMode = null;
		quitPending = false;
	}

	function handleFinishDialogChange(open: boolean) {
		if (!open && (finishState === 'saving' || quitPending)) {
			return;
		}
		if (!open) {
			closeFinishDialog();
			return;
		}
		finishDialogOpen = true;
	}

	function updateAttempt(index: number, updater: (value: AttemptState) => AttemptState) {
		attempts = attempts.map((attempt, idx) => (idx === index ? updater(attempt) : attempt));
	}

	$effect(() => {
		attempts = quiz.questions.map((_, idx) => createInitialAttempt(idx === 0));
		currentIndex = 0;
		finishDialogOpen = false;
		finishState = 'confirm';
		finishMode = null;
		quitPending = false;
	});

	const activeQuestion = $derived(quiz.questions[currentIndex] as QuizQuestion);
	const activeAttempt = $derived(attempts[currentIndex] ?? createInitialAttempt());
	const isLastQuestion = $derived(currentIndex === quiz.questions.length - 1);
	const continueLabel = $derived(isLastQuestion ? 'Done' : 'Continue');
	const activeContinueLabel = $derived(
		activeQuestion.kind === 'type-answer' && activeAttempt.gradingError
			? 'Network error, retry'
			: continueLabel
	);
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
			.map((question, index) => ({
				question,
				attempt: attempts[index] ?? createInitialAttempt(index === 0)
			}))
			.filter(
				(
					entry
				): entry is {
					question: QuizQuestion;
					attempt: AttemptState;
				} => entry.question.kind !== 'info-card'
			)
	);

	const remainingCount = $derived(
		scoredAttempts.filter((entry) => entry.attempt.status === 'pending').length
	);

	function openFinishDialog() {
		if (pendingAction) {
			return;
		}
		if (remainingCount === 0) {
			void handleQuit();
			return;
		}
		finishState = 'confirm';
		finishMode = 'quit';
		quitPending = false;
		finishDialogOpen = true;
	}

	function goToQuestion(index: number) {
		if (pendingAction) {
			return;
		}
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
		if (pendingAction) {
			return;
		}
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (prev) => ({
			...prev,
			selectedOptionId: optionId,
			dontKnow: false
		}));
	}

	async function handleMultipleSubmit(optionId: string) {
		if (pendingAction) {
			return;
		}
		const question = quiz.questions[currentIndex];
		if (question.kind !== 'multiple-choice') {
			return;
		}
		pendingAction = 'submit';

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
		} finally {
			pendingAction = null;
		}
	}

	function handleHint() {
		if (pendingAction) {
			return;
		}
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
		if (pendingAction) {
			return;
		}
		const question = getQuestionByIndex(currentIndex);
		if (!question) {
			return;
		}
		pendingAction = 'dontKnow';
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
			grade: null,
			gradingError: false,
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
					selectedOptionId:
						question.kind === 'multiple-choice'
							? (attempt.selectedOptionId ?? undefined)
							: undefined,
					firstViewedAt,
					answeredAt: now
				},
				{ sync: true, markInProgress: true }
			);
		} catch (error) {
			console.error("Failed to sync 'don't know' submission", error);
			completionSyncError = SYNC_ERROR_MESSAGE;
		} finally {
			pendingAction = null;
		}
	}

	function appendStreamingThoughts(current: string, delta: string): string {
		const next = `${current}${delta}`;
		const lines = next.split(/\r?\n/u);
		if (lines.length <= 4) {
			return next;
		}
		return lines.slice(-4).join('\n');
	}

	function handleTypeInput(value: string) {
		if (pendingAction) {
			return;
		}
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (prev) => ({
			...prev,
			value,
			dontKnow: false,
			gradingError: false,
			feedback: prev.gradingError ? null : prev.feedback,
			grade: prev.gradingError ? null : prev.grade,
			showContinue: prev.gradingError ? false : prev.showContinue,
			status: prev.gradingError ? 'pending' : prev.status,
			streamingThoughts: prev.gradingError ? '' : prev.streamingThoughts,
			submitPhase: prev.gradingError ? null : prev.submitPhase
		}));
	}

	async function handleTypeSubmit(value: string) {
		if (pendingAction) {
			return;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}
		const question = quiz.questions[currentIndex];
		if (question.kind !== 'type-answer') {
			return;
		}
		const attempt = attempts[currentIndex] ?? createInitialAttempt();
		const now = new Date();
		const firstViewedAt = attempt.firstViewedAt ?? now;

		if (!supportsServerGrading(question)) {
			pendingAction = 'submit';
			const accepted = [question.answer, ...(question.acceptableAnswers ?? [])].map((entry) =>
				entry.trim().toLowerCase()
			);
			const isCorrect = accepted.includes(trimmed.toLowerCase());
			const status: AttemptStatus = isCorrect ? 'correct' : 'incorrect';
			const fallbackGrade =
				typeof question.marks === 'number' && Number.isFinite(question.marks)
					? {
							awardedMarks: isCorrect ? question.marks : 0,
							maxMarks: question.marks,
							feedback: isCorrect
								? 'Full marks for covering the expected points.'
								: 'No credit for this response. Review the model answer and try again.',
							tone: isCorrect ? 'success' : 'warning'
						}
					: null;
			const feedback = fallbackGrade
				? buildGradeFeedback(fallbackGrade)
				: buildFeedback(question, status, null, false);

			updateAttempt(currentIndex, (prev) => ({
				...prev,
				value: trimmed,
				status,
				locked: true,
				showContinue: true,
			feedback,
			grade: fallbackGrade,
			gradingError: false,
			streamingThoughts: '',
			submitPhase: null,
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
						answeredAt: now,
						grade: fallbackGrade ?? undefined
					},
					{ sync: true, markInProgress: true }
				);
			} catch (error) {
				console.error('Failed to sync typed answer submission', error);
				completionSyncError = SYNC_ERROR_MESSAGE;
			} finally {
				pendingAction = null;
			}
			return;
		}

		pendingAction = 'submit';
		updateAttempt(currentIndex, (prev) => ({
			...prev,
			value: trimmed,
			status: 'pending',
			locked: true,
			showContinue: false,
			feedback: null,
			grade: null,
			gradingError: false,
			streamingThoughts: '',
			submitPhase: 'submitting',
			dontKnow: false,
			answeredAt: now,
			firstViewedAt
		}));

		let response: TypeAnswerGradeResponse;
		let streamingFeedback = '';
		let streamingThoughts = '';
		try {
			response = await requestTypeAnswerGradeStream(
				question.id,
				trimmed,
				(delta) => {
					streamingThoughts = appendStreamingThoughts(streamingThoughts, delta);
					updateAttempt(currentIndex, (prev) => ({
						...prev,
						streamingThoughts,
						submitPhase: 'grading'
					}));
				},
				(delta) => {
					streamingFeedback = `${streamingFeedback}${delta}`;
					const messageHtml = renderMarkdownOptional(streamingFeedback);
					updateAttempt(currentIndex, (prev) => ({
						...prev,
						submitPhase: 'grading',
						feedback: {
							message: streamingFeedback,
							messageHtml,
							tone: 'info'
						}
					}));
				}
			);
		} catch (error) {
			console.error('Failed to grade typed answer submission', error);
			updateAttempt(currentIndex, (prev) => ({
				...prev,
				status: 'pending',
				locked: false,
				showContinue: true,
				feedback: null,
				grade: null,
				gradingError: true,
				streamingThoughts: '',
				submitPhase: null
			}));
			pendingAction = null;
			return;
		}

		if (response.feedbackHtml) {
			gradeFeedbackHtmlByQuestionId = {
				...gradeFeedbackHtmlByQuestionId,
				[question.id]: response.feedbackHtml
			};
		}

		const grade = buildGradeState(response);
		const status: AttemptStatus = response.result === 'correct' ? 'correct' : 'incorrect';
		const feedback = buildGradeFeedback(grade, response.feedbackHtml);

		updateAttempt(currentIndex, (prev) => ({
			...prev,
			value: trimmed,
			status,
			locked: true,
			showContinue: true,
			feedback,
			grade,
			gradingError: false,
			streamingThoughts: '',
			submitPhase: null,
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
					answeredAt: now,
					grade
				},
				{ sync: true, markInProgress: true }
			);
		} catch (error) {
			console.error('Failed to sync typed answer submission', error);
			completionSyncError = SYNC_ERROR_MESSAGE;
		} finally {
			pendingAction = null;
		}
	}

	async function handleInfoContinue() {
		if (pendingAction) {
			return;
		}
		const index = currentIndex;
		const question = quiz.questions[index];
		if (question.kind !== 'info-card') {
			return;
		}
		pendingAction = 'continue';
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
			pendingAction = null;
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
		} finally {
			pendingAction = null;
		}
	}

	async function finalizeCompletion(mode: 'auto' | 'manual'): Promise<boolean> {
		const completedAt = new Date();
		if (!sessionStateStore) {
			completionSyncError = SYNC_ERROR_MESSAGE;
			return false;
		}
		try {
			await sessionStateStore.markStatus(
				planItemId,
				'completed',
				{
					completedAt
				},
				{ quizCompletion: { quizId } }
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

		// Show saving state while finalizing and navigating to dashboard
		finishMode = 'finalize';
		finishState = 'saving';
		finishDialogOpen = true;

		try {
			await persistLastQuestionIndex(currentIndex, { sync: true });
			const synced = await finalizeCompletion('manual');
			if (synced && typeof window !== 'undefined') {
				await goto(`/code/${sessionId}`, { replaceState: true, invalidateAll: true });
				return true;
			}
		} catch (error) {
			console.error('Failed to finalize completion and navigate', error);
		}

		// Any failure — close modal and show top error bar
		closeFinishDialog();
		completionSyncError = SYNC_ERROR_MESSAGE;
		return false;
	}

	async function retryFinalize(): Promise<void> {
		completionSyncError = null;
		const synced = await finalizeCompletion('manual');
		if (synced && typeof window !== 'undefined') {
			await goto(`/code/${sessionId}`, { replaceState: true, invalidateAll: true });
		} else {
			completionSyncError = SYNC_ERROR_MESSAGE;
		}
	}

	async function handleAdvanceFromAttempt() {
		if (pendingAction) {
			return;
		}
		const index = currentIndex;
		pendingAction = 'continue';
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
		} finally {
			pendingAction = null;
		}
	}

	async function handleTypeContinue() {
		if (pendingAction) {
			return;
		}
		if (activeQuestion.kind !== 'type-answer') {
			await handleAdvanceFromAttempt();
			return;
		}
		if (activeAttempt.gradingError) {
			await handleTypeSubmit(activeAttempt.value);
			return;
		}
		await handleAdvanceFromAttempt();
	}

	async function handleQuit() {
		if (quitPending) {
			return;
		}
		quitPending = true;
		completionSyncError = null;
		if (typeof window === 'undefined') {
			quitPending = false;
			return;
		}
		try {
			await goto(`/code/${sessionId}`, {
				replaceState: true,
				invalidateAll: true
			});
		} catch (error) {
			console.error('Navigation to session dashboard failed', error);
			completionSyncError = SYNC_ERROR_MESSAGE;
			quitPending = false;
		}
	}

	// Mark the current question as seen whenever it becomes active
	$effect(() => {
		const index = currentIndex;
		const questionId = getQuestionId(index);
		if (!questionId) {
			return;
		}
		const attempt = untrack(() => attempts[index]);
		if (!attempt) {
			return;
		}
		if (!attempt.seen) {
			const now = attempt.firstViewedAt ?? new Date();
			untrack(() => {
				updateAttempt(index, (prev) => ({
					...prev,
					seen: true,
					firstViewedAt: prev.firstViewedAt ?? now
				}));
			});
			if (!attempt.firstViewedAt) {
				void persistQuestionState(questionId, { firstViewedAt: now }, { sync: false });
			}
		} else if (!attempt.firstViewedAt) {
			const now = new Date();
			untrack(() => {
				updateAttempt(index, (prev) => ({ ...prev, firstViewedAt: now }));
			});
			void persistQuestionState(questionId, { firstViewedAt: now }, { sync: false });
		}
	});

	$effect(() => {
		hydrateFromPlanState(planItemState);
	});
</script>

<svelte:head>
	<title>{quiz.title} · Spark Quiz</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-4 md:py-4">
	{#if completionSyncError}
		<div
			class="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
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
		disabled={pendingAction !== null}
		onNavigate={(detail) => goToQuestion(detail.index)}
		onFinish={openFinishDialog}
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
				busy={pendingAction !== null}
				busyAction={pendingAction}
				submitPhase={activeAttempt.submitPhase ?? 'submitting'}
				thinkingText={activeAttempt.streamingThoughts || null}
				feedback={activeAttempt.feedback}
				showContinue={activeAttempt.showContinue}
				{continueLabel}
				onSelect={(detail) => handleOptionSelect(detail.optionId)}
				onSubmit={(detail) => void handleMultipleSubmit(detail.optionId)}
				onRequestHint={handleHint}
				onDontKnow={() => void handleDontKnow()}
				onContinue={() => void handleAdvanceFromAttempt()}
			/>
		{:else if activeQuestion.kind === 'type-answer'}
			<QuizTypeAnswer
				question={activeQuestion}
				eyebrow={quiz.topic ?? null}
				value={activeAttempt.value}
				status={toCardStatus(activeAttempt.status)}
				showHint={activeAttempt.showHint}
				locked={activeAttempt.locked}
				busy={pendingAction !== null}
				busyAction={pendingAction}
				feedback={activeAttempt.feedback}
				showContinue={activeAttempt.showContinue}
				continueLabel={activeContinueLabel}
				onInput={(detail) => handleTypeInput(detail.value)}
				onSubmit={(detail) => void handleTypeSubmit(detail.value)}
				onRequestHint={handleHint}
				onDontKnow={() => void handleDontKnow()}
				onContinue={() => void handleTypeContinue()}
			/>
		{:else if activeQuestion.kind === 'info-card'}
			<QuizInfoCard
				question={activeQuestion}
				status={toCardStatus(activeAttempt.status)}
				busy={pendingAction !== null}
				busyAction={pendingAction}
				{continueLabel}
				onContinue={() => void handleInfoContinue()}
			/>
		{/if}
	</section>
</div>

<Dialog.Root open={finishDialogOpen} onOpenChange={handleFinishDialogChange}>
	<Dialog.Content
		class="finish-dialog max-w-lg overflow-hidden rounded-3xl bg-background/98 p-0 shadow-[0_35px_90px_-40px_rgba(15,23,42,0.45)] dark:shadow-[0_35px_90px_-40px_rgba(2,6,23,0.75)]"
		hideClose
	>
		{#if finishState === 'saving' || finishMode === 'finalize'}
			<div class="finish-saving flex flex-col items-center gap-6 px-6 py-10 text-center">
				<div class="finish-spinner" aria-hidden="true"></div>
				<div class="finish-saving-copy space-y-2" role="status" aria-live="polite">
					<h2 class="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
						Saving your progress…
					</h2>
					<p class="text-sm leading-relaxed text-muted-foreground">
						Hang tight while we sync your latest answers.
					</p>
				</div>
			</div>
		{:else if finishMode === 'quit'}
			<TakeBreakDialogContent
				description={`You still have ${remainingCount} unanswered ${
					remainingCount === 1 ? 'question' : 'questions'
				}. Your progress is saved — hop back in whenever you're ready.`}
				keepLabel="Keep practicing"
				quitLabel="Quit now"
				quitDisabled={quitPending}
				quitBusy={quitPending}
				on:keep={() => closeFinishDialog()}
				on:quit={() => void handleQuit()}
			/>
		{:else}
			<!-- no content -->
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	.finish-saving {
		background: color-mix(in srgb, hsl(var(--background)) 96%, transparent 4%);
	}

	.finish-spinner {
		height: 2.75rem;
		width: 2.75rem;
		border-radius: 9999px;
		border: 3px solid rgba(148, 163, 184, 0.35);
		border-top-color: rgba(59, 130, 246, 0.85);
		animation: finish-spin 0.75s linear infinite;
	}

	.finish-saving-copy h2 {
		margin: 0;
	}

	.finish-saving-copy p {
		margin: 0;
	}

	@keyframes finish-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
