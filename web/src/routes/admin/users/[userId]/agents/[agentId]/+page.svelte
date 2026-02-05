<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const agent = $derived(data.agent);
	const files = $derived(data.files);
	const log = $derived(data.log);

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

	function formatBytes(bytes: number | null): string {
		if (bytes === null) {
			return '—';
		}
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const kb = bytes / 1024;
		if (kb < 1024) {
			return `${kb.toFixed(1)} KB`;
		}
		const mb = kb / 1024;
		if (mb < 1024) {
			return `${mb.toFixed(1)} MB`;
		}
		const gb = mb / 1024;
		return `${gb.toFixed(1)} GB`;
	}
</script>

{#if !data.agentDocFound}
	<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
		Agent run not found.
	</p>
{:else if !data.agentParseOk}
	<p class="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
		Agent run exists but could not be parsed. ({data.parseIssues.length} issue{data.parseIssues.length === 1 ? '' : 's'})
	</p>
{/if}

{#if data.parseIssues.length > 0}
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Parse issues</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-2 text-sm">
			{#each data.parseIssues as issue (issue.path + issue.message)}
				<p class="font-mono text-xs text-muted-foreground">
					<span class="text-foreground">{issue.path || '(root)'}</span>: {issue.message}
				</p>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}

{#if agent}
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Agent run</Card.Title>
			<Card.Description>Read-only view of the run state, logs, and workspace.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-wrap items-center gap-2">
				<p class="font-mono text-xs break-all">{agent.id}</p>
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

			<div class="grid gap-3 md:grid-cols-2">
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Workspace</p>
					<p class="mt-1 font-mono text-xs break-all">{agent.workspaceId}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Created</p>
					<p class="mt-1 text-sm">{formatInstant(agent.createdAt)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Updated</p>
					<p class="mt-1 text-sm">{formatInstant(agent.updatedAt)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Timeline entries</p>
					<p class="mt-1 text-sm">{agent.statesTimeline.length}</p>
				</div>
			</div>

			<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
				<p class="text-xs font-semibold text-foreground">Prompt</p>
				<pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-foreground">{agent.prompt}</pre>
			</div>

			{#if agent.resultSummary}
				<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
					<p class="text-xs font-semibold text-foreground">Result summary</p>
					<p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{agent.resultSummary}</p>
				</div>
			{/if}

			{#if agent.error}
				<div class="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
					<p class="text-xs font-semibold text-destructive">Error</p>
					<p class="mt-2 whitespace-pre-wrap text-sm text-destructive">{agent.error}</p>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Status timeline</Card.Title>
			<Card.Description>Recorded status transitions for this run.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-2">
			{#each agent.statesTimeline as entry (entry.timestamp)}
				<div class="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/10 px-3 py-2">
					<p class="text-xs font-medium text-foreground">{entry.state}</p>
					<p class="text-xs text-muted-foreground">{formatInstant(entry.timestamp)}</p>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Workspace files</Card.Title>
			<Card.Description>
				{#if files.length === 0}
					No workspace files found.
				{:else}
					{files.length} file{files.length === 1 ? '' : 's'}.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-2">
			{#each files as file (file.path)}
				<div class="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/10 p-3 md:flex-row md:items-start md:justify-between">
					<div class="min-w-0 space-y-1">
						<p class="truncate font-mono text-xs text-foreground">{file.path}</p>
						<p class="text-xs text-muted-foreground">
							{file.contentType ?? '—'} · {formatBytes(file.sizeBytes)} · updated {formatInstant(file.updatedAt)}
						</p>
					</div>
					<Button
						href={`/admin/users/${data.user.uid}/agents/${agent.id}/files/${file.fileId}`}
						variant="secondary"
						size="sm"
					>
						View
					</Button>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Run logs</Card.Title>
			<Card.Description>
				{#if log}
					{log.lines.length} line{log.lines.length === 1 ? '' : 's'} (latest).
				{:else}
					No log document found (yet).
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if log?.stream}
				<div class="grid gap-3 md:grid-cols-2">
					<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
						<p class="text-xs font-semibold text-foreground">Assistant stream</p>
						<pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-foreground">{log.stream.assistant || '—'}</pre>
					</div>
					<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
						<p class="text-xs font-semibold text-foreground">Thought stream</p>
						<pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-foreground">{log.stream.thoughts || '—'}</pre>
					</div>
				</div>
			{/if}

			{#if log?.stats}
				<div class="grid gap-3 md:grid-cols-3">
					<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
						<p class="text-xs text-muted-foreground">Total tokens</p>
						<p class="mt-1 text-sm">{log.stats.tokens.totalTokens}</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
						<p class="text-xs text-muted-foreground">Tool calls</p>
						<p class="mt-1 text-sm">{log.stats.toolCalls}</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
						<p class="text-xs text-muted-foreground">Total cost (USD)</p>
						<p class="mt-1 text-sm">{log.stats.totalCostUsd.toFixed(4)}</p>
					</div>
				</div>
			{/if}

			{#if log && log.lines.length > 0}
				<div class="max-h-96 overflow-auto rounded-md border border-border/70 bg-muted/10 p-3">
					{#each log.lines as entry (entry.key)}
						<p class="font-mono text-[11px] leading-relaxed text-muted-foreground">
							<span class="text-foreground/80">{formatInstant(entry.timestamp)}</span> {entry.line}
						</p>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}

