<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		QuizInfoCard,
		QuizMultipleChoice,
		QuizProgress,
		QuizTypeAnswer
	} from '$lib/components/quiz/index.js';
	import { renderMarkdownOptional } from '$lib/markdown';
	import type {
		QuizFeedback,
		QuizInfoCardQuestion,
		QuizMultipleChoiceQuestion,
		QuizProgressStep,
		QuizTypeAnswerQuestion
	} from '$lib/types/quiz';
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import type { PageData } from './$types';

	type Step = PageData['gap']['steps'][number];
	type AttemptStatus = 'pending' | 'correct' | 'incorrect';
	type AttemptState = {
		status: AttemptStatus;
		seen: boolean;
		locked: boolean;
		value: string;
		selectedOptionId: string | null;
		feedback: QuizFeedback | null;
		showContinue: boolean;
		busyAction: 'submit' | 'dontKnow' | 'continue' | null;
	};

	const gradeResponseSchema = z.object({
		status: z.literal('ok'),
		result: z.enum(['correct', 'partial', 'incorrect']),
		awardedMarks: z.number().int().nonnegative(),
		maxMarks: z.number().int().positive(),
		feedback: z.string().min(1)
	});

	type GradeResponse = z.infer<typeof gradeResponseSchema>;

	const PROMPT_STOP_WORDS = new Set([
		'a',
		'an',
		'and',
		'as',
		'by',
		'can',
		'does',
		'do',
		'during',
		'explain',
		'for',
		'from',
		'has',
		'have',
		'how',
		'if',
		'in',
		'into',
		'is',
		'it',
		'its',
		'of',
		'on',
		'or',
		'so',
		'the',
		'this',
		'to',
		'what',
		'when',
		'where',
		'why',
		'with',
		'would'
	]);

	const STEP_LABEL_OVERRIDES: Array<[RegExp, string]> = [
		[/water potential/, 'Water potential'],
		[/glucose.*concentration|concentration.*glucose/, 'Glucose concentration'],
		[/osmosis|osmotic/, 'Osmosis move'],
		[/turgid|turgor/, 'Turgor pressure'],
		[/guard cells?.*(bend|shape|wall)|(?:bend|shape|wall).*guard cells?/, 'Guard-cell shape'],
		[/stoma|stomata/, 'Stoma opening'],
		[/percent|percentage|decimal/, 'Percent conversion'],
		[/mean rate|rate of|rate from/, 'Rate calculation'],
		[/\bph\b|amylase|enzyme/, 'Enzyme conditions'],
		[/veins?|valves?/, 'Veins and valves'],
		[/evaluate|conclusion/, 'Evaluate conclusion'],
		[/poem|poet|writer|language/, 'Text evidence']
	];

	let { data }: { data: PageData } = $props();
	const gap = $derived(data.gap);
	let currentIndex = $state(0);
	let attempts = $state<AttemptState[]>(
		untrack(() => data.gap.steps.map((_, index) => createInitialAttempt(index === 0)))
	);

	function createInitialAttempt(seen = false): AttemptState {
		return {
			status: 'pending',
			seen,
			locked: false,
			value: '',
			selectedOptionId: null,
			feedback: null,
			showContinue: false,
			busyAction: null
		};
	}

	function updateAttempt(index: number, updater: (attempt: AttemptState) => AttemptState): void {
		attempts = attempts.map((attempt, attemptIndex) =>
			attemptIndex === index ? updater(attempt) : attempt
		);
	}

	function closeGap(): void {
		void goto('/spark/sheets');
	}

	function advance(): void {
		const nextIndex = currentIndex + 1;
		if (nextIndex >= gap.steps.length) {
			closeGap();
			return;
		}
		currentIndex = nextIndex;
		updateAttempt(nextIndex, (attempt) => ({
			...attempt,
			seen: true
		}));
	}

	function goToStep(index: number): void {
		if (index < 0 || index >= gap.steps.length || index === currentIndex) {
			return;
		}
		const attempt = attempts[index];
		if (!attempt?.seen && attempt?.status === 'pending') {
			return;
		}
		currentIndex = index;
		updateAttempt(index, (current) => ({
			...current,
			seen: true
		}));
	}

	function buildGradeFeedback(response: GradeResponse): QuizFeedback {
		const tone: QuizFeedback['tone'] =
			response.result === 'correct'
				? 'success'
				: response.result === 'partial'
					? 'info'
					: 'warning';
		return {
			message: response.feedback,
			messageHtml: renderMarkdownOptional(response.feedback),
			tone
		};
	}

	async function gradeFreeTextStep(step: Extract<Step, { kind: 'free_text' }>, answer: string) {
		const response = await fetch(`/api/spark/gaps/${gap.id}/grade`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				stepId: step.id,
				answer
			})
		});
		if (!response.ok) {
			throw new Error('Unable to grade this answer');
		}
		return gradeResponseSchema.parse(await response.json());
	}

	async function handleTypeSubmit(value: string): Promise<void> {
		const step = gap.steps[currentIndex];
		if (step.kind !== 'free_text') {
			return;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}
		updateAttempt(currentIndex, (attempt) => ({
			...attempt,
			value: trimmed,
			locked: true,
			feedback: null,
			busyAction: 'submit'
		}));
		try {
			const response = await gradeFreeTextStep(step, trimmed);
			const status: AttemptStatus = response.result === 'correct' ? 'correct' : 'incorrect';
			updateAttempt(currentIndex, (attempt) => ({
				...attempt,
				status,
				seen: true,
				locked: true,
				showContinue: true,
				feedback: buildGradeFeedback(response),
				busyAction: null
			}));
		} catch (error) {
			console.error('Failed to grade gap step', error);
			updateAttempt(currentIndex, (attempt) => ({
				...attempt,
				locked: false,
				showContinue: false,
				feedback: {
					message: 'Unable to grade this right now. Try again in a moment.',
					tone: 'warning'
				},
				busyAction: null
			}));
		}
	}

	function handleTypeInput(value: string): void {
		const attempt = attempts[currentIndex];
		if (!attempt || attempt.locked) {
			return;
		}
		updateAttempt(currentIndex, (current) => ({
			...current,
			value
		}));
	}

	function handleDontKnow(): void {
		const step = gap.steps[currentIndex];
		if (step.kind === 'multiple_choice') {
			updateAttempt(currentIndex, (attempt) => ({
				...attempt,
				status: 'incorrect',
				seen: true,
				locked: true,
				selectedOptionId: step.correctOptionId,
				showContinue: true,
				feedback: {
					heading: 'Study this',
					message: step.explanation,
					messageHtml: renderMarkdownOptional(step.explanation),
					tone: 'warning'
				},
				busyAction: null
			}));
			return;
		}
		if (step.kind !== 'free_text') {
			return;
		}
		updateAttempt(currentIndex, (attempt) => ({
			...attempt,
			status: 'incorrect',
			seen: true,
			locked: true,
			showContinue: true,
			feedback: {
				heading: 'Study this',
				message: step.modelAnswer,
				messageHtml: renderMarkdownOptional(step.modelAnswer),
				tone: 'warning'
			},
			busyAction: null
		}));
	}

	function handleMultipleSelect(optionId: string): void {
		updateAttempt(currentIndex, (attempt) => ({
			...attempt,
			selectedOptionId: optionId
		}));
	}

	function handleMultipleSubmit(optionId: string): void {
		const step = gap.steps[currentIndex];
		if (step.kind !== 'multiple_choice') {
			return;
		}
		const isCorrect = optionId === step.correctOptionId;
		updateAttempt(currentIndex, (attempt) => ({
			...attempt,
			status: isCorrect ? 'correct' : 'incorrect',
			seen: true,
			locked: true,
			selectedOptionId: optionId,
			showContinue: true,
			feedback: {
				heading: isCorrect ? 'Correct' : 'Review this',
				message: step.explanation,
				messageHtml: renderMarkdownOptional(step.explanation),
				tone: isCorrect ? 'success' : 'warning'
			}
		}));
	}

	function handleInfoContinue(): void {
		updateAttempt(currentIndex, (attempt) => ({
			...attempt,
			status: 'correct',
			seen: true,
			locked: true,
			showContinue: false,
			busyAction: null
		}));
		advance();
	}

	function stepLabel(step: Step): string {
		if (step.kind === 'model_answer') {
			return 'Model answer';
		}
		if (step.kind === 'memory_chain') {
			return 'Memory chain';
		}
		return 'Step';
	}

	function toTitleLabel(value: string): string {
		return value
			.split(/\s+/)
			.filter((part) => part.length > 0)
			.map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
			.join(' ');
	}

	function derivePromptLabel(prompt: string): string {
		const cleaned = prompt
			.replace(/[`*_~()[\]{}.,:;!?]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase();
		for (const [pattern, label] of STEP_LABEL_OVERRIDES) {
			if (pattern.test(cleaned)) {
				return label;
			}
		}
		const picked: string[] = [];
		for (const word of cleaned.split(/\s+/)) {
			if (picked.length >= 3) {
				break;
			}
			if (word.length < 3 || PROMPT_STOP_WORDS.has(word)) {
				continue;
			}
			picked.push(word);
		}
		if (picked.length > 0) {
			return toTitleLabel(picked.join(' '));
		}
		return 'Quick check';
	}

	function stepEyebrow(step: Step): string {
		if (step.label?.trim()) {
			return step.label.trim();
		}
		if (step.kind === 'model_answer') {
			return 'GCSE model answer';
		}
		if (step.kind === 'memory_chain') {
			return 'Memory chain';
		}
		return derivePromptLabel(step.prompt);
	}

	function toTypeQuestion(step: Extract<Step, { kind: 'free_text' }>): QuizTypeAnswerQuestion {
		return {
			id: step.id,
			kind: 'type-answer',
			prompt: step.prompt,
			promptHtml: step.promptHtml ?? undefined,
			answer: step.expectedAnswer,
			answerHtml: step.modelAnswerHtml ?? undefined,
			marks: step.maxMarks,
			markScheme: step.markScheme,
			placeholder: step.placeholder ?? 'Type a short answer',
			correctFeedback: {
				message: 'Good. Keep going.',
				tone: 'success'
			}
		};
	}

	function toMultipleQuestion(
		step: Extract<Step, { kind: 'multiple_choice' }>
	): QuizMultipleChoiceQuestion {
		return {
			id: step.id,
			kind: 'multiple-choice',
			prompt: step.prompt,
			promptHtml: step.promptHtml ?? undefined,
			options: step.options.map((option) => ({
				id: option.id,
				label: option.label,
				text: option.text,
				textHtml: option.textHtml ?? undefined
			})),
			correctOptionId: step.correctOptionId,
			explanation: step.explanation,
			explanationHtml: step.explanationHtml ?? undefined,
			correctFeedback: {
				message: step.explanation,
				messageHtml: step.explanationHtml ?? undefined,
				tone: 'success'
			}
		};
	}

	function toInfoQuestion(
		step: Extract<Step, { kind: 'model_answer' | 'memory_chain' }>
	): QuizInfoCardQuestion {
		return {
			id: step.id,
			kind: 'info-card',
			prompt: step.prompt,
			promptHtml: step.promptHtml ?? undefined,
			body: step.body,
			bodyHtml: step.bodyHtml ?? undefined,
			eyebrow: step.kind === 'model_answer' ? 'GCSE model answer' : 'Memory chain',
			continueLabel: currentIndex === gap.steps.length - 1 ? 'Finish' : 'Continue'
		};
	}

	const activeStep = $derived(gap.steps[currentIndex] as Step);
	const activeAttempt = $derived(attempts[currentIndex] ?? createInitialAttempt());
	const progressSteps = $derived(
		gap.steps.map<QuizProgressStep>((step, index) => {
			const attempt = attempts[index];
			if (!attempt || attempt.status === 'pending') {
				return {
					status: index === currentIndex ? 'active' : attempt?.seen ? 'seen' : 'pending',
					label: `${stepLabel(step)} ${index + 1}`
				};
			}
			return {
				status: attempt.status,
				label: `${stepLabel(step)} ${index + 1}`
			};
		})
	);
	const continueLabel = $derived(currentIndex === gap.steps.length - 1 ? 'Finish' : 'Continue');
</script>

<svelte:head>
	<title>Spark · {gap.title}</title>
</svelte:head>

<section class="gap-page">
	<div class="gap-page__top">
		<QuizProgress
			steps={progressSteps}
			currentIndex={currentIndex}
			onNavigate={({ index }) => goToStep(index)}
		/>
	</div>

	<main class="gap-page__main">
		<div class="gap-page__content">
			<div class="gap-page__meta">
				<p>{gap.subjectLabel}</p>
				<h1>{gap.title}</h1>
				<span>{gap.cardQuestion}</span>
			</div>

			<div class="gap-page__slide">
				{#if activeStep.kind === 'free_text'}
					<QuizTypeAnswer
						question={toTypeQuestion(activeStep)}
						value={activeAttempt.value}
						status={activeAttempt.status === 'correct' ? 'correct' : activeAttempt.status === 'incorrect' ? 'incorrect' : 'neutral'}
						locked={activeAttempt.locked}
						feedback={activeAttempt.feedback}
						showContinue={activeAttempt.showContinue}
						continueLabel={continueLabel}
						busy={activeAttempt.busyAction !== null}
						busyAction={activeAttempt.busyAction}
						submitPhase="grading"
						answerLabel="Check"
						dontKnowLabel="Show me"
						eyebrow={stepEyebrow(activeStep)}
						onInput={({ value }) => handleTypeInput(value)}
						onSubmit={({ value }) => void handleTypeSubmit(value)}
						onDontKnow={handleDontKnow}
						onContinue={advance}
					/>
				{:else if activeStep.kind === 'multiple_choice'}
					<QuizMultipleChoice
						question={toMultipleQuestion(activeStep)}
						selectedOptionId={activeAttempt.selectedOptionId}
						status={activeAttempt.status === 'correct' ? 'correct' : activeAttempt.status === 'incorrect' ? 'incorrect' : 'neutral'}
						locked={activeAttempt.locked}
						feedback={activeAttempt.feedback}
						showContinue={activeAttempt.showContinue}
						continueLabel={continueLabel}
						eyebrow={stepEyebrow(activeStep)}
						onSelect={({ optionId }) => handleMultipleSelect(optionId)}
						onSubmit={({ optionId }) => handleMultipleSubmit(optionId)}
						onDontKnow={handleDontKnow}
						onContinue={advance}
					/>
				{:else}
					<QuizInfoCard
						question={toInfoQuestion(activeStep)}
						continueLabel={continueLabel}
						onContinue={handleInfoContinue}
					/>
				{/if}
			</div>
		</div>
	</main>
</section>

<style>
	.gap-page {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		width: 100%;
		min-height: 100dvh;
		overflow: visible;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, #d7eadf 52%, transparent) 0 1px,
				transparent 1px 100%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, #b8d9c6 38%, transparent) 0 1px,
				transparent 1px 2rem
			),
			linear-gradient(180deg, #f7fbf5 0%, #fffdf5 44%, #f7fbf5 100%);
		background-size:
			2.1rem 2.1rem,
			100% 2rem,
			100% 100%;
		color: var(--foreground);
		padding: calc(env(safe-area-inset-top, 0px) + 1rem) 1rem 1rem;
	}

	.gap-page__top {
		width: min(64rem, 100%);
		margin: 0 auto;
	}

	.gap-page__main {
		display: flex;
		width: min(52rem, 100%);
		margin: 0 auto;
		flex: 1;
		flex-direction: column;
		gap: 0;
	}

	.gap-page__main::before,
	.gap-page__main::after {
		content: '';
		min-height: 0;
	}

	.gap-page__main::before {
		flex: 1 1 0;
	}

	.gap-page__main::after {
		flex: 2 1 0;
	}

	.gap-page__content {
		display: flex;
		width: 100%;
		flex: 0 0 auto;
		flex-direction: column;
		gap: 1rem;
	}

	.gap-page__meta {
		display: grid;
		gap: 0.25rem;
	}

	.gap-page__meta p,
	.gap-page__meta h1,
	.gap-page__meta span {
		margin: 0;
	}

	.gap-page__meta p {
		color: #0f8b6f;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.gap-page__meta h1 {
		font-size: 1.7rem;
		line-height: 1.12;
	}

	.gap-page__meta span {
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		line-height: 1.45;
	}

	.gap-page__slide {
		width: 100%;
	}

	:global([data-theme='dark'] .gap-page),
	:global(:root:not([data-theme='light']) .gap-page) {
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, #3a3258 54%, transparent) 0 1px,
				transparent 1px 100%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, #3a3258 48%, transparent) 0 1px,
				transparent 1px 2rem
			),
			linear-gradient(180deg, #17142a 0%, #201c39 48%, #17142a 100%);
	}

	:global([data-theme='dark'] .gap-page__meta span),
	:global(:root:not([data-theme='light']) .gap-page__meta span) {
		color: #d8d0e9;
	}

	@media (max-width: 71.875rem) {
		.gap-page__top {
			box-sizing: border-box;
			padding-right: 2.75rem;
		}

		:global(.app-shell:has(.gap-page) .sheet-close-button) {
			top: calc(env(safe-area-inset-top, 0px) + 1.5rem);
		}
	}

	@media (max-width: 43.75rem) {
		.gap-page {
			padding: calc(env(safe-area-inset-top, 0px) + 0.7rem) 0.7rem 0.7rem;
		}

		:global(.app-shell:has(.gap-page) .sheet-close-button) {
			top: calc(env(safe-area-inset-top, 0px) + 1.2rem);
		}

		.gap-page__main {
			justify-content: flex-start;
			padding-top: 0.3rem;
		}

		.gap-page__main::before,
		.gap-page__main::after {
			display: none;
		}

		.gap-page__meta h1 {
			font-size: 1.35rem;
		}
	}
</style>
