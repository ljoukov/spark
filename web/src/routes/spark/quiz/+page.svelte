<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { sparkQuizStore, sparkSessionStore } from '$lib/mock/spark-data';

	type Stage = 'answering' | 'feedback';
	let stage: Stage = 'answering';
	let questionIndex = 0;
	let selectedChoice: number | null = null;
	let showExit = false;

	$: quiz = $sparkQuizStore;
	$: session = $sparkSessionStore;
	$: total = quiz.items.length;
	$: currentQuestion = quiz.items[questionIndex];
	$: isLastQuestion = questionIndex === total - 1;
	$: progressLabel = `${questionIndex + 1}/${total}`;
	$: progressPercent = Math.round(((questionIndex + (stage === 'feedback' ? 1 : 0)) / total) * 100);
	$: answerCorrect =
		stage === 'feedback' && selectedChoice !== null
			? currentQuestion.answer === selectedChoice
			: null;

	function toggleChoice(index: number) {
		if (stage === 'feedback') {
			return;
		}
		selectedChoice = index;
	}

	function handlePrimaryAction() {
		if (stage === 'answering') {
			if (selectedChoice === null) {
				return;
			}
			stage = 'feedback';
			return;
		}

		if (isLastQuestion) {
			goto('/spark/results');
			return;
		}

		questionIndex += 1;
		selectedChoice = null;
		stage = 'answering';
	}

	function finishNow() {
		goto('/spark/results');
	}

	function discardSession() {
		goto('/spark/home');
	}
</script>

