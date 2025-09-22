<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { cn } from '$lib/utils.js';

	import type { PageData } from './$types';
	import type { ManifestItem } from './+page.server';

	const MODE_LABELS: Record<ManifestItem['mode'], string> = {
		extraction: 'Extraction',
		synthesis: 'Synthesis'
	};

	const STATUS_LABELS: Record<'ok' | 'error', string> = {
		ok: 'Ready',
		error: 'Needs attention'
	};

	const STATUS_CLASSES: Record<'ok' | 'error', string> = {
		ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
		error: 'bg-red-500/10 text-red-600 dark:text-red-400'
	};

	const QUESTION_TYPE_LABELS: Record<string, string> = {
		multiple_choice: 'Multiple choice',
		short_answer: 'Short answer',
		true_false: 'True or false',
		numeric: 'Numeric'
	};

	let { data }: { data: PageData } = $props();

	let selectedId = $state<string | null>(data.initialSelectionId);

	const manifest = data.manifest;
	const previews = data.previews;
	const previewBasePath = data.previewBasePath;

	const selectedItem = $derived(() => {
		if (!selectedId) {
			return null;
		}
		return manifest.items.find((item) => item.id === selectedId) ?? null;
	});

	const selectedPreview = $derived(() => {
		if (!selectedId) {
			return null;
		}
		return previews[selectedId] ?? null;
	});

	const allErrored = $derived(
		() => manifest.items.length > 0 && manifest.items.every((item) => item.status === 'error')
	);

	function formatMode(mode: ManifestItem['mode']): string {
		return MODE_LABELS[mode] ?? mode;
	}

	function formatStatus(status: 'ok' | 'error'): string {
		return STATUS_LABELS[status] ?? status;
	}

	function formatDate(value: string): string {
		try {
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) {
				return value;
			}
			return new Intl.DateTimeFormat('en-GB', {
				dateStyle: 'medium',
				timeStyle: 'short',
				hour12: false
			}).format(date);
		} catch {
			return value;
		}
	}

	function handleSelect(item: ManifestItem): void {
		selectedId = item.id;
	}

	function getQuestionTypeLabel(type: string): string {
		return QUESTION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Quiz generation previews</Card.Title>
			<Card.Description>
				Offline snapshots generated from <code>data/samples</code> for quick review in the admin console.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 text-sm text-muted-foreground">
			<p>
				Run <code>npm run generate:sample-previews</code> inside <code>web/</code> to refresh these
				files. The tool reprocesses every sample asset and writes JSON results to
				<code>static/admin-preview</code>.
			</p>
			<p>
				Last generated: <span class="font-medium text-foreground"
					>{formatDate(manifest.generatedAt)}</span
				>.
				{#if allErrored}
					<span class="ml-2 text-red-600 dark:text-red-400">
						All previews failed to generate; rerun the tool once Gemini access is available.
					</span>
				{/if}
			</p>
		</Card.Content>
	</Card.Root>

	<div class="grid gap-4 lg:grid-cols-[320px_1fr]">
		<Card.Root class="h-fit">
			<Card.Header class="pb-3">
				<Card.Title class="text-base">Sample files</Card.Title>
				<Card.Description>Select a source asset to inspect its saved output.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				{#if manifest.items.length === 0}
					<p class="text-sm text-muted-foreground">No preview files were found.</p>
				{:else}
					<ul class="space-y-2">
						{#each manifest.items as item (item.id)}
							<li>
								<button
									type="button"
									class={cn(
										'w-full rounded-lg border px-3 py-3 text-left transition hover:border-primary/60 hover:bg-muted/80',
										selectedId === item.id ? 'border-primary bg-primary/5' : 'border-border'
									)}
									on:click={() => handleSelect(item)}
								>
									<div class="flex items-center justify-between gap-3">
										<div>
											<p class="text-sm font-semibold text-foreground">
												#{item.sequence}
												<span class="ml-2 font-normal text-muted-foreground">
													{item.sourceDisplayName}
												</span>
											</p>
											<p class="text-xs text-muted-foreground">
												{formatMode(item.mode)} • {item.sourceFile}
											</p>
										</div>
										<span
											class={cn(
												'rounded-full px-2 py-0.5 text-xs font-medium',
												STATUS_CLASSES[item.status]
											)}
										>
											{formatStatus(item.status)}
										</span>
									</div>
									{#if item.status === 'ok'}
										<p class="mt-2 text-xs text-muted-foreground">
											{item.questionCount} questions · {item.quizTitle ?? 'Untitled quiz'}
										</p>
									{:else if item.errorMessage}
										<p class="mt-2 text-xs text-red-600 dark:text-red-400">
											{item.errorMessage}
										</p>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="min-h-[28rem]">
			<Card.Header class="pb-3">
				<Card.Title class="text-base">Preview details</Card.Title>
				<Card.Description>Review the stored JSON output for the selected sample.</Card.Description>
			</Card.Header>
			<Separator />
			<Card.Content class="space-y-4 pt-4">
				{#if !selectedItem || !selectedPreview}
					<p class="text-sm text-muted-foreground">Select a sample to see its stored preview.</p>
				{:else}
					<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span
							>Source: <span class="font-medium text-foreground">{selectedItem.sourceFile}</span
							></span
						>
						<span>•</span>
						<span
							>Mode: <span class="font-medium text-foreground">{formatMode(selectedItem.mode)}</span
							></span
						>
						<span>•</span>
						<span
							>Generated: <span class="font-medium text-foreground"
								>{formatDate(selectedPreview.generatedAt)}</span
							></span
						>
						{#if selectedPreview.subjectGuess}
							<span>•</span>
							<span
								>Subject guess: <span class="font-medium text-foreground"
									>{selectedPreview.subjectGuess}</span
								></span
							>
						{/if}
						{#if selectedPreview.boardGuess}
							<span>•</span>
							<span
								>Board guess: <span class="font-medium text-foreground"
									>{selectedPreview.boardGuess}</span
								></span
							>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<a
							class={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'mt-2')}
							href={resolve(`${previewBasePath}/${selectedItem.resultPath}`)}
							download
						>
							Download JSON
						</a>
						<a
							class={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'mt-2')}
							href={resolve(`${previewBasePath}/${selectedItem.resultPath}`)}
							target="_blank"
							rel="noreferrer"
						>
							Open in new tab
						</a>
					</div>

					{#if selectedPreview.status === 'error'}
						<div
							class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
						>
							<p class="font-semibold">Generation failed</p>
							<p class="mt-1">{selectedPreview.error.message}</p>
							{#if selectedPreview.error.stack}
								<details class="mt-2">
									<summary
										class="cursor-pointer text-xs font-medium text-red-600 dark:text-red-300"
									>
										View stack trace
									</summary>
									<pre class="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">{selectedPreview
											.error.stack}</pre>
								</details>
							{/if}
						</div>
					{:else}
						<div class="space-y-4">
							<div>
								<h3 class="text-lg font-semibold text-foreground">
									{selectedPreview.quiz.quizTitle}
								</h3>
								<p class="text-sm text-muted-foreground">{selectedPreview.quiz.summary}</p>
							</div>
							<div class="grid gap-4">
								{#each selectedPreview.quiz.questions as question, index (question.id)}
									<div class="rounded-lg border border-border bg-card/60 p-4">
										<div
											class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
										>
											<span class="font-semibold text-foreground">Question {index + 1}</span>
											<span
												class="rounded-full bg-muted px-2 py-0.5 text-[11px] tracking-wide text-muted-foreground uppercase"
											>
												{getQuestionTypeLabel(question.type)}
											</span>
										</div>
										<p class="mt-3 text-sm font-medium text-foreground">{question.prompt}</p>
										{#if question.options && question.options.length > 0}
											<ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
												{#each question.options as option, optIndex (`${question.id}-${optIndex}`)}
													<li>
														<span class="font-medium text-foreground"
															>{String.fromCharCode(65 + optIndex)}.</span
														>
														<span class="ml-2">{option}</span>
													</li>
												{/each}
											</ul>
										{/if}
										<div class="mt-4 space-y-2 text-sm">
											<p>
												<span class="font-semibold text-foreground">Answer:</span>
												<span class="ml-2 text-muted-foreground">{question.answer}</span>
											</p>
											<p class="text-muted-foreground">
												<span class="font-semibold text-foreground">Explanation:</span>
												<span class="ml-2">{question.explanation}</span>
											</p>
											{#if question.sourceReference}
												<p class="text-muted-foreground">
													<span class="font-semibold text-foreground">Reference:</span>
													<span class="ml-2">{question.sourceReference}</span>
												</p>
											{/if}
											{#if question.topic || question.difficulty}
												<div class="flex flex-wrap gap-3 text-xs text-muted-foreground">
													{#if question.topic}
														<span
															>Topic: <span class="font-medium text-foreground"
																>{question.topic}</span
															></span
														>
													{/if}
													{#if question.difficulty}
														<span
															>Difficulty: <span class="font-medium text-foreground"
																>{question.difficulty}</span
															></span
														>
													{/if}
												</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
