<script lang="ts">
	import { QuizQuestionCard } from '$lib/components/quiz/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const quizDocFound = $derived(data.quizDocFound);
	const quizParseOk = $derived(data.quizParseOk);
	const quiz = $derived(data.quiz);
	const parseIssues = $derived(data.parseIssues);
	const gradingPromptResolved = $derived(data.gradingPromptResolved);
	const gradingPromptWasDefault = $derived(data.gradingPromptWasDefault);

	const hasTypeAnswer = $derived(Boolean(quiz?.questions.some((q) => q.kind === 'type-answer')));
</script>

<svelte:head>
	<title>{quiz?.title ?? 'Quiz'} · Admin</title>
</svelte:head>

{#if !quizDocFound}
	<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
		Quiz document not found.
	</p>
{:else if !quizParseOk}
	<p class="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
		{#if quiz}
			Quiz document has schema issues. Showing best-effort view. ({parseIssues.length} issue{parseIssues.length === 1 ? '' : 's'})
		{:else}
			Quiz document exists but could not be parsed. ({parseIssues.length} issue{parseIssues.length === 1 ? '' : 's'})
		{/if}
	</p>
{/if}

{#if parseIssues.length > 0}
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Parse issues</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-2 text-sm">
			{#each parseIssues as issue (issue.path + issue.message)}
				<p class="font-mono text-xs text-muted-foreground">
					<span class="text-foreground">{issue.path || '(root)'}</span>: {issue.message}
				</p>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}

{#if quiz}
	<div class="space-y-6">
		<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight text-foreground">{quiz.title}</h1>
				<p class="text-sm text-muted-foreground">{quiz.description}</p>
				<p class="text-xs text-muted-foreground">
					<span class="font-mono break-all">{quiz.id}</span>
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button href=".." variant="secondary" size="sm">Back to lesson</Button>
			</div>
		</div>

		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header>
				<Card.Title>Quiz</Card.Title>
				<Card.Description>Read-only view of the quiz definition.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				<div class="grid gap-3 md:grid-cols-2">
					<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
						<p class="text-xs text-muted-foreground">Progress key</p>
						<p class="mt-1 text-sm">{quiz.progressKey}</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
						<p class="text-xs text-muted-foreground">Topic</p>
						<p class="mt-1 text-sm">{quiz.topic ?? '—'}</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
						<p class="text-xs text-muted-foreground">Estimated minutes</p>
						<p class="mt-1 text-sm">{quiz.estimatedMinutes ?? '—'}</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
						<p class="text-xs text-muted-foreground">Questions</p>
						<p class="mt-1 text-sm">{quiz.questions.length}</p>
					</div>
				</div>

				{#if hasTypeAnswer && gradingPromptResolved}
					<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
						<p class="text-xs font-semibold text-foreground">
							Grading prompt{gradingPromptWasDefault ? ' (default)' : ''}
						</p>
						<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{gradingPromptResolved}</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header>
				<Card.Title>Questions</Card.Title>
				<Card.Description>{quiz.questions.length} total.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-6">
				{#each quiz.questions as question, index (question.id)}
					<div class="space-y-3">
						<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span class="rounded-full bg-muted px-2 py-0.5">{question.kind}</span>
							<span class="rounded-full bg-muted px-2 py-0.5 font-mono break-all">
								{question.id}
							</span>
							{#if question.audioLabel}
								<span class="rounded-full bg-muted px-2 py-0.5">audio: {question.audioLabel}</span>
							{/if}
						</div>

						{#if question.kind === 'multiple-choice'}
							<QuizQuestionCard
								eyebrow={`Q${index + 1} · Multiple choice`}
								title={question.prompt}
								titleHtml={question.promptHtml}
								hint={question.hint}
								hintHtml={question.hintHtml}
								showHint={true}
								explanation={question.explanation}
								explanationHtml={question.explanationHtml}
								showExplanation={true}
								feedback={question.correctFeedback}
								displayFooter={false}
							>
								<div class="mt-5 space-y-3">
									<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
										Options
									</p>
									<div class="space-y-2">
										{#each question.options as option (option.id)}
											<div
												class={cn(
													'flex items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm',
													option.id === question.correctOptionId
														? 'border-emerald-200/70 bg-emerald-50/40'
														: undefined
												)}
											>
												<span class="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
													{option.label}
												</span>
												<div class="min-w-0 flex-1">
													{#if option.textHtml}
														<div class="markdown text-sm text-foreground">
															{@html option.textHtml}
														</div>
													{:else}
														<p class="whitespace-pre-wrap text-sm text-foreground">{option.text}</p>
													{/if}
												</div>
												{#if option.id === question.correctOptionId}
													<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
														Correct
													</span>
												{/if}
											</div>
										{/each}
									</div>
									<p class="text-xs text-muted-foreground">
										Correct option ID: <span class="font-mono">{question.correctOptionId}</span>
									</p>
								</div>
							</QuizQuestionCard>
						{:else if question.kind === 'type-answer'}
							<QuizQuestionCard
								eyebrow={`Q${index + 1} · Type answer`}
								title={question.prompt}
								titleHtml={question.promptHtml}
								hint={question.hint}
								hintHtml={question.hintHtml}
								showHint={true}
								feedback={question.correctFeedback}
								displayFooter={false}
							>
								<div class="mt-5 grid gap-3 md:grid-cols-2">
									<div class="rounded-xl border border-border/70 bg-background p-4 md:col-span-2">
										<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
											Model answer
										</p>
										{#if question.answerHtml}
											<div class="markdown mt-2 text-sm text-foreground">
												{@html question.answerHtml}
											</div>
										{:else}
											<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{question.answer}</p>
										{/if}
									</div>

									<div class="rounded-xl border border-border/70 bg-background p-4">
										<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
											Marks
										</p>
										<p class="mt-2 text-sm text-foreground">{question.marks ?? '—'}</p>
									</div>

									{#if question.acceptableAnswers && question.acceptableAnswers.length > 0}
										<div class="rounded-xl border border-border/70 bg-background p-4 md:col-span-2">
											<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
												Acceptable answers
											</p>
											<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
												{#each question.acceptableAnswers as entry (entry)}
													<li class="whitespace-pre-wrap">{entry}</li>
												{/each}
											</ul>
										</div>
									{/if}

									<div class="rounded-xl border border-border/70 bg-background p-4 md:col-span-2">
										<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
											Mark scheme{question.markSchemeWasDefault ? ' (default)' : ''}
										</p>
										<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">
											{question.markSchemeResolved}
										</p>
									</div>
								</div>
							</QuizQuestionCard>
						{:else if question.kind === 'info-card'}
							<QuizQuestionCard
								eyebrow={`Q${index + 1} · Info card`}
								title={question.prompt}
								titleHtml={question.promptHtml}
								hint={question.hint}
								hintHtml={question.hintHtml}
								showHint={true}
								displayFooter={false}
							>
								<div class="mt-5 space-y-3">
									<div class="rounded-xl border border-border/70 bg-background p-4">
										<p class="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
											Body
										</p>
										{#if question.bodyHtml}
											<div class="markdown mt-2 text-sm text-foreground">
												{@html question.bodyHtml}
											</div>
										{:else}
											<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{question.body}</p>
										{/if}
									</div>

									{#if question.continueLabel}
										<p class="text-xs text-muted-foreground">
											Continue label: <span class="font-mono">{question.continueLabel}</span>
										</p>
									{/if}

									{#if question.eyebrow}
										<p class="text-xs text-muted-foreground">
											Eyebrow: <span class="font-mono">{question.eyebrow}</span>
										</p>
									{/if}
								</div>
							</QuizQuestionCard>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	</div>
{/if}

<style>
	.markdown {
		display: block;
	}

	.markdown :global(p) {
		margin: 0 0 0.75rem;
	}

	.markdown :global(p:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0.5rem 0 0.75rem 1.25rem;
		padding: 0;
	}

	.markdown :global(ul) {
		list-style: disc;
	}

	.markdown :global(ol) {
		list-style: decimal;
	}

	.markdown :global(li + li) {
		margin-top: 0.35rem;
	}

	.markdown :global(code) {
		font-family: var(
			--font-mono,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			'Liberation Mono',
			'Courier New',
			monospace
		);
		font-size: 0.95em;
		padding: 0.1rem 0.25rem;
		border-radius: 0.35rem;
		background-color: color-mix(in srgb, currentColor 12%, transparent);
	}

	.markdown :global(pre) {
		margin: 0.85rem 0 1rem;
		padding: 0.95rem 1rem;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		background: color-mix(in srgb, currentColor 10%, transparent);
		overflow-x: auto;
		font-weight: 500;
	}

	.markdown :global(pre code) {
		display: block;
		padding: 0;
		background: transparent;
		font-family: var(
			--font-mono,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			'Liberation Mono',
			'Courier New',
			monospace
		);
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.markdown :global(strong) {
		font-weight: 600;
	}

	.markdown :global(em) {
		font-style: italic;
	}
</style>