<div class="spark-quiz">
	<header class="spark-quiz__top">
		<div class="spark-quiz__progress">
			<span>{progressLabel}</span>
			<div class="spark-quiz__progress-bar">
				<span style={`width: ${progressPercent}%`}></span>
			</div>
		</div>
		<div class="spark-quiz__meta">
			<span>{session.subject}</span>
			<span>{quiz.datasetTitle}</span>
		</div>
		<button
			class="spark-quiz__close"
			type="button"
			onclick={() => (showExit = true)}
			aria-label="Exit session"
		>
			<XIcon class="size-5" />
		</button>
	</header>

	<main class="spark-quiz__body">
		<section class="spark-quiz__question">
			<p class="spark-quiz__eyebrow">Question {questionIndex + 1}</p>
			<h1>{currentQuestion.stem}</h1>
		</section>

		<div class="spark-quiz__choices" role="radiogroup" aria-label="Answer choices">
			{#each currentQuestion.choices as choice, index}
				<button
					type="button"
					class={`spark-quiz__choice ${selectedChoice === index ? 'is-selected' : ''} ${
						stage === 'feedback'
							? index === currentQuestion.answer
								? 'is-correct'
								: selectedChoice === index
									? 'is-wrong'
									: ''
							: ''
					}`}
					onclick={() => toggleChoice(index)}
				>
					<span class="spark-quiz__choice-index">{String.fromCharCode(65 + index)}</span>
					<span>{choice}</span>
				</button>
			{/each}
		</div>
	</main>

	<footer class="spark-quiz__footer">
		<div class="spark-quiz__feedback">
			{#if stage === 'feedback'}
				{#if answerCorrect}
					<p class="spark-quiz__feedback-text is-correct">Correct — keep the momentum.</p>
				{:else}
					<p class="spark-quiz__feedback-text is-wrong">
						The answer is {String.fromCharCode(65 + currentQuestion.answer)}. Add it to focus later.
					</p>
				{/if}
			{/if}
		</div>
		<div class="spark-quiz__actions">
			<button
				type="button"
				class={cn(buttonVariants({ size: 'lg' }), 'spark-quiz__primary')}
				onclick={handlePrimaryAction}
				disabled={stage === 'answering' && selectedChoice === null}
			>
				{stage === 'answering' ? 'Check' : isLastQuestion ? 'Finish' : 'Next'}
			</button>
			<button type="button" class={cn(buttonVariants({ variant: 'ghost' }))} onclick={finishNow}>
				Finish now
			</button>
		</div>
	</footer>

	{#if showExit}
		<div class="spark-quiz-exit">
			<div class="spark-quiz-exit__modal" role="dialog" aria-modal="true">
				<header>
					<h2>Leave session?</h2>
					<p>Your progress is saved so you can hop back in anytime.</p>
				</header>
				<div class="spark-quiz-exit__actions">
					<button
						type="button"
						class={cn(buttonVariants({ variant: 'outline' }))}
						onclick={finishNow}
					>
						Finish now
					</button>
					<button
						type="button"
						class={cn(buttonVariants({ variant: 'secondary' }))}
						onclick={() => (showExit = false)}
					>
						Resume
					</button>
					<button
						type="button"
						class={cn(buttonVariants({ variant: 'ghost' }))}
						onclick={discardSession}
					>
						Discard
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.spark-quiz {
		min-height: 100vh;
		background:
			radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 45%),
			radial-gradient(circle at bottom right, rgba(236, 72, 153, 0.12), transparent 50%),
			color-mix(in srgb, var(--background) 94%, transparent 6%);
		display: grid;
		grid-template-rows: auto 1fr auto;
		padding: clamp(1.5rem, 4vw, 2.5rem);
		gap: clamp(1rem, 3vw, 1.75rem);
	}

	.spark-quiz__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
	}

	.spark-quiz__progress {
		display: flex;
		gap: 0.9rem;
		align-items: center;
	}

	.spark-quiz__progress span:first-child {
		font-weight: 600;
		font-size: 0.95rem;
	}

	.spark-quiz__progress-bar {
		position: relative;
		width: clamp(160px, 30vw, 260px);
		height: 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 18%, transparent 82%);
	}

	.spark-quiz__progress-bar span {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(90deg, rgba(59, 130, 246, 0.95), rgba(14, 165, 233, 0.95));
	}

	.spark-quiz__meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 78%, transparent 22%);
		flex-wrap: wrap;
	}

	.spark-quiz__close {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface-color) 90%, transparent 10%);
		display: grid;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		transition:
			transform 160ms ease,
			background 160ms ease;
	}

	.spark-quiz__close:hover {
		transform: translateY(-2px);
		background: color-mix(in srgb, var(--accent) 28%, transparent 72%);
	}

	.spark-quiz__body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: clamp(1.5rem, 4vw, 2rem);
		align-content: start;
	}

	.spark-quiz__question {
		display: grid;
		gap: 0.75rem;
	}

	.spark-quiz__eyebrow {
		font-size: 0.8rem;
		text-transform: uppercase;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: color-mix(in srgb, var(--text-secondary) 70%, transparent 30%);
	}

	.spark-quiz__question h1 {
		font-size: clamp(1.45rem, 3.5vw, 1.9rem);
		font-weight: 600;
		line-height: 1.4;
	}

	.spark-quiz__choices {
		display: grid;
		gap: 0.9rem;
	}

	.spark-quiz__choice {
		display: flex;
		align-items: flex-start;
		gap: 0.9rem;
		padding: 1rem 1.1rem;
		border-radius: 1.25rem;
		background: color-mix(in srgb, var(--surface-color) 92%, transparent 8%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		text-align: left;
		font-size: 0.95rem;
		font-weight: 500;
		transition:
			transform 140ms ease,
			border 160ms ease,
			box-shadow 200ms ease;
	}

	.spark-quiz__choice:hover:not(.is-selected):not(.is-correct):not(.is-wrong) {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent 60%);
	}

	.spark-quiz__choice.is-selected {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent 45%);
		box-shadow: 0 20px 48px -42px var(--shadow-color);
	}

	.spark-quiz__choice.is-correct {
		background: color-mix(in srgb, rgba(34, 197, 94, 0.18) 80%, transparent 20%);
		border-color: rgba(34, 197, 94, 0.45);
	}

	.spark-quiz__choice.is-wrong {
		background: color-mix(in srgb, rgba(248, 113, 113, 0.16) 80%, transparent 20%);
		border-color: rgba(248, 113, 113, 0.45);
	}

	.spark-quiz__choice-index {
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 0.9rem;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--accent) 20%, transparent 80%);
		font-weight: 600;
	}

	.spark-quiz__footer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: auto;
	}

	.spark-quiz__feedback-text {
		font-size: 0.95rem;
		font-weight: 500;
	}

	.spark-quiz__feedback-text.is-correct {
		color: rgba(34, 197, 94, 0.9);
	}

	.spark-quiz__feedback-text.is-wrong {
		color: rgba(248, 113, 113, 0.95);
	}

	.spark-quiz__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.spark-quiz__primary {
		flex: 1 1 160px;
	}

	.spark-quiz-exit {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--background) 75%, transparent 25%);
		backdrop-filter: blur(10px);
		z-index: 80;
		padding: 1.5rem;
	}

	.spark-quiz-exit__modal {
		width: min(420px, 100%);
		background: color-mix(in srgb, var(--surface-color) 96%, transparent 4%);
		border-radius: 1.5rem;
		border: 1px solid color-mix(in srgb, var(--surface-border) 75%, transparent 25%);
		padding: clamp(1.75rem, 4vw, 2.25rem);
		display: grid;
		gap: 1.25rem;
		box-shadow: 0 32px 60px -46px var(--shadow-color);
	}

	.spark-quiz-exit__actions {
		display: grid;
		gap: 0.75rem;
	}

	@media (max-width: 720px) {
		.spark-quiz {
			padding: 1.25rem;
		}

		.spark-quiz__actions {
			flex-direction: column;
		}

		.spark-quiz__primary {
			width: 100%;
		}
	}
</style>
