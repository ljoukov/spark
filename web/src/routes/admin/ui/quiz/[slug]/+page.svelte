<script lang="ts">
	import {
		QuizProgress,
		QuizMultipleChoice,
		QuizTypeAnswer,
		QuizInfoCard
	} from '$lib/components/quiz/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import type { QuizProgressStep } from '$lib/types/quiz';
	import type { PageData } from './$types';
	import { cn } from '$lib/utils.js';

	let { data }: { data: PageData } = $props();

	const quiz = $derived(data.quiz);
	let activeIndex = $state(0);
	const activeQuestion = $derived(quiz.questions[activeIndex]);
	let hintVisible = $state(false);
	let explanationVisible = $state(false);
	const progressSteps = $derived(
		quiz.questions.map<QuizProgressStep>((_, index) => ({
			status: index === activeIndex ? 'active' : 'seen',
			label: `Question ${index + 1}`
		}))
	);

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
	});

	function handleHintRequest() {
		hintVisible = true;
	}

	function handleDontKnow() {
		hintVisible = true;
		explanationVisible = true;
	}
</script>

<svelte:head>
	<title>{data.title} · Admin UI Preview</title>
</svelte:head>

<div class="fixed inset-0 z-50 flex min-h-screen flex-col bg-background">
	<header
		class="flex items-center justify-between gap-4 border-b border-border/70 bg-background/95 px-6 py-4 shadow-sm backdrop-blur"
	>
		<div class="space-y-1">
			<p class="text-xs font-semibold tracking-[0.32em] text-muted-foreground uppercase">
				Admin UI preview
			</p>
			<h1 class="text-lg font-semibold tracking-tight text-foreground md:text-xl">{data.title}</h1>
			<p class="text-xs text-muted-foreground">{data.description}</p>
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
						value=""
						status="neutral"
						showHint={hintVisible}
						showExplanation={explanationVisible}
						showContinue={false}
						onRequestHint={handleHintRequest}
						onDontKnow={handleDontKnow}
					/>
				{:else if activeQuestion.kind === 'info-card'}
					<QuizInfoCard question={activeQuestion} status="neutral" />
				{/if}
			</section>
		</div>
	</main>
</div>
