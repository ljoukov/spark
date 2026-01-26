<script lang="ts">
	import {
		QuizProgress,
		QuizMultipleChoice,
		QuizTypeAnswer,
		QuizInfoCard
	} from '$lib/components/quiz/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import type { QuizFeedback, QuizProgressStep } from '$lib/types/quiz';
	import type { PageData } from './$types';
	import { cn } from '$lib/utils.js';
	import { streamSse } from '$lib/client/sse';
	import { renderMarkdownOptional } from '$lib/markdown';
	import { z } from 'zod';

	const props = $props<{ data: PageData }>();
	const quiz = $derived(props.data.quiz) as PageData['quiz'];
	const slug = $derived(props.data.slug);
	const title = $derived(props.data.title);
	const description = $derived(props.data.description);
	let activeIndex = $state(0);
	const activeQuestion = $derived(quiz.questions[activeIndex]);
	let hintVisible = $state(false);
	let explanationVisible = $state(false);
	let typedValue = $state('');
	let typedFeedback = $state<QuizFeedback | null>(null);
	let typedStatus = $state<'neutral' | 'correct' | 'incorrect'>('neutral');
	let typedBusy = $state(false);
	let typedBusyAction = $state<'submit' | 'dontKnow' | 'continue' | null>(null);
	let typedSubmitPhase = $state<'submitting' | 'grading'>('submitting');
	let typedThinking = $state('');
	let gradingError = $state<string | null>(null);
	const progressSteps = $derived(
		quiz.questions.map<QuizProgressStep>((_, index) => ({
			status: index === activeIndex ? 'active' : 'seen',
			label: `Question ${index + 1}`
		}))
	);

	const typeAnswerGradeResponseSchema = z.object({
		status: z.literal('ok'),
		result: z.enum(['correct', 'partial', 'incorrect']),
		awardedMarks: z.number().int().nonnegative(),
		maxMarks: z.number().int().positive(),
		feedback: z.string().min(1)
	});

	$effect(() => {
		if (!quiz.questions.length) {
			activeIndex = 0;
			return;
		}
		if (activeIndex < 0 || activeIndex >= quiz.questions.length) {
			activeIndex = 0;
		}
	});

	$effect(() => {
		void activeQuestion;
		hintVisible = false;
		explanationVisible = false;
		typedValue = '';
		typedFeedback = null;
		typedStatus = 'neutral';
		typedBusy = false;
		typedBusyAction = null;
		typedSubmitPhase = 'submitting';
		typedThinking = '';
		gradingError = null;
	});

	function handleHintRequest() {
		hintVisible = true;
	}

	function handleDontKnow() {
		hintVisible = true;
		explanationVisible = true;
	}

	function handleTypeInput(value: string) {
		typedValue = value;
		if (typedFeedback) {
			typedFeedback = null;
			typedStatus = 'neutral';
			gradingError = null;
		}
		if (typedThinking) {
			typedThinking = '';
		}
	}

	function buildGradeFeedback(result: z.infer<typeof typeAnswerGradeResponseSchema>): QuizFeedback {
		const messageHtml = renderMarkdownOptional(result.feedback);
		return {
			message: result.feedback,
			messageHtml,
			tone:
				result.result === 'correct' ? 'success' : result.result === 'partial' ? 'info' : 'warning'
		};
	}

	function appendThinking(current: string, delta: string): string {
		const next = `${current}${delta}`;
		const lines = next.split(/\r?\n/u);
		if (lines.length <= 4) {
			return next;
		}
		return lines.slice(-4).join('\n');
	}

	async function requestTypeAnswerGradeStream(
		questionId: string,
		answer: string
	): Promise<z.infer<typeof typeAnswerGradeResponseSchema>> {
		let result: z.infer<typeof typeAnswerGradeResponseSchema> | null = null;
		await streamSse(
			`/admin/ui/quiz/${slug}/grade`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ questionId, answer })
			},
			{
				onEvent: (event) => {
					if (event.event === 'thought') {
						typedSubmitPhase = 'grading';
						typedThinking = appendThinking(typedThinking, event.data);
						return;
					}
					if (event.event === 'text') {
						typedSubmitPhase = 'grading';
						const nextMessage = `${typedFeedback?.message ?? ''}${event.data}`;
						const messageHtml = renderMarkdownOptional(nextMessage);
						typedFeedback = {
							message: nextMessage,
							messageHtml,
							tone: 'info'
						};
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

	async function handleTypeSubmit(value: string) {
		if (!value.trim()) {
			return;
		}
		if (activeQuestion.kind !== 'type-answer') {
			return;
		}
		typedBusy = true;
		typedBusyAction = 'submit';
		typedSubmitPhase = 'submitting';
		typedThinking = '';
		typedFeedback = null;
		typedStatus = 'neutral';
		gradingError = null;
		try {
			const response = await requestTypeAnswerGradeStream(activeQuestion.id, value.trim());
			typedFeedback = buildGradeFeedback(response);
			typedStatus = response.result === 'correct' ? 'correct' : 'incorrect';
			typedThinking = '';
		} catch (error) {
			console.error('Failed to grade admin preview answer', error);
			gradingError = 'Network error, retry';
		} finally {
			typedBusy = false;
			typedBusyAction = null;
			typedSubmitPhase = 'submitting';
		}
	}
</script>

<svelte:head>
	<title>{title} · Admin UI Preview</title>
</svelte:head>

<div class="fixed inset-0 z-50 flex min-h-screen flex-col bg-background">
	<header
		class="flex items-center justify-between gap-4 border-b border-border/70 bg-background/95 px-6 py-4 shadow-sm backdrop-blur"
	>
		<div class="space-y-1">
			<p class="text-xs font-semibold tracking-[0.32em] text-muted-foreground uppercase">
				Admin UI preview
			</p>
			<h1 class="text-lg font-semibold tracking-tight text-foreground md:text-xl">{title}</h1>
			<p class="text-xs text-muted-foreground">{description}</p>
		</div>
		<a
			href="/admin/ui/quiz"
			class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
		>
			Back to previews
		</a>
	</header>

	<main class="flex-1 overflow-y-auto">
		<div class="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 md:py-8">
			<QuizProgress
				steps={progressSteps}
				currentIndex={activeIndex}
				total={quiz.questions.length}
				onNavigate={(detail) => {
					activeIndex = detail.index;
				}}
			/>

			<section class="flex flex-col gap-6">
				{#if activeQuestion.kind === 'multiple-choice'}
					<QuizMultipleChoice
						question={activeQuestion}
						eyebrow={quiz.topic ?? null}
						selectedOptionId={activeQuestion.options[0]?.id ?? null}
						status="neutral"
						showHint={hintVisible}
						showExplanation={explanationVisible}
						showContinue={false}
						onRequestHint={handleHintRequest}
						onDontKnow={handleDontKnow}
					/>
				{:else if activeQuestion.kind === 'type-answer'}
					<QuizTypeAnswer
						question={activeQuestion}
						eyebrow={quiz.topic ?? null}
						value={typedValue}
						status={typedStatus}
						showHint={hintVisible}
						showExplanation={explanationVisible}
						showContinue={false}
						busy={typedBusy}
						busyAction={typedBusyAction}
						submitPhase={typedSubmitPhase}
						thinkingText={typedThinking || null}
						feedback={typedFeedback}
						onRequestHint={handleHintRequest}
						onDontKnow={handleDontKnow}
						onInput={(detail) => handleTypeInput(detail.value)}
						onSubmit={(detail) => void handleTypeSubmit(detail.value)}
					/>
					{#if gradingError}
						<p class="text-sm font-medium text-destructive">{gradingError}</p>
					{/if}
				{:else if activeQuestion.kind === 'info-card'}
					<QuizInfoCard question={activeQuestion} status="neutral" />
				{/if}
			</section>
		</div>
	</main>
</div>
