<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedId = $state(data.entries[0]?.overview.id ?? '');
	const activeEntry = $derived(data.entries.find((entry) => entry.overview.id === selectedId));

	function selectSample(id: string): void {
		selectedId = id;
	}

	function formatTimestamp(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return new Intl.DateTimeFormat('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}

	const hasSamples = $derived(data.entries.length > 0);
</script>

<div class="mx-auto w-full max-w-6xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Offline quiz previews</Card.Title>
			<Card.Description>
				Generated {formatTimestamp(data.generatedAt)} using the contents of
				<code class="rounded bg-muted px-1 py-0.5 text-xs">data/samples</code>. Run
				<code class="rounded bg-muted px-1 py-0.5 text-xs">npm run generate-sample-quizzes</code>
				to refresh these fixtures.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<p class="text-sm text-muted-foreground">
				{#if hasSamples}
					Showing {data.entries.length} generated sample{data.entries.length === 1 ? '' : 's'}.
				{:else}
					No generated samples were found. Add files under
					<code class="rounded bg-muted px-1 py-0.5 text-xs">data/samples</code>
					and rerun the generator.
				{/if}
			</p>
		</Card.Content>
	</Card.Root>

	<div class="grid gap-6 lg:grid-cols-[280px_1fr]">
		<Card.Root class="h-max">
			<Card.Header>
				<Card.Title>Samples</Card.Title>
				<Card.Description>Select a dataset to preview its quiz output.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="flex flex-col gap-2">
					{#each data.entries as entry (entry.overview.id)}
						{#if entry}
							<button
								type="button"
								class={cn(
									buttonVariants({
										variant: entry.overview.id === selectedId ? 'default' : 'ghost',
										size: 'sm'
									}),
									'justify-start text-left'
								)}
								onclick={() => selectSample(entry.overview.id)}
							>
								<span class="block text-sm font-medium">{entry.overview.label}</span>
								<span class="block text-xs text-muted-foreground">
									{entry.overview.mode} • {entry.overview.questionCount} questions
								</span>
							</button>
						{/if}
					{/each}
				</div>
			</Card.Content>
		</Card.Root>

		{#if activeEntry}
			<Card.Root class="space-y-4">
				<Card.Header>
					<Card.Title>{activeEntry.detail.quiz.quizTitle}</Card.Title>
					<Card.Description>
						{activeEntry.overview.source.displayName} · {activeEntry.overview.mode} mode • generated
						{formatTimestamp(activeEntry.detail.generatedAt)}
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-6">
					<section>
						<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
							Overview
						</h3>
						<div class="mt-2 grid gap-3 text-sm md:grid-cols-2">
							<div>
								<p class="font-medium">Subject</p>
								<p class="text-muted-foreground">
									{activeEntry.detail.subject ?? 'Not provided'}
								</p>
							</div>
							<div>
								<p class="font-medium">Board</p>
								<p class="text-muted-foreground">
									{activeEntry.detail.board ?? 'Not provided'}
								</p>
							</div>
							<div>
								<p class="font-medium">Model</p>
								<p class="text-muted-foreground">{activeEntry.detail.request.model}</p>
							</div>
							<div>
								<p class="font-medium">Source file</p>
								<p class="text-muted-foreground">{activeEntry.detail.source.relativePath}</p>
							</div>
							<div>
								<p class="font-medium">Requested questions</p>
								<p class="text-muted-foreground">{activeEntry.detail.request.questionCount}</p>
							</div>
							<div>
								<p class="font-medium">Temperature</p>
								<p class="text-muted-foreground">
									{#if typeof activeEntry.detail.request.temperature === 'number'}
										{activeEntry.detail.request.temperature}
									{:else}
										Not provided
									{/if}
								</p>
							</div>
						</div>
					</section>

					<section>
						<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
							Summary
						</h3>
						<p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
							{activeEntry.detail.quiz.summary}
						</p>
					</section>

					<section>
						<details class="rounded-lg border bg-muted/20 p-4 text-sm">
							<summary class="cursor-pointer font-medium">Prompt sent to Gemini</summary>
							<pre class="mt-3 text-xs leading-relaxed break-words whitespace-pre-wrap">{activeEntry
									.detail.prompt}</pre>
						</details>
					</section>

					<section class="space-y-3">
						<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
							Questions
						</h3>
						<ol class="space-y-3">
							{#each activeEntry.detail.quiz.questions as question, index (question.id)}
								<li class="rounded-lg border bg-background p-4 shadow-sm">
									<div
										class="flex flex-wrap items-center gap-2 text-xs tracking-wide text-muted-foreground uppercase"
									>
										<span>Question {index + 1}</span>
										<span>•</span>
										<span>{question.type.replace(/_/g, ' ')}</span>
										{#if question.difficulty}
											<span>• Difficulty: {question.difficulty}</span>
										{/if}
										{#if question.topic}
											<span>• Topic: {question.topic}</span>
										{/if}
									</div>
									<p class="mt-2 text-sm leading-relaxed font-medium">
										{question.prompt}
									</p>
									<p class="mt-2 text-sm text-foreground">
										<span class="font-semibold">Answer:</span>
										{question.answer}
									</p>
									<p class="mt-2 text-sm text-muted-foreground">
										{question.explanation}
									</p>
									{#if question.options}
										<div class="mt-3">
											<p
												class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
											>
												Options
											</p>
											<ul class="mt-1 grid gap-1 text-sm md:grid-cols-2">
												{#each question.options as option, optionIndex (optionIndex)}
													<li class="rounded border bg-muted/40 px-2 py-1">
														<span class="font-medium">{String.fromCharCode(65 + optionIndex)}.</span
														>
														{option}
													</li>
												{/each}
											</ul>
										</div>
									{/if}
									<div class="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
										{#if question.skillFocus}
											<p><span class="font-semibold">Skill focus:</span> {question.skillFocus}</p>
										{/if}
										{#if question.sourceReference}
											<p>
												<span class="font-semibold">Source reference:</span>
												{question.sourceReference}
											</p>
										{/if}
									</div>
								</li>
							{/each}
						</ol>
					</section>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root>
				<Card.Header>
					<Card.Title>No sample selected</Card.Title>
					<Card.Description>Choose a sample on the left to view its quiz output.</Card.Description>
				</Card.Header>
			</Card.Root>
		{/if}
	</div>
</div>
