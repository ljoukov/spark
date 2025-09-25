<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { SlopJudgeResult } from '$lib/server/llm/slopJudge';

	type Domain = 'news' | 'qa' | 'other';

	const form = $state({
		text: '',
		context: '',
		domain: 'qa' as Domain
	});

	const state = $state({
		loading: false,
		error: '',
		validation: {} as Record<string, string[]>,
		result: null as SlopJudgeResult | null,
		autoSignals: [] as Array<[string, number]>
	});

	function resetError(): void {
		state.error = '';
		state.validation = {};
	}

	function formatAutoSignalName(key: string): string {
		return key.replace(/_/g, ' ');
	}

	function describeSlopLabel(label: 0 | 1): string {
		return label === 1 ? 'Flagged' : 'Clear';
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

	async function runAnalysis(): Promise<void> {
		resetError();
		state.loading = true;
		try {
			const response = await fetch('/admin/slop-lab/analyse', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					text: form.text,
					context: form.context || undefined,
					domain: form.domain
				})
			});
			const payload = await response.json();
			if (!response.ok) {
				state.result = null;
				state.autoSignals = [];
				state.error = typeof payload.error === 'string' ? payload.error : 'Analysis failed.';
				if (payload.issues?.fieldErrors) {
					state.validation = payload.issues.fieldErrors as Record<string, string[]>;
				}
				return;
			}
			state.result = payload.result as SlopJudgeResult;
			const signals = payload.autoSignals as Record<string, number> | undefined;
			state.autoSignals = signals
				? Object.entries(signals).sort(([a], [b]) => a.localeCompare(b))
				: [];
		} catch (error) {
			state.error = error instanceof Error ? error.message : 'Unable to run slop detection.';
			state.result = null;
			state.autoSignals = [];
		} finally {
			state.loading = false;
		}
	}

	const sampleText = `Spark revision notes emphasise the role of enzymes in digestion. They explain how temperature and pH affect enzyme activity and why denaturation prevents substrates from binding.`;

	onMount(() => {
		if (!form.text) {
			form.text = sampleText;
		}
	});
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold tracking-tight">Slop lab</h1>
		<p class="text-sm text-muted-foreground">
			Paste any passage to run the multi-axis slop detection judge. Automatic metrics feed into the
			prompt so you can triage weak content quickly.
		</p>
	</header>

	<Card.Root>
		<Card.Header>
			<Card.Title>Evaluate text</Card.Title>
			<Card.Description
				>Runs the hybrid rubric and auto-signal prompt against your input.</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<form
				class="space-y-4"
				onsubmit={(event) => {
					event.preventDefault();
					void runAnalysis();
				}}
			>
				<div class="grid gap-2">
					<label class="text-sm font-medium" for="slop-domain">Domain</label>
					<select
						id="slop-domain"
						class="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
						bind:value={form.domain}
						onchange={resetError}
					>
						<option value="qa">QA / short answer</option>
						<option value="news">News / report</option>
						<option value="other">Other</option>
					</select>
				</div>
				<div class="grid gap-2">
					<label class="text-sm font-medium" for="slop-context">Context</label>
					<Input
						id="slop-context"
						placeholder="Optional prompt or scenario for the judge"
						value={form.context}
						oninput={(event) => {
							form.context = event.currentTarget.value;
							resetError();
						}}
					/>
				</div>
				<div class="grid gap-2">
					<label class="text-sm font-medium" for="slop-text">Text to evaluate</label>
					<textarea
						id="slop-text"
						rows={10}
						class="min-h-[12rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
						bind:value={form.text}
						oninput={resetError}
					></textarea>
					{#if state.validation.text?.length}
						<p class="text-xs text-destructive">{state.validation.text[0]}</p>
					{/if}
				</div>
				{#if state.error}
					<p class="text-sm text-destructive">{state.error}</p>
				{/if}
				<Button type="submit" disabled={state.loading}>
					{state.loading ? 'Analysing…' : 'Run slop detection'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	{#if state.result}
		<Card.Root>
			<Card.Header>
				<Card.Title>Judge verdict</Card.Title>
				<Card.Description>
					{formatTimestamp(state.result.evaluatedAt)} · {state.result.modelId}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4 text-sm">
				<div>
					<p class="font-semibold">
						{describeSlopLabel(state.result.verdict.overall.label)}
						<span class="ml-2 text-xs text-muted-foreground">
							confidence {state.result.verdict.overall.confidence.toFixed(2)} · annoyance {state
								.result.verdict.annoyance}
						</span>
					</p>
					<p class="mt-1 text-xs tracking-wide text-muted-foreground uppercase">
						Domain: {state.result.verdict.domain}
					</p>
				</div>
				{#if state.result.verdict.topFixes.length}
					<div>
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							Top fixes
						</h3>
						<ul class="mt-2 space-y-1">
							{#each state.result.verdict.topFixes as fix, fixIndex (fixIndex)}
								<li>• {fix}</li>
							{/each}
						</ul>
					</div>
				{/if}
				<div>
					<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Axes</h3>
					<div class="mt-2 overflow-x-auto">
						<table class="w-full min-w-[32rem] text-left text-xs">
							<thead class="text-muted-foreground">
								<tr>
									<th class="px-2 py-1 font-medium">Axis</th>
									<th class="px-2 py-1 font-medium">Score</th>
									<th class="px-2 py-1 font-medium">Rationale</th>
									<th class="px-2 py-1 font-medium">Spans</th>
								</tr>
							</thead>
							<tbody>
								{#each state.result.verdict.axes as axis (axis.code)}
									<tr class="border-t text-foreground">
										<td class="px-2 py-2 font-medium">{axis.code}</td>
										<td class="px-2 py-2">{axis.score.toFixed(1)}</td>
										<td class="px-2 py-2 text-muted-foreground">{axis.rationale}</td>
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
					<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Auto signals
					</h3>
					<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3">
						{#each state.autoSignals as [name, value] (name)}
							<div>
								<dt class="font-medium text-foreground">{formatAutoSignalName(name)}</dt>
								<dd class="text-muted-foreground">{value}</dd>
							</div>
						{/each}
					</dl>
				</div>
				<details class="rounded-lg border bg-muted/20 p-3 text-xs">
					<summary class="cursor-pointer font-semibold tracking-wide uppercase"
						>Prompt excerpt</summary
					>
					<pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
{state.result.prompt}
                                        </pre>
				</details>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
