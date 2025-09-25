<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type {
		SlopAxisCode,
		SlopJudgeResponse,
		SlopAutoSignals,
		WeightedRisk
	} from '$lib/types/slop';

	type DomainOption = { value: 'news' | 'qa' | 'other'; label: string; description: string };

	type JudgePayload = {
		result: SlopJudgeResponse;
		autoSignals: SlopAutoSignals;
		weightedRisk: WeightedRisk;
		computedLabel: 0 | 1;
	};

	const domains: DomainOption[] = [
		{
			value: 'news',
			label: 'News / long-form',
			description: 'Longer reported pieces and updates.'
		},
		{
			value: 'qa',
			label: 'Q&A / short answer',
			description: 'Brief question answering responses.'
		},
		{ value: 'other', label: 'Other', description: 'General purpose or mixed content.' }
	];

	const axisSummaries: Record<SlopAxisCode, string> = {
		Density: 'High word count with limited information.',
		Relevance: 'Misalignment with the prompt or context.',
		Factuality: 'Inaccurate or unsupported claims.',
		Bias: 'Subjective skew or missing perspective.',
		Structure: 'Repetitive or templated phrasing.',
		Coherence: 'Disjointed or contradictory flow.',
		Tone: 'Awkward, verbose, or mismatched style.'
	};

	const formState = $state({
		domain: 'news' as DomainOption['value'],
		context: '',
		text: '',
		loading: false,
		error: '',
		response: null as JudgePayload | null
	});

	function canSubmit(): boolean {
		return Boolean(formState.text.trim()) && !formState.loading;
	}

	function formatNumber(value: number, decimals = 2): string {
		return Number.isFinite(value) ? value.toFixed(decimals) : '—';
	}

	function weightFor(axis: SlopAxisCode): number {
		return formState.response?.weightedRisk.weights[axis] ?? 0;
	}

	function contributionFor(axis: SlopAxisCode, score: number): number {
		const weight = weightFor(axis);
		return (score / 4) * weight;
	}

	function autoSignalEntries(
		autoSignals: Record<string, unknown> | undefined
	): Array<[string, string]> {
		if (!autoSignals) {
			return [];
		}
		return Object.entries(autoSignals).map(([key, value]) => [
			key,
			typeof value === 'number' ? formatNumber(value, 3) : String(value)
		]);
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canSubmit()) {
			return;
		}

		formState.loading = true;
		formState.error = '';
		formState.response = null;

		try {
			const response = await fetch('/admin/gemini/slop', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					domain: formState.domain,
					context: formState.context,
					text: formState.text
				})
			});

			const payload = await response.json();
			if (!response.ok) {
				formState.error =
					typeof payload?.error === 'string'
						? payload.error
						: 'The judge call failed. Check the console for details.';
				return;
			}
			formState.response = payload as JudgePayload;
		} catch (error) {
			console.error('Slop judge request failed', error);
			formState.error = 'Unable to reach the evaluation endpoint.';
		} finally {
			formState.loading = false;
		}
	}
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold tracking-tight">Slop judge</h1>
		<p class="text-sm text-muted-foreground">
			Run the seven-axis rubric from <em>Measuring AI “Slop” in Text</em> against any sample. We compute
			automatic signals, send a structured prompt to Gemini, and display the full analysis.
		</p>
	</header>

	<Card.Root>
		<Card.Header class="space-y-1">
			<Card.Title>Text input</Card.Title>
			<Card.Description
				>Provide optional context, choose a domain, then paste the text you want to grade.</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<form class="space-y-6" onsubmit={handleSubmit}>
				<div class="grid gap-2">
					<label for="domain" class="text-sm font-medium text-foreground">Domain</label>
					<div class="grid gap-3 sm:grid-cols-3">
						{#each domains as option (option.value)}
							<label
								class={cn(
									'flex cursor-pointer flex-col gap-1 rounded-lg border bg-background p-3 text-left shadow-sm transition hover:border-primary',
									formState.domain === option.value
										? 'border-primary ring-2 ring-primary/40'
										: 'border-border'
								)}
							>
								<span class="text-sm font-semibold text-foreground">{option.label}</span>
								<span class="text-xs text-muted-foreground">{option.description}</span>
								<input
									class="sr-only"
									type="radio"
									name="domain"
									value={option.value}
									checked={formState.domain === option.value}
									onchange={() => {
										formState.domain = option.value;
									}}
								/>
							</label>
						{/each}
					</div>
				</div>

				<div class="grid gap-2">
					<label for="context" class="text-sm font-medium text-foreground">Context (optional)</label
					>
					<textarea
						id="context"
						class="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						placeholder="Prompt, question, or surrounding instructions"
						bind:value={formState.context}
					/>
				</div>

				<div class="grid gap-2">
					<label for="text" class="text-sm font-medium text-foreground">Text to judge</label>
					<textarea
						id="text"
						required
						class="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						placeholder="Paste the response you want the LLM judge to score."
						bind:value={formState.text}
					/>
				</div>

				{#if formState.error}
					<div
						class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{formState.error}
					</div>
				{/if}

				<div class="flex items-center justify-between gap-4">
					<p class="text-xs text-muted-foreground">
						The tool validates inputs with zod, computes automatic metrics locally, then calls
						Gemini 2.5 Pro with a structured-output prompt.
					</p>
					<button
						type="submit"
						class={cn(buttonVariants({ variant: 'default' }), 'min-w-[140px] justify-center')}
						disabled={!canSubmit()}
					>
						{#if formState.loading}
							Running judge…
						{:else}
							Run judge
						{/if}
					</button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	{#if formState.response}
		{#key formState.response}
			<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<Card.Root class="h-full">
					<Card.Header class="space-y-2">
						<Card.Title>LLM verdict</Card.Title>
						<Card.Description>
							Overall slop label: <span class="font-medium text-foreground"
								>{formState.response.result.overall_slop.label}</span
							>
							(confidence {formatNumber(formState.response.result.overall_slop.confidence, 2)}).
							Annoyance score
							{formState.response.result.annoyance}.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-6">
						<section class="grid gap-4">
							<div class="rounded-md border border-border bg-muted/40 p-4 text-sm">
								<p class="font-semibold text-foreground">Weighted risk</p>
								<p class="mt-1 text-sm text-muted-foreground">
									Calculated risk {formatNumber(formState.response.weightedRisk.risk, 3)} vs threshold
									{formatNumber(formState.response.weightedRisk.threshold, 3)} →
									{formState.response.computedLabel ? 'slop likely' : 'not flagged'}.
								</p>
							</div>

							{#if formState.response.result.top_fixes.length}
								<div class="space-y-2">
									<h3 class="text-sm font-semibold text-foreground">Top fixes</h3>
									<ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
										{#each formState.response.result.top_fixes as fix, index (index)}
											<li>{fix}</li>
										{/each}
									</ol>
								</div>
							{/if}
						</section>

						<section class="space-y-4">
							<h3 class="text-sm font-semibold text-foreground">Axis breakdown</h3>
							<div class="grid gap-4">
								{#each formState.response.result.axes as axis (axis.code)}
									<div class="rounded-lg border border-border/80 bg-background p-4 shadow-sm">
										<div class="flex flex-wrap items-baseline justify-between gap-2">
											<div>
												<p class="text-sm font-semibold text-foreground">{axis.code}</p>
												<p class="text-xs text-muted-foreground">{axisSummaries[axis.code]}</p>
											</div>
											<div class="text-right">
												<p class="text-sm font-semibold text-foreground">
													Score {axis.score_0_to_4}
												</p>
												<p class="text-xs text-muted-foreground">
													Weight {formatNumber(weightFor(axis.code), 2)} · Contribution
													{formatNumber(contributionFor(axis.code, axis.score_0_to_4), 3)}
												</p>
											</div>
										</div>
										<p class="mt-3 text-sm text-muted-foreground">{axis.rationale}</p>

										{#if axis.spans.length}
											<div class="mt-3 space-y-2">
												<p
													class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
												>
													Evidence
												</p>
												{#each axis.spans as span, index (`${axis.code}-${index}`)}
													<blockquote
														class="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground"
													>
														“{span.quote}”
														<span
															class="ml-2 text-[11px] tracking-wide text-muted-foreground/80 uppercase"
														>
															chars {span.char_start}–{span.char_end}
														</span>
													</blockquote>
												{/each}
											</div>
										{/if}

										{#if autoSignalEntries(axis.auto_signals).length}
											<div class="mt-3 space-y-1">
												<p
													class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
												>
													Auto signals
												</p>
												<ul class="text-sm text-muted-foreground">
													{#each autoSignalEntries(axis.auto_signals) as entry, index (`signal-${axis.code}-${index}`)}
														<li>
															<span class="font-medium text-foreground">{entry[0]}:</span>
															<span class="ml-1">{entry[1]}</span>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</section>
					</Card.Content>
				</Card.Root>

				<div class="grid gap-6">
					<Card.Root>
						<Card.Header class="space-y-2">
							<Card.Title>Automatic signals</Card.Title>
							<Card.Description>Metrics computed locally before the LLM call.</Card.Description>
						</Card.Header>
						<Card.Content>
							<dl class="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Tokens
									</dt>
									<dd class="text-sm text-foreground">{formState.response.autoSignals.tokens}</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Sentences
									</dt>
									<dd class="text-sm text-foreground">
										{formState.response.autoSignals.sentences}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Entropy mean / CV
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.info_entropy_mean, 3)} /
										{formatNumber(formState.response.autoSignals.info_entropy_cv, 3)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Idea density
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.idea_density, 3)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Compression ratio
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.repetition_compression_ratio, 3)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Templates per token
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.templates_per_token, 3)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Subjective lexicon ratio
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.subj_lexicon_ratio, 3)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Avg sentence length
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.avg_sentence_len, 2)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Flesch reading ease
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.flesch_reading_ease, 2)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Flesch-Kincaid grade
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.fk_grade, 2)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Gunning fog
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.gunning_fog, 2)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Complex word ratio
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.complex_word_ratio, 3)}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Syllables per word
									</dt>
									<dd class="text-sm text-foreground">
										{formatNumber(formState.response.autoSignals.syllables_per_word, 3)}
									</dd>
								</div>
							</dl>
						</Card.Content>
					</Card.Root>

					<Card.Root>
						<Card.Header class="space-y-2">
							<Card.Title>Domain weights</Card.Title>
							<Card.Description
								>Weights used to compute the weighted risk for this domain.</Card.Description
							>
						</Card.Header>
						<Card.Content>
							<ul class="space-y-2 text-sm text-muted-foreground">
								{#each Object.entries(formState.response.weightedRisk.weights) as item (item[0])}
									<li>
										<span class="font-medium text-foreground">{item[0]}:</span>
										<span class="ml-1">{formatNumber(item[1] ?? 0, 2)}</span>
									</li>
								{/each}
							</ul>
						</Card.Content>
					</Card.Root>
				</div>
			</div>
		{/key}
	{/if}
</div>
