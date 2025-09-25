<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import { tick } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedId = $state(data.entries[0]?.overview.id ?? '');
	const activeEntry = $derived(data.entries.find((entry) => entry.overview.id === selectedId));
	const selectedLabel = $derived(activeEntry?.overview.label ?? '');
	const questionCount = $derived(activeEntry?.detail.quiz.questions.length ?? 0);
	const activeJudge = $derived(activeEntry?.judge ?? null);
	const activeSlop = $derived(activeEntry?.slop ?? null);
	const activeExtension = $derived(activeEntry?.extension ?? null);
	const activeExtensionJudge = $derived(activeEntry?.extensionJudge ?? null);
	const activeExtensionSlop = $derived(activeEntry?.extensionSlop ?? null);
	const baseSlopSignals = $derived(
		activeSlop ? Object.entries(activeSlop.autoSignals).sort(([a], [b]) => a.localeCompare(b)) : []
	);
	const extensionSlopSignals = $derived(
		activeExtensionSlop
			? Object.entries(activeExtensionSlop.autoSignals).sort(([a], [b]) => a.localeCompare(b))
			: []
	);

	let comboboxOpen = $state(false);
	let triggerRef = $state<HTMLButtonElement | null>(null);

	function selectSample(id: string): void {
		selectedId = id;
	}

	function describeSlopLabel(label: 0 | 1): string {
		return label === 1 ? 'Flagged' : 'Clear';
	}

	function formatAutoSignalName(key: string): string {
		return key.replace(/_/g, ' ');
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

	const hasSamples = $derived(data.entries.length > 0);

	$effect(() => {
		if (!hasSamples) {
			selectedId = '';
			comboboxOpen = false;
			return;
		}
		if (!data.entries.some((entry) => entry.overview.id === selectedId)) {
			selectedId = data.entries[0]?.overview.id ?? '';
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
					Showing {data.entries.length} generated sample{data.entries.length === 1 ? '' : 's'}.
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
										{#each data.entries as entry (entry.overview.id)}
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
					<Card.Title>{activeEntry.detail.quiz.quizTitle}</Card.Title>
					<Card.Description>
						{activeEntry.overview.source.displayName} · {activeEntry.overview.mode} mode • generated
						{formatTimestamp(activeEntry.detail.generatedAt)}
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
				</Card.Content>
			</Card.Root>

			{#if activeJudge || activeSlop}
				<div class="grid gap-4 md:grid-cols-2">
					{#if activeJudge}
						<Card.Root class="h-full">
							<Card.Header>
								<Card.Title>Quality verdict</Card.Title>
								<Card.Description>
									{formatTimestamp(activeJudge.evaluatedAt)} ·
									{activeJudge.judge.model.modelId}
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4 text-sm">
								<div>
									<p class="font-semibold capitalize">
										{activeJudge.judge.verdict.verdict}
									</p>
									<p class="mt-2 leading-relaxed whitespace-pre-wrap">
										{activeJudge.judge.verdict.explanation}
									</p>
								</div>
								<div>
									<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Rubric findings
									</h4>
									<ul class="mt-2 space-y-2">
										{#each activeJudge.judge.verdict.rubricFindings as finding (finding.criterion)}
											<li>
												<p class="font-medium text-foreground">
													{finding.criterion}
													<span class="ml-1 text-xs text-muted-foreground">
														score {finding.score.toFixed(2)}
													</span>
												</p>
												<p class="text-muted-foreground">
													{finding.justification}
												</p>
											</li>
										{/each}
									</ul>
								</div>
								{#if activeJudge.audit}
									<div class="rounded-lg border bg-muted/30 p-3 text-xs">
										<p class="font-semibold text-foreground">
											Audit — {activeJudge.audit.model.modelId}
										</p>
										<p class="mt-1 text-muted-foreground">
											Agreement: {activeJudge.audit.result.verdictAgreement}
											· Confidence: {activeJudge.audit.result.confidence}
										</p>
										<p class="mt-2 whitespace-pre-wrap text-muted-foreground">
											{activeJudge.audit.result.explanation}
										</p>
									</div>
								{/if}
							</Card.Content>
						</Card.Root>
					{/if}
					{#if activeSlop}
						<Card.Root class="h-full">
							<Card.Header>
								<Card.Title>Slop detection</Card.Title>
								<Card.Description>
									{formatTimestamp(activeSlop.evaluatedAt)} ·
									{activeSlop.model.modelId}
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4 text-sm">
								<div>
									<p class="font-semibold">
										{describeSlopLabel(activeSlop.verdict.overall.label)}
										<span class="ml-2 text-xs text-muted-foreground">
											confidence {activeSlop.verdict.overall.confidence.toFixed(2)} · annoyance {activeSlop
												.verdict.annoyance}
										</span>
									</p>
									{#if activeSlop.context}
										<p class="mt-1 text-xs text-muted-foreground">
											Context: {activeSlop.context}
										</p>
									{/if}
								</div>
								{#if activeSlop.verdict.topFixes.length}
									<div>
										<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
											Top fixes
										</h4>
										<ul class="mt-2 space-y-1">
											{#each activeSlop.verdict.topFixes as fix, fixIndex (fixIndex)}
												<li>• {fix}</li>
											{/each}
										</ul>
									</div>
								{/if}
								<div>
									<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Axes
									</h4>
									<div class="mt-2 overflow-x-auto">
										<table class="w-full min-w-[30rem] text-left text-xs">
											<thead class="text-muted-foreground">
												<tr>
													<th class="px-2 py-1 font-medium">Axis</th>
													<th class="px-2 py-1 font-medium">Score</th>
													<th class="px-2 py-1 font-medium">Rationale</th>
													<th class="px-2 py-1 font-medium">Spans</th>
												</tr>
											</thead>
											<tbody>
												{#each activeSlop.verdict.axes as axis (axis.code)}
													<tr class="border-t text-foreground">
														<td class="px-2 py-2 font-medium">{axis.code}</td>
														<td class="px-2 py-2">{axis.score.toFixed(1)}</td>
														<td class="px-2 py-2 text-muted-foreground">
															{axis.rationale}
														</td>
														<td class="px-2 py-2">
															{#if axis.spans.length}
																<ul class="space-y-1 text-muted-foreground">
																	{#each axis.spans as span, spanIndex (spanIndex)}
																		<li>
																			“{span.quote}”
																			<span class="ml-1 text-[0.65rem] text-muted-foreground">
																				({span.charStart}–{span.charEnd})
																			</span>
																		</li>
																	{/each}
																</ul>
															{:else}
																<span class="text-muted-foreground">—</span>
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
								<div>
									<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Auto signals
									</h4>
									<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3">
										{#each baseSlopSignals as [name, value] (name)}
											<div>
												<dt class="font-medium text-foreground">
													{formatAutoSignalName(name)}
												</dt>
												<dd class="text-muted-foreground">{value}</dd>
											</div>
										{/each}
									</dl>
								</div>
								<details class="rounded-lg border bg-muted/20 p-3">
									<summary class="cursor-pointer text-xs font-semibold tracking-wide uppercase">
										Prompt excerpt
									</summary>
									<pre
										class="mt-2 max-h-64 overflow-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
{activeSlop.prompt}
                                                                        </pre>
								</details>
							</Card.Content>
						</Card.Root>
					{/if}
				</div>
			{/if}

			<Card.Root>
				<Card.Header>
					<Card.Title>Gemini prompt</Card.Title>
					<Card.Description>Raw prompt sent to Gemini for this sample.</Card.Description>
				</Card.Header>
				<Card.Content>
					<details class="rounded-lg border bg-muted/20 p-4 text-sm">
						<summary class="cursor-pointer font-medium">Prompt sent to Gemini</summary>
						<pre class="mt-3 text-xs leading-relaxed break-words whitespace-pre-wrap">{activeEntry
								.detail.prompt}</pre>
					</details>
				</Card.Content>
			</Card.Root>

			{#if activeExtension}
				<Card.Root>
					<Card.Header>
						<Card.Title>Extension quiz overview</Card.Title>
						<Card.Description>
							Generated {formatTimestamp(activeExtension.generatedAt)} · {activeExtension.quiz
								.questionCount} questions
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<p class="text-sm leading-relaxed whitespace-pre-wrap">
							{activeExtension.quiz.summary}
						</p>
					</Card.Content>
				</Card.Root>
			{/if}

			{#if activeExtensionJudge || activeExtensionSlop}
				<div class="grid gap-4 md:grid-cols-2">
					{#if activeExtensionJudge}
						<Card.Root class="h-full">
							<Card.Header>
								<Card.Title>Extension quality verdict</Card.Title>
								<Card.Description>
									{formatTimestamp(activeExtensionJudge.evaluatedAt)} ·
									{activeExtensionJudge.judge.model.modelId}
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4 text-sm">
								<div>
									<p class="font-semibold capitalize">
										{activeExtensionJudge.judge.verdict.verdict}
									</p>
									<p class="mt-2 leading-relaxed whitespace-pre-wrap">
										{activeExtensionJudge.judge.verdict.explanation}
									</p>
								</div>
								<div>
									<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Rubric findings
									</h4>
									<ul class="mt-2 space-y-2">
										{#each activeExtensionJudge.judge.verdict.rubricFindings as finding (finding.criterion)}
											<li>
												<p class="font-medium text-foreground">
													{finding.criterion}
													<span class="ml-1 text-xs text-muted-foreground">
														score {finding.score.toFixed(2)}
													</span>
												</p>
												<p class="text-muted-foreground">
													{finding.justification}
												</p>
											</li>
										{/each}
									</ul>
								</div>
								{#if activeExtensionJudge.audit}
									<div class="rounded-lg border bg-muted/30 p-3 text-xs">
										<p class="font-semibold text-foreground">
											Audit — {activeExtensionJudge.audit.model.modelId}
										</p>
										<p class="mt-1 text-muted-foreground">
											Agreement: {activeExtensionJudge.audit.result.verdictAgreement}
											· Confidence: {activeExtensionJudge.audit.result.confidence}
										</p>
										<p class="mt-2 whitespace-pre-wrap text-muted-foreground">
											{activeExtensionJudge.audit.result.explanation}
										</p>
									</div>
								{/if}
							</Card.Content>
						</Card.Root>
					{/if}
					{#if activeExtensionSlop}
						<Card.Root class="h-full">
							<Card.Header>
								<Card.Title>Extension slop detection</Card.Title>
								<Card.Description>
									{formatTimestamp(activeExtensionSlop.evaluatedAt)} ·
									{activeExtensionSlop.model.modelId}
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4 text-sm">
								<div>
									<p class="font-semibold">
										{describeSlopLabel(activeExtensionSlop.verdict.overall.label)}
										<span class="ml-2 text-xs text-muted-foreground">
											confidence {activeExtensionSlop.verdict.overall.confidence.toFixed(2)} · annoyance
											{activeExtensionSlop.verdict.annoyance}
										</span>
									</p>
									{#if activeExtensionSlop.context}
										<p class="mt-1 text-xs text-muted-foreground">
											Context: {activeExtensionSlop.context}
										</p>
									{/if}
								</div>
								{#if activeExtensionSlop.verdict.topFixes.length}
									<div>
										<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
											Top fixes
										</h4>
										<ul class="mt-2 space-y-1">
											{#each activeExtensionSlop.verdict.topFixes as fix, fixIndex (fixIndex)}
												<li>• {fix}</li>
											{/each}
										</ul>
									</div>
								{/if}
								<div>
									<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Axes
									</h4>
									<div class="mt-2 overflow-x-auto">
										<table class="w-full min-w-[30rem] text-left text-xs">
											<thead class="text-muted-foreground">
												<tr>
													<th class="px-2 py-1 font-medium">Axis</th>
													<th class="px-2 py-1 font-medium">Score</th>
													<th class="px-2 py-1 font-medium">Rationale</th>
													<th class="px-2 py-1 font-medium">Spans</th>
												</tr>
											</thead>
											<tbody>
												{#each activeExtensionSlop.verdict.axes as axis (axis.code)}
													<tr class="border-t text-foreground">
														<td class="px-2 py-2 font-medium">{axis.code}</td>
														<td class="px-2 py-2">{axis.score.toFixed(1)}</td>
														<td class="px-2 py-2 text-muted-foreground">
															{axis.rationale}
														</td>
														<td class="px-2 py-2">
															{#if axis.spans.length}
																<ul class="space-y-1 text-muted-foreground">
																	{#each axis.spans as span, spanIndex (spanIndex)}
																		<li>
																			“{span.quote}”
																			<span class="ml-1 text-[0.65rem] text-muted-foreground">
																				({span.charStart}–{span.charEnd})
																			</span>
																		</li>
																	{/each}
																</ul>
															{:else}
																<span class="text-muted-foreground">—</span>
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
								<div>
									<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Auto signals
									</h4>
									<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3">
										{#each extensionSlopSignals as [name, value] (name)}
											<div>
												<dt class="font-medium text-foreground">
													{formatAutoSignalName(name)}
												</dt>
												<dd class="text-muted-foreground">{value}</dd>
											</div>
										{/each}
									</dl>
								</div>
								<details class="rounded-lg border bg-muted/20 p-3">
									<summary class="cursor-pointer text-xs font-semibold tracking-wide uppercase">
										Prompt excerpt
									</summary>
									<pre
										class="mt-2 max-h-64 overflow-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
{activeExtensionSlop.prompt}
                                                                        </pre>
								</details>
							</Card.Content>
						</Card.Root>
					{/if}
				</div>
			{/if}

			<p class="text-sm text-muted-foreground">
				{questionCount} generated question{questionCount === 1 ? '' : 's'}
			</p>
			<div class="space-y-4">
				{#each activeEntry.detail.quiz.questions as question, index (question.id)}
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
					<Card.Title>No sample selected</Card.Title>
					<Card.Description>Choose a sample above to view its quiz output.</Card.Description>
				</Card.Header>
			</Card.Root>
		{/if}
	</div>
</div>
