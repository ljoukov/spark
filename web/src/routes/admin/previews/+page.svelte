<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { PreviewDetail } from '$lib/types/adminPreview';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedId = $state(data.entries[0]?.id ?? null);
	const selectedEntry = $derived(
		selectedId === null ? null : (data.entries.find((entry) => entry.id === selectedId) ?? null)
	);

	const formattedGeneratedAt = $derived(formatGeneratedAt(data.generatedAt));

	function formatGeneratedAt(value: string): string {
		const timestamp = new Date(value);
		if (Number.isNaN(timestamp.getTime())) {
			return value;
		}
		return new Intl.DateTimeFormat('en-GB', {
			dateStyle: 'long',
			timeStyle: 'short'
		}).format(timestamp);
	}

	function formatQuestionType(value: string): string {
		return value.replace(/_/g, ' ');
	}

	function formatOptional(value: string | undefined | null): string {
		if (!value) {
			return '—';
		}
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : '—';
	}

	function handleSelect(entry: PreviewDetail): void {
		selectedId = entry.id;
	}
</script>

<svelte:head>
	<title>Admin · Quiz Generation Previews</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Quiz Generation Previews</h1>
			<p class="text-sm text-muted-foreground">
				Review static quiz outputs generated from the current sample files.
			</p>
		</div>
		<div
			class="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
		>
			Last generated
			<span class="font-medium text-foreground">{formattedGeneratedAt}</span>
		</div>
	</div>

	{#if data.entries.length === 0}
		<Card.Root>
			<Card.Content class="py-12 text-center text-sm text-muted-foreground">
				No preview data is available. Run <code>npm run generate:admin-previews</code> to create it.
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[320px,1fr]">
			<Card.Root class="h-full">
				<Card.Header>
					<Card.Title>Sample files</Card.Title>
					<Card.Description>Choose a source file to inspect the generated quiz.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-2">
					<ul class="flex flex-col gap-2">
						{#each data.entries as entry (entry.id)}
							<li>
								<button
									type="button"
									class={cn(
										'w-full rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
										selectedEntry?.id === entry.id
											? 'border-primary bg-primary/10 text-primary'
											: 'border-transparent hover:border-border hover:bg-muted'
									)}
									onclick={() => handleSelect(entry)}
								>
									<div class="flex flex-col gap-1">
										<span class="font-medium">
											#{entry.id.toString().padStart(2, '0')} · {entry.sourceRelativePath}
										</span>
										<span class="text-xs text-muted-foreground">
											{entry.mode} · {entry.questionCount} questions
										</span>
									</div>
								</button>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>

			<Card.Root class="h-full">
				{#if selectedEntry}
					<Card.Header>
						<Card.Title>File #{selectedEntry.id.toString().padStart(2, '0')}</Card.Title>
						<Card.Description class="break-words">
							{selectedEntry.sourceRelativePath}
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-6">
						<div class="grid gap-4 text-sm md:grid-cols-2">
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Mode</p>
								<p class="font-medium capitalize">{selectedEntry.mode}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Questions</p>
								<p class="font-medium">{selectedEntry.questionCount}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Subject</p>
								<p class="font-medium">{formatOptional(selectedEntry.subject)}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Board</p>
								<p class="font-medium">{formatOptional(selectedEntry.board)}</p>
							</div>
						</div>

						<div class="space-y-2">
							<h2 class="text-base font-semibold">Quiz summary</h2>
							<p class="text-sm leading-relaxed text-muted-foreground">
								{selectedEntry.quiz.summary}
							</p>
						</div>

						<div class="space-y-4">
							<h2 class="text-base font-semibold">Questions</h2>
							{#each selectedEntry.quiz.questions as question, index (question.id)}
								<div class="rounded-lg border border-border bg-card/80 p-4 shadow-sm">
									<div class="flex flex-wrap items-start justify-between gap-2">
										<div class="text-sm font-semibold">
											Question {index + 1}
										</div>
										<div class="text-xs tracking-wide text-muted-foreground uppercase">
											{formatQuestionType(question.type)}
										</div>
									</div>
									<p class="mt-3 text-sm leading-relaxed font-medium">
										{question.prompt}
									</p>
									{#if question.type === 'multiple_choice' && question.options}
										<ul class="mt-3 space-y-1 text-sm text-muted-foreground">
											{#each question.options as option, optionIndex (optionIndex)}
												<li>
													<span class="font-semibold text-foreground">
														{String.fromCharCode(65 + optionIndex)}.
													</span>
													<span class="ml-2">{option}</span>
												</li>
											{/each}
										</ul>
									{/if}
									<div class="mt-3 space-y-2 text-sm text-muted-foreground">
										<p>
											<span class="font-semibold text-foreground">Answer:</span>
											<span class="ml-2">{question.answer}</span>
										</p>
										<p>
											<span class="font-semibold text-foreground">Explanation:</span>
											<span class="ml-2">{question.explanation}</span>
										</p>
										{#if question.topic}
											<p>
												<span class="font-semibold text-foreground">Topic:</span>
												<span class="ml-2">{question.topic}</span>
											</p>
										{/if}
										{#if question.difficulty}
											<p>
												<span class="font-semibold text-foreground">Difficulty:</span>
												<span class="ml-2 capitalize">{question.difficulty}</span>
											</p>
										{/if}
										{#if question.skillFocus}
											<p>
												<span class="font-semibold text-foreground">Skill focus:</span>
												<span class="ml-2">{question.skillFocus}</span>
											</p>
										{/if}
										{#if question.sourceReference}
											<p>
												<span class="font-semibold text-foreground">Source:</span>
												<span class="ml-2">{question.sourceReference}</span>
											</p>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</Card.Content>
				{:else}
					<Card.Content
						class="flex h-full items-center justify-center text-sm text-muted-foreground"
					>
						Select a sample to view its generated quiz.
					</Card.Content>
				{/if}
			</Card.Root>
		</div>
	{/if}
</div>
