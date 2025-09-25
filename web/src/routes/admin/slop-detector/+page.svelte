<script lang="ts">
        import { enhance } from '$app/forms';
        import { page } from '$app/stores';
        import type { SubmitFunction } from '@sveltejs/kit';
        import { onDestroy } from 'svelte';

        import * as Card from '$lib/components/ui/card/index.js';
        import { Button } from '$lib/components/ui/button/index.js';
        import { cn } from '$lib/utils.js';
        import type { ActionData, PageData } from './$types';

        let { data }: { data: PageData } = $props();

        const $page = page;
        const actionState = $derived(($page.form as ActionData | undefined) ?? null);
        const result = $derived(actionState && actionState.success ? actionState.result : null);
        const runValues = $derived(actionState && actionState.success ? actionState.values : null);
        const errors = $derived(actionState && !actionState.success ? actionState.errors ?? {} : {});
        const message = $derived(actionState && !actionState.success ? actionState.message ?? '' : '');

        let formValues = $state({
                domain: data.domains[0] ?? 'qa',
                title: '',
                context: '',
                text: ''
        });

        const submitting = $state(false);

        const submittedTitle = $derived(runValues?.title?.trim() ? runValues.title.trim() : null);
        const submittedContext = $derived(runValues?.context?.trim() ? runValues.context.trim() : null);

        $effect(() => {
                if (actionState?.values) {
                        if (actionState.values.domain) {
                                formValues.domain = actionState.values.domain;
                        }
                        if (typeof actionState.values.title === 'string') {
                                formValues.title = actionState.values.title;
                        }
                        if (typeof actionState.values.context === 'string') {
                                formValues.context = actionState.values.context;
                        }
                        if (typeof actionState.values.text === 'string') {
                                formValues.text = actionState.values.text;
                        }
                }
        });

        const submit: SubmitFunction<ActionData> = ({ pending, update }) => {
                const unsubscribe = pending.subscribe((value) => {
                        submitting = value;
                });
                return async ({ result }) => {
                        unsubscribe();
                        await update({ reset: false });
                        return result;
                };
        };

        onDestroy(() => {
                submitting = false;
        });

        function formatLabel(label: 0 | 1): string {
                return label === 1 ? 'Slop' : 'Clean';
        }
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Card.Root>
                <Card.Header>
                        <Card.Title>Slop detector</Card.Title>
                        <Card.Description>
                                Run the span-based slop rubric against any text snippet. Auto-signals are computed locally and
                                passed into the judge prompt.
                        </Card.Description>
                </Card.Header>
                <Card.Content>
                        <form method="POST" class="space-y-4" use:enhance={submit}>
                                <div class="grid gap-4 md:grid-cols-2">
                                        <div class="space-y-2">
                                                <label class="text-sm font-medium" for="domain">Domain</label>
                                                <select
                                                        id="domain"
                                                        name="domain"
                                                        class="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                                                        bind:value={formValues.domain}
                                                >
                                                        {#each data.domains as domainOption}
                                                                <option value={domainOption}>{domainOption.toUpperCase()}</option>
                                                        {/each}
                                                </select>
                                                {#if errors.domain}
                                                        <p class="text-xs text-destructive">{errors.domain.join('. ')}</p>
                                                {/if}
                                        </div>
                                        <div class="space-y-2">
                                                <label class="text-sm font-medium" for="title">Optional label</label>
                                                <input
                                                        id="title"
                                                        name="title"
                                                        type="text"
                                                        class="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                                                        placeholder="e.g. Physics homework excerpt"
                                                        bind:value={formValues.title}
                                                />
                                                {#if errors.title}
                                                        <p class="text-xs text-destructive">{errors.title.join('. ')}</p>
                                                {/if}
                                        </div>
                                </div>
                                <div class="space-y-2">
                                        <label class="text-sm font-medium" for="context">Context</label>
                                        <textarea
                                                id="context"
                                                name="context"
                                                rows="3"
                                                class="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                                                placeholder="Describe the task or audience (optional)."
                                                bind:value={formValues.context}
                                        />
                                        {#if errors.context}
                                                <p class="text-xs text-destructive">{errors.context.join('. ')}</p>
                                        {/if}
                                </div>
                                <div class="space-y-2">
                                        <label class="text-sm font-medium" for="text">Text to evaluate</label>
                                        <textarea
                                                id="text"
                                                name="text"
                                                rows="12"
                                                required
                                                class="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                                                bind:value={formValues.text}
                                                placeholder="Paste the passage you want to analyse..."
                                        />
                                        {#if errors.text}
                                                <p class="text-xs text-destructive">{errors.text.join('. ')}</p>
                                        {/if}
                                </div>
                                {#if message}
                                        <p class="text-sm text-destructive">{message}</p>
                                {/if}
                                <div class="flex justify-end">
                                        <Button type="submit" disabled={submitting} class={cn(submitting ? 'opacity-80' : '')}>
                                                {#if submitting}
                                                        Analysing…
                                                {:else}
                                                        Run slop detector
                                                {/if}
                                        </Button>
                                </div>
                        </form>
                </Card.Content>
        </Card.Root>

        {#if result}
                <Card.Root>
                        <Card.Header>
                                <Card.Title>Overall assessment</Card.Title>
                                <Card.Description>
                                        <p>
                                                Domain-weighted risk score {result.riskScore.toFixed(3)} (threshold
                                                {result.threshold.toFixed(2)}).
                                        </p>
                                        {#if submittedTitle || submittedContext}
                                                <p class="mt-1 text-xs">
                                                        {#if submittedTitle}
                                                                Label:
                                                                <span class="font-medium text-foreground">{submittedTitle}</span>
                                                        {/if}
                                                        {#if submittedContext}
                                                                {#if submittedTitle}
                                                                        <span class="px-1 text-muted-foreground">•</span>
                                                                {/if}
                                                                Context provided
                                                        {/if}
                                                </p>
                                        {/if}
                                </Card.Description>
                        </Card.Header>
                        <Card.Content class="grid gap-4 text-sm md:grid-cols-2">
                                <div class="rounded-lg border border-border/60 bg-muted/30 p-4">
                                        <p class="text-xs font-semibold uppercase text-muted-foreground">Model verdict</p>
                                        <p class="mt-2 text-lg font-semibold">
                                                {formatLabel(result.judgement.overall_slop.label)}
                                                <span class="ml-2 text-sm font-normal text-muted-foreground">
                                                        confidence {result.judgement.overall_slop.confidence.toFixed(2)}
                                                </span>
                                        </p>
                                        <p class="text-sm text-muted-foreground">Annoyance score {result.judgement.annoyance}/5</p>
                                </div>
                                <div class="rounded-lg border border-border/60 bg-muted/30 p-4">
                                        <p class="text-xs font-semibold uppercase text-muted-foreground">Weighted recommendation</p>
                                        <p class="mt-2 text-lg font-semibold">
                                                {formatLabel(result.recommendedLabel)}
                                                {#if result.recommendedLabel !== result.judgement.overall_slop.label}
                                                        <span class="ml-2 text-xs rounded-full bg-yellow-200 px-2 py-0.5 font-semibold text-yellow-900">
                                                                Mismatch
                                                        </span>
                                                {/if}
                                        </p>
                                        <p class="text-sm text-muted-foreground">
                                                Domain {result.judgement.domain.toUpperCase()} · Risk {result.riskScore.toFixed(3)}
                                        </p>
                                </div>
                        </Card.Content>
                </Card.Root>

                {#if runValues?.text}
                        <Card.Root>
                                <Card.Header>
                                        <Card.Title>Submitted text</Card.Title>
                                        <Card.Description>
                                                Review the exact input analysed by the judge.
                                        </Card.Description>
                                </Card.Header>
                                <Card.Content class="space-y-3 text-sm">
                                        {#if submittedContext}
                                                <div class="rounded-lg border border-border/60 bg-muted/20 p-3">
                                                        <p class="text-xs font-semibold uppercase text-muted-foreground">
                                                                Context
                                                        </p>
                                                        <p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                                                                {submittedContext}
                                                        </p>
                                                </div>
                                        {/if}
                                        <details class="rounded-lg border border-border/60 bg-muted/20 p-3">
                                                <summary class="cursor-pointer font-semibold">View evaluated text</summary>
                                                <pre class="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{runValues.text}</pre>
                                        </details>
                                </Card.Content>
                        </Card.Root>
                {/if}

                <Card.Root>
                        <Card.Header>
                                <Card.Title>Auto signals</Card.Title>
                                <Card.Description>Objective metrics passed into the judge prompt.</Card.Description>
                        </Card.Header>
                        <Card.Content class="grid gap-2 text-sm md:grid-cols-2 lg:grid-cols-3">
                                {#each Object.entries(result.autoSignals) as [key, value]}
                                        <div class="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                                                <p class="text-xs font-semibold uppercase text-muted-foreground">{key}</p>
                                                <p class="font-medium">{value}</p>
                                        </div>
                                {/each}
                        </Card.Content>
                </Card.Root>

                <Card.Root>
                        <Card.Header>
                                <Card.Title>Axis breakdown</Card.Title>
                                <Card.Description>Scores, rationales, and supporting spans for each rubric axis.</Card.Description>
                        </Card.Header>
                        <Card.Content class="overflow-x-auto">
                                <table class="min-w-full border-separate border-spacing-y-3 text-sm">
                                        <thead>
                                                <tr class="text-left text-xs uppercase text-muted-foreground">
                                                        <th class="px-2">Axis</th>
                                                        <th class="px-2">Score</th>
                                                        <th class="px-2">Rationale</th>
                                                        <th class="px-2">Spans</th>
                                                </tr>
                                        </thead>
                                        <tbody>
                                                {#each result.judgement.axes as axis}
                                                        <tr class="align-top">
                                                                <td class="whitespace-nowrap px-2 font-semibold">{axis.code}</td>
                                                                <td class="px-2">{axis.score_0_to_4.toFixed(1)}</td>
                                                                <td class="px-2 text-sm text-muted-foreground">{axis.rationale}</td>
                                                                <td class="px-2">
                                                                        {#if axis.spans.length === 0}
                                                                                <p class="text-xs text-muted-foreground">No spans returned</p>
                                                                        {:else}
                                                                                <ul class="space-y-2 text-xs text-muted-foreground">
                                                                                        {#each axis.spans as span}
                                                                                                <li class="rounded bg-muted/40 p-2">
                                                                                                        <p class="font-medium text-foreground">“{span.quote.trim()}”</p>
                                                                                                        <p class="mt-1">Chars {span.char_start}–{span.char_end}</p>
                                                                                                </li>
                                                                                        {/each}
                                                                                </ul>
                                                                        {/if}
                                                                </td>
                                                        </tr>
                                                {/each}
                                        </tbody>
                                </table>
                        </Card.Content>
                </Card.Root>

                <Card.Root>
                        <Card.Header>
                                <Card.Title>Recommended fixes</Card.Title>
                                <Card.Description>Short, high-impact suggestions from the judge.</Card.Description>
                        </Card.Header>
                        <Card.Content>
                                {#if result.judgement.top_fixes.length === 0}
                                        <p class="text-sm text-muted-foreground">No fixes were suggested.</p>
                                {:else}
                                        <ul class="list-disc space-y-2 pl-5 text-sm">
                                                {#each result.judgement.top_fixes as fix}
                                                        <li>{fix}</li>
                                                {/each}
                                        </ul>
                                {/if}
                        </Card.Content>
                </Card.Root>

                <Card.Root>
                        <Card.Header>
                                <Card.Title>Raw judgement JSON</Card.Title>
                                <Card.Description>Useful for debugging or exporting.</Card.Description>
                        </Card.Header>
                        <Card.Content>
                                <details class="rounded-lg border bg-muted/20 p-4 text-sm">
                                        <summary class="cursor-pointer font-medium">Show JSON payload</summary>
                                        <pre class="mt-3 max-h-96 overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed">{JSON.stringify(result.judgement, null, 2)}</pre>
                                </details>
                        </Card.Content>
                </Card.Root>
        {/if}
</div>
