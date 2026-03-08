<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	const runs = $derived(data.runs);
	const successMessage = $derived(form?.success?.message ?? '');
	const errorMessage = $derived(form?.error ?? '');

	function formatInstant(value: string | null): string {
		if (!value) {
			return '—';
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString();
	}

	function formatMarks(awarded: number, max: number): string {
		return `${awarded.toString()}/${max.toString()}`;
	}

	function formatPercent(value: number | null): string {
		if (value === null || !Number.isFinite(value)) {
			return '—';
		}
		return `${value.toFixed(1)}%`;
	}

	function statusBadgeClass(status: string): string {
		if (status === 'done') {
			return 'bg-emerald-100 text-emerald-800 border-emerald-200';
		}
		if (status === 'executing') {
			return 'bg-sky-100 text-sky-800 border-sky-200';
		}
		if (status === 'created') {
			return 'bg-muted text-muted-foreground border-border';
		}
		if (status === 'stopped') {
			return 'bg-amber-100 text-amber-800 border-amber-200';
		}
		if (status === 'failed') {
			return 'bg-destructive/10 text-destructive border-destructive/30';
		}
		return 'bg-muted text-muted-foreground border-border';
	}
</script>

{#if successMessage}
	<p
		class="rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
	>
		{successMessage}
	</p>
{:else if errorMessage}
	<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
		{errorMessage}
	</p>
{/if}

<Card.Root class="border-border/70 bg-card/95 shadow-sm">
	<Card.Header>
		<Card.Title>Graders</Card.Title>
		<Card.Description>
			{#if runs.length === 0}
				No grader runs found.
			{:else}
				Showing {runs.length} run{runs.length === 1 ? '' : 's'}.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each runs as run (run.id)}
			<div class="rounded-xl border border-border/70 p-4">
				<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div class="min-w-0 space-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<p class="font-mono text-xs break-all">{run.id}</p>
							<span
								class={cn(
									'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
									statusBadgeClass(run.status)
								)}
							>
								{run.status}
							</span>
						</div>

						<p class="text-sm font-semibold text-foreground">
							{run.paper?.paperName ?? run.paper?.contextLabel ?? run.olympiadLabel}
						</p>

						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Agent</span>
								<span class="ml-1 font-mono break-all">{run.agentId}</span>
							</p>
							<p>
								<span class="text-foreground/70">Workspace</span>
								<span class="ml-1 font-mono break-all">{run.workspaceId}</span>
							</p>
							<p>
								<span class="text-foreground/70">Created</span>
								<span class="ml-1">{formatInstant(run.createdAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Updated</span>
								<span class="ml-1">{formatInstant(run.updatedAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Completed</span>
								<span class="ml-1">{formatInstant(run.completedAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Attachments</span>
								<span class="ml-1">{run.sourceAttachmentCount}</span>
							</p>
							<p>
								<span class="text-foreground/70">Problems</span>
								<span class="ml-1">{run.totals ? run.totals.problemCount : run.problems.length}</span>
							</p>
							<p>
								<span class="text-foreground/70">Marks</span>
								<span class="ml-1">
									{#if run.totals}
										{formatMarks(run.totals.awardedMarks, run.totals.maxMarks)} ({formatPercent(
											run.totals.percentage
										)})
									{:else}
										—
									{/if}
								</span>
							</p>
						</div>

						{#if run.error}
							<p class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
								{run.error}
							</p>
						{:else if run.resultSummary}
							<p class="rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
								{run.resultSummary}
							</p>
						{/if}

						<details class="rounded-md border border-border/70 bg-muted/10">
							<summary class="cursor-pointer px-3 py-2 text-xs font-medium text-foreground">
								Raw run data
							</summary>
							<pre
								class="max-h-96 overflow-auto border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground"
							>{run.rawJson}</pre>
						</details>
					</div>

					<form method="POST" action="?/deleteRun">
						<input type="hidden" name="runId" value={run.id} />
						<Button
							type="submit"
							variant="destructive"
							size="sm"
							onclick={(event) => {
								if (!confirm('Delete this grader run document? This cannot be undone.')) {
									event.preventDefault();
								}
							}}
						>
							Delete
						</Button>
					</form>
				</div>
			</div>
		{/each}
	</Card.Content>
</Card.Root>
