<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import { tick } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { QuizGeneration } from '$lib/llm/schemas';
	import type { SampleDetail, SampleOverview, SlopJudgeDetail } from './+page';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type SampleEntry = {
		overview: SampleOverview;
		detail: SampleDetail | null;
		slop: { base: SlopJudgeDetail | null; extension: SlopJudgeDetail | null };
	};

	const entries = $derived(data.entries as SampleEntry[]);

	let selectedId = $state('');
	const activeEntry = $derived(entries.find((entry) => entry.overview.id === selectedId) ?? null);
	const selectedLabel = $derived(activeEntry?.overview.label ?? '');

	const activeQuiz = $derived((activeEntry?.detail?.quiz ?? null) as QuizGeneration | null);
	const quizQuestions = $derived((activeQuiz?.questions ?? []) as QuizGeneration['questions']);
	const questionCount = $derived(quizQuestions.length);
	const hasDetail = $derived(Boolean(activeQuiz));

	const baseQualityVerdict = $derived(activeEntry?.overview.quality?.baseVerdict ?? null);
	const extensionQualityVerdict = $derived(activeEntry?.overview.quality?.extensionVerdict ?? null);
	const slopBase = $derived(activeEntry?.overview.slop?.base ?? null);
	const slopExtension = $derived(activeEntry?.overview.slop?.extension ?? null);
	const baseSlopSummary = $derived(formatSlopSummary(slopBase));
	const extensionSlopSummary = $derived(formatSlopSummary(slopExtension));
	const outputs = $derived(activeEntry?.overview.outputs ?? null);
	const slopDetails = $derived(
		(activeEntry?.slop ?? { base: null, extension: null }) as SampleEntry['slop']
	);
	const baseSlopDetail = $derived((slopDetails.base ?? null) as SlopJudgeDetail | null);
	const extensionSlopDetail = $derived((slopDetails.extension ?? null) as SlopJudgeDetail | null);
	const baseContributions = $derived(baseSlopDetail?.contributions ?? []);
	const extensionContributions = $derived(extensionSlopDetail?.contributions ?? []);

	let comboboxOpen = $state(false);
	let triggerRef = $state<HTMLButtonElement | null>(null);

	function selectSample(id: string): void {
		selectedId = id;
	}

	function closeAndFocusTrigger(): void {
		comboboxOpen = false;
		tick().then(() => {
			triggerRef?.focus();
		});
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

	function formatQualityVerdict(value: string | null): string {
		if (!value) {
			return 'Not run';
		}
		return value === 'approve' ? 'Approve' : 'Revise';
	}

	function formatSlopSummary(score: { label: 0 | 1; riskScore: number } | null): {
		label: string;
		risk: string;
	} {
		if (!score) {
			return { label: 'Not run', risk: '—' };
		}
		return {
			label: score.label === 1 ? 'Flagged' : 'Clean',
			risk: score.riskScore.toFixed(3)
		};
	}

	function formatWeight(value: number): string {
		return `${(value * 100).toFixed(0)}%`;
	}

	const hasSamples = $derived(entries.length > 0);

	$effect(() => {
		if (!hasSamples) {
			selectedId = '';
			comboboxOpen = false;
			return;
		}
		if (!entries.some((entry) => entry.overview.id === selectedId)) {
			selectedId = entries[0]?.overview.id ?? '';
		}
	});
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
					Showing {entries.length} generated sample{entries.length === 1 ? '' : 's'}.
				{:else}
					No generated samples were found. Add files under
					<code class="rounded bg-muted px-1 py-0.5 text-xs">data/samples</code>
					and rerun the generator.
				{/if}
			</p>
		</Card.Content>
	</Card.Root>

	<div class="flex flex-col gap-6">
		<Card.Root class="h-max">
			<Card.Header>
				<Card.Title>Samples</Card.Title>
				<Card.Description>Select a dataset to preview its quiz output.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if hasSamples}
					<Popover.Root
						open={comboboxOpen}
						onOpenChange={(value) => {
							comboboxOpen = value;
						}}
					>
						<Popover.Trigger bind:ref={triggerRef}>
							{#snippet child({ props }: { props: Record<string, unknown> })}
								<Button
									{...props}
									variant="outline"
									class="w-full justify-between"
									role="combobox"
									aria-expanded={comboboxOpen}
									title={selectedLabel || undefined}
								>
									<span class="truncate text-left text-sm font-medium">
										{selectedLabel || 'Select a sample...'}
									</span>
									<ChevronsUpDownIcon class="size-4 opacity-60" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[min(24rem,90vw)] p-0" sideOffset={8} align="start">
							<Command.Root>
								<Command.Input placeholder="Search samples..." aria-label="Search samples" />
								<Command.List>
									<Command.Empty>No sample found.</Command.Empty>
									<Command.Group>
										{#each entries as entry (entry.overview.id)}
											<Command.Item
												value={entry.overview.id}
												class="flex items-start gap-2 px-3 py-2"
												title={entry.overview.label}
												onSelect={() => {
													selectSample(entry.overview.id);
													closeAndFocusTrigger();
												}}
											>
												<CheckIcon
													class={cn(
														'size-4 shrink-0 text-primary transition-opacity',
														entry.overview.id === selectedId ? 'opacity-100' : 'opacity-0'
													)}
												/>
												<div class="flex min-w-0 flex-col text-left">
													<span class="truncate text-sm font-medium">{entry.overview.label}</span>
													<span class="truncate text-xs text-muted-foreground">
														{entry.overview.mode} • {entry.overview.questionCount} questions
													</span>
												</div>
											</Command.Item>
										{/each}
									</Command.Group>
								</Command.List>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
				{:else}
					<p class="text-sm text-muted-foreground">
						No generated samples were found. Add files to
						<code class="rounded bg-muted px-1 py-0.5 text-xs">data/samples</code> and rerun the generator.
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if activeEntry}
			<Card.Root class="space-y-6">
				<Card.Header>
					<Card.Title>
						{activeEntry.detail?.quiz.quizTitle ??
							activeEntry.overview.quizTitle ??
							'Quiz detail unavailable'}
					</Card.Title>
					<Card.Description>
						{activeEntry.overview.source.displayName} · {activeEntry.overview.mode} mode
						{#if activeEntry.detail?.generatedAt}
							• generated {formatTimestamp(activeEntry.detail.generatedAt)}
						{:else if activeEntry.overview.generatedAt}
							• generated {formatTimestamp(activeEntry.overview.generatedAt)}
						{/if}
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-8">
					<section>
						<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
							Overview
						</h3>
						<div class="mt-2 grid gap-3 text-sm md:grid-cols-2">
							<div>
								<p class="font-medium">Subject</p>
								<p class="text-muted-foreground">
									{activeEntry.detail?.subject ?? activeEntry.overview.subject ?? 'Not provided'}
								</p>
							</div>
							<div>
								<p class="font-medium">Board</p>
								<p class="text-muted-foreground">
									{activeEntry.detail?.board ?? activeEntry.overview.board ?? 'Not provided'}
								</p>
							</div>
							<div>
								<p class="font-medium">Model</p>
								<p class="text-muted-foreground">
									{activeEntry.detail?.request?.model ?? 'Not provided'}
								</p>
							</div>
							<div>
								<p class="font-medium">Source file</p>
								<p class="text-muted-foreground">
									{activeEntry.detail?.source.relativePath ??
										activeEntry.overview.source.relativePath}
								</p>
							</div>
							<div>
								<p class="font-medium">Requested questions</p>
								<p class="text-muted-foreground">
									{activeEntry.detail?.request?.questionCount ??
										activeEntry.overview.questionCount ??
										'Not provided'}
								</p>
							</div>
							<div>
								<p class="font-medium">Temperature</p>
								<p class="text-muted-foreground">
									{#if typeof activeEntry.detail?.request?.temperature === 'number'}
										{activeEntry.detail?.request?.temperature}
									{:else}
										Not provided
									{/if}
								</p>
							</div>
							<div class="md:col-span-2">
								<p class="font-medium">Downloads</p>
								<div class="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
									{#if outputs?.quiz}
										<a class="underline" href={outputs.quiz}>Quiz JSON</a>
									{/if}
									{#if outputs?.qualityJudge}
										<a class="underline" href={outputs.qualityJudge}>Quality judge JSON</a>
									{/if}
									{#if outputs?.slop}
										<a class="underline" href={outputs.slop}>Slop JSON</a>
									{/if}
									{#if outputs?.extension}
										<a class="underline" href={outputs.extension}>Extension JSON</a>
									{/if}
									{#if outputs?.extensionQualityJudge}
										<a class="underline" href={outputs.extensionQualityJudge}
											>Extension judge JSON</a
										>
									{/if}
									{#if outputs?.extensionSlop}
										<a class="underline" href={outputs.extensionSlop}>Extension slop JSON</a>
									{/if}
									{#if !outputs?.quiz && !outputs?.qualityJudge && !outputs?.slop && !outputs?.extension && !outputs?.extensionQualityJudge && !outputs?.extensionSlop}
										<span>Not available</span>
									{/if}
								</div>
							</div>
						</div>
					</section>

					<section>
						<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
							Summary
						</h3>
						<p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
							{activeEntry.detail?.quiz.summary ??
								activeEntry.overview.summary ??
								'Summary unavailable'}
						</p>
					</section>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>Evaluation summary</Card.Title>
					<Card.Description>Recent judge outputs for this sample.</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-4 text-sm md:grid-cols-2">
					<div class="rounded-lg border border-border/60 bg-muted/30 p-4">
						<p class="text-xs font-semibold text-muted-foreground uppercase">Quality rubric</p>
						<p class="mt-2 font-medium">
							Base quiz: {formatQualityVerdict(baseQualityVerdict)}
						</p>
						<p class="text-sm text-muted-foreground">
							Extension: {formatQualityVerdict(extensionQualityVerdict)}
						</p>
					</div>
					<div class="rounded-lg border border-border/60 bg-muted/30 p-4">
						<p class="text-xs font-semibold text-muted-foreground uppercase">Slop detection</p>
						<p class="mt-2 font-medium">
							Base quiz: {baseSlopSummary.label}
							{#if slopBase}
								<span class="text-muted-foreground"> · risk {baseSlopSummary.risk}</span>
							{/if}
						</p>
						<p class="text-sm text-muted-foreground">
							Extension: {extensionSlopSummary.label}
							{#if slopExtension}
								· risk {extensionSlopSummary.risk}
							{/if}
						</p>
					</div>
				</Card.Content>
			</Card.Root>

			{#if baseContributions.length > 0 || extensionContributions.length > 0}
				<Card.Root>
					<Card.Header>
						<Card.Title>Slop weighting breakdown</Card.Title>
						<Card.Description>
							Domain weights applied to each axis for the latest slop run.
						</Card.Description>
					</Card.Header>
					<Card.Content class="grid gap-4 md:grid-cols-2">
						{#if baseContributions.length > 0 && baseSlopDetail}
							<section class="rounded-lg border border-border/60 bg-muted/30 p-4">
								<p class="text-xs font-semibold text-muted-foreground uppercase">
									Base quiz · Threshold {formatWeight(baseSlopDetail.threshold)}
								</p>
								<p class="mt-1 text-sm text-muted-foreground">
									Risk {baseSlopSummary.risk} · Label {baseSlopSummary.label}
								</p>
								<table class="mt-3 w-full border-separate border-spacing-y-1 text-xs">
									<thead class="text-muted-foreground">
										<tr class="text-left">
											<th class="px-1 py-0.5">Axis</th>
											<th class="px-1 py-0.5">Score</th>
											<th class="px-1 py-0.5">Weight</th>
											<th class="px-1 py-0.5">Contribution</th>
										</tr>
									</thead>
									<tbody>
										{#each baseContributions as contribution}
											<tr>
												<td class="px-1 py-0.5 font-medium">
													{contribution.code}
												</td>
												<td class="px-1 py-0.5">
													{contribution.score.toFixed(2)}
												</td>
												<td class="px-1 py-0.5">
													{formatWeight(contribution.weight)}
												</td>
												<td class="px-1 py-0.5">
													{contribution.contribution.toFixed(3)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</section>
						{/if}

						{#if extensionContributions.length > 0 && extensionSlopDetail}
							<section class="rounded-lg border border-border/60 bg-muted/30 p-4">
								<p class="text-xs font-semibold text-muted-foreground uppercase">
									Extension · Threshold {formatWeight(extensionSlopDetail.threshold)}
								</p>
								<p class="mt-1 text-sm text-muted-foreground">
									Risk {extensionSlopSummary.risk} · Label {extensionSlopSummary.label}
								</p>
								<table class="mt-3 w-full border-separate border-spacing-y-1 text-xs">
									<thead class="text-muted-foreground">
										<tr class="text-left">
											<th class="px-1 py-0.5">Axis</th>
											<th class="px-1 py-0.5">Score</th>
											<th class="px-1 py-0.5">Weight</th>
											<th class="px-1 py-0.5">Contribution</th>
										</tr>
									</thead>
									<tbody>
										{#each extensionContributions as contribution}
											<tr>
												<td class="px-1 py-0.5 font-medium">
													{contribution.code}
												</td>
												<td class="px-1 py-0.5">
													{contribution.score.toFixed(2)}
												</td>
												<td class="px-1 py-0.5">
													{formatWeight(contribution.weight)}
												</td>
												<td class="px-1 py-0.5">
													{contribution.contribution.toFixed(3)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</section>
						{/if}

						{#if baseContributions.length === 0 && extensionContributions.length === 0}
							<p class="text-sm text-muted-foreground">
								No slop contributions available for this sample.
							</p>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}

			{#if hasDetail}
				<Card.Root>
					<Card.Header>
						<Card.Title>Gemini prompt</Card.Title>
						<Card.Description>Raw prompt sent to Gemini for this sample.</Card.Description>
					</Card.Header>
					<Card.Content>
						<details class="rounded-lg border bg-muted/20 p-4 text-sm">
							<summary class="cursor-pointer font-medium">Prompt sent to Gemini</summary>
							<pre class="mt-3 text-xs leading-relaxed break-words whitespace-pre-wrap">{activeEntry
									.detail?.prompt}</pre>
						</details>
					</Card.Content>
				</Card.Root>

				<p class="text-sm text-muted-foreground">
					{questionCount} generated question{questionCount === 1 ? '' : 's'}
				</p>
				<div class="space-y-4">
					{#each quizQuestions as question, index (question.id)}
						<Card.Root>
							<Card.Header
								class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between"
							>
								<Card.Title>
									Question {index + 1} of {questionCount}
								</Card.Title>
								<span class="text-xs tracking-wide text-muted-foreground uppercase">
									{question.type.replace(/_/g, ' ')}
									{#if question.difficulty}
										• Difficulty: {question.difficulty}
									{/if}
									{#if question.topic}
										• Topic: {question.topic}
									{/if}
								</span>
							</Card.Header>
							<Card.Content class="space-y-4">
								<p class="text-sm leading-relaxed font-medium">
									{question.prompt}
								</p>
								<p class="text-sm text-foreground">
									<span class="font-semibold">Answer:</span>
									{question.answer}
								</p>
								<p class="text-sm text-muted-foreground">
									{question.explanation}
								</p>
								{#if question.options}
									<div>
										<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
											Options
										</p>
										<ul class="mt-2 grid gap-2 text-sm md:grid-cols-2">
											{#each question.options as option, optionIndex (optionIndex)}
												<li
													class="w-full rounded border border-border/40 bg-muted/40 px-2 py-1 break-words"
												>
													{option}
												</li>
											{/each}
										</ul>
									</div>
								{/if}
								<div class="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
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
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{:else}
				<Card.Root>
					<Card.Header>
						<Card.Title>Quiz detail unavailable</Card.Title>
						<Card.Description>
							This sample does not include quiz content. Check the JSON outputs for more
							information.
						</Card.Description>
					</Card.Header>
				</Card.Root>
			{/if}
		{:else}
			<Card.Root>
				<Card.Header>
					<Card.Title>No sample selected</Card.Title>
					<Card.Description>Choose a sample above to view its quiz output.</Card.Description>
				</Card.Header>
			</Card.Root>
		{/if}
	</div>
</div>
