<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	const previews = data.previews;
	const manifest = data.manifest;
	let selectedId = $state(previews[0]?.entry.id ?? '');
	const selected = $derived(previews.find((item) => item.entry.id === selectedId));

	function selectPreview(id: string): void {
		selectedId = id;
	}

	$effect(() => {
		if (!selected && previews.length > 0) {
			selectedId = previews[0]!.entry.id;
		}
	});

	function formatDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return new Intl.DateTimeFormat('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}

	function formatMode(mode: string): string {
		return mode.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const units = ['KB', 'MB', 'GB'];
		let size = bytes / 1024;
		let unitIndex = 0;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex += 1;
		}
		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}

	const badgeClass =
		'rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground';
</script>

<div class="flex flex-col gap-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight">Quiz preview gallery</h1>
		<p class="text-sm text-muted-foreground">
			Offline previews generated on {formatDate(manifest.generatedAt)} using
			<code class="rounded bg-muted px-1 py-0.5 text-xs">{manifest.generator.script}</code>. Run
			<code class="rounded bg-muted px-1 py-0.5 text-xs">npm run generate:admin-previews</code> to refresh
			the outputs.
		</p>
		{#if manifest.generator.usedFixtures}
			<div
				class="rounded-md border border-dashed border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
			>
				Current previews use bundled fixture data. Provide a valid Gemini environment and rerun the
				generation script to request fresh model outputs.
			</div>
		{/if}
	</div>

	<div class="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
		<Card.Root class="h-full">
			<Card.Header>
				<Card.Title>Sample files</Card.Title>
				<Card.Description>Select a dataset to inspect the generated quiz.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="flex flex-col gap-2">
					{#each previews as item (item.entry.id)}
						<button
							type="button"
							class={cn(
								buttonVariants({
									variant: item.entry.id === selectedId ? 'default' : 'ghost',
									size: 'sm'
								}),
								'justify-between text-left'
							)}
							onclick={() => selectPreview(item.entry.id)}
						>
							<span class="truncate text-sm font-medium">{item.entry.label}</span>
							<span class={badgeClass}>{formatMode(item.entry.mode)}</span>
						</button>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="h-full">
			{#if selected}
				<Card.Header>
					<Card.Title>{selected.entry.label}</Card.Title>
					<Card.Description>
						Generated {formatDate(selected.entry.generatedAt)} ·
						<span class={badgeClass}>{formatMode(selected.entry.generationSource)}</span>
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-6">
					<section class="space-y-3">
						<h2 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
							Metadata
						</h2>
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Mode</p>
								<p class="text-sm font-medium">{formatMode(selected.entry.mode)}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Questions</p>
								<p class="text-sm font-medium">{selected.entry.questionCount}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Subject</p>
								<p class="text-sm font-medium">{selected.entry.subject ?? '—'}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Board</p>
								<p class="text-sm font-medium">{selected.entry.board ?? '—'}</p>
							</div>
							<div class="space-y-1">
								<p class="text-xs text-muted-foreground uppercase">Raw JSON</p>
								<a
									class="text-sm font-medium text-primary hover:underline"
									href={resolve(selected.rawPath)}
									rel="noreferrer"
									target="_blank"
								>
									View file
								</a>
							</div>
							<div class="space-y-2 sm:col-span-2">
								<p class="text-xs text-muted-foreground uppercase">Source material</p>
								<ul class="space-y-2">
									{#each selected.entry.sourceFiles as source (source.relativePath)}
										<li class="rounded-md border bg-muted/30 px-3 py-2">
											<p class="text-sm font-medium">{source.displayName}</p>
											<p class="text-xs text-muted-foreground">{source.relativePath}</p>
											<p class="text-xs text-muted-foreground">
												{source.mimeType} · {formatBytes(source.bytes)}
											</p>
										</li>
									{/each}
								</ul>
							</div>
						</div>
					</section>

					<Separator />

					{#if selected.quiz}
						<section class="space-y-3">
							<h2 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
								Quiz overview
							</h2>
							<div class="space-y-2">
								<p class="text-lg font-semibold">{selected.quiz.quizTitle}</p>
								<p class="text-sm leading-relaxed text-muted-foreground">
									{selected.quiz.summary}
								</p>
								{#if selected.quiz.syllabusAlignment}
									<p class="text-xs text-muted-foreground">
										Alignment: {selected.quiz.syllabusAlignment}
									</p>
								{/if}
							</div>
							<div class="space-y-4">
								{#each selected.quiz.questions as question, index (question.id)}
									<article class="rounded-lg border bg-card/60 p-4 shadow-sm">
										<div class="flex flex-wrap items-center justify-between gap-2">
											<p class="text-sm font-semibold">Question {index + 1}</p>
											<span class={badgeClass}>{formatMode(question.type)}</span>
										</div>
										<p class="mt-3 text-sm font-medium whitespace-pre-line text-foreground">
											{question.prompt}
										</p>
										{#if question.options}
											<div class="mt-3 grid gap-2 sm:grid-cols-2">
												{#each question.options as option, optionIndex (`${question.id}-${optionIndex}`)}
													<div class="rounded-md border bg-background px-3 py-2 text-sm">
														<span class="mr-2 font-semibold">
															{String.fromCharCode(65 + optionIndex)}.
														</span>
														{option}
													</div>
												{/each}
											</div>
										{/if}
										<div class="mt-3 text-sm">
											<span class="font-semibold">Answer:</span>
											{question.answer}
										</div>
										<p class="mt-2 text-sm text-muted-foreground">
											<span class="font-semibold text-foreground">Explanation:</span>
											{question.explanation}
										</p>
										<div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
											{#if question.topic}
												<span class={badgeClass}>{question.topic}</span>
											{/if}
											{#if question.difficulty}
												<span class={badgeClass}>{formatMode(question.difficulty)}</span>
											{/if}
											{#if question.skillFocus}
												<span class={badgeClass}>{question.skillFocus}</span>
											{/if}
											{#if question.sourceReference}
												<span class={badgeClass}>{question.sourceReference}</span>
											{/if}
										</div>
									</article>
								{/each}
							</div>
						</section>
					{:else}
						<section class="space-y-3">
							<h2 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
								Generation error
							</h2>
							<p class="text-sm text-muted-foreground">
								{selected.error ?? 'An unknown error occurred while preparing this preview.'}
							</p>
						</section>
					{/if}
				</Card.Content>
			{:else}
				<Card.Content>
					<p class="text-sm text-muted-foreground">No previews available.</p>
				</Card.Content>
			{/if}
		</Card.Root>
	</div>
</div>
