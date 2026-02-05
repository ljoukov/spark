<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const agents = $derived(data.agents);

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

<Card.Root class="border-border/70 bg-card/95 shadow-sm">
	<Card.Header>
		<Card.Title>Agent runs</Card.Title>
		<Card.Description>
			{#if agents.length === 0}
				No agent runs found.
			{:else}
				Showing {agents.length} run{agents.length === 1 ? '' : 's'}.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each agents as agent (agent.id)}
			<div class="rounded-xl border border-border/70 p-4">
				<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<a
								href={`/admin/users/${data.user.uid}/agents/${agent.id}`}
								class="text-sm font-semibold text-foreground hover:underline"
							>
								<span class="font-mono">{agent.id}</span>
							</a>
							<span
								class={cn(
									'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
									statusBadgeClass(agent.status)
								)}
							>
								{agent.status}
							</span>
							{#if agent.stopRequested}
								<span class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
									stop requested
								</span>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">
							Workspace: <span class="font-mono">{agent.workspaceId}</span>
						</p>
						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Created</span>
								<span class="ml-1">{formatInstant(agent.createdAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Updated</span>
								<span class="ml-1">{formatInstant(agent.updatedAt)}</span>
							</p>
						</div>
						{#if agent.promptPreview}
							<p class="pt-1 text-xs text-muted-foreground">{agent.promptPreview}</p>
						{/if}
						{#if agent.error}
							<p class="pt-1 text-xs text-destructive">{agent.error}</p>
						{/if}
					</div>

					<Button href={`/admin/users/${data.user.uid}/agents/${agent.id}`} variant="secondary" size="sm">
						View
					</Button>
				</div>
			</div>
		{/each}
	</Card.Content>
</Card.Root>

