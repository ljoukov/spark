<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const file = $derived(data.file);

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

<div class="flex flex-wrap gap-2">
	<Button href={`/admin/users/${data.user.uid}/agents/${data.agentId}`} variant="secondary" size="sm">
		Back to agent run
	</Button>
</div>

{#if !data.agentDocFound}
	<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
		Agent run not found.
	</p>
{:else if !data.agentParseOk}
	<p class="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
		Agent run exists but could not be parsed.
	</p>
{:else if !data.fileDocFound}
	<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
		File not found in workspace.
	</p>
{:else if !data.fileParseOk}
	<p class="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
		File exists but could not be parsed. ({data.parseIssues.length} issue{data.parseIssues.length === 1 ? '' : 's'})
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

{#if file}
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Workspace file</Card.Title>
			<Card.Description>Read-only view of workspace file contents.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="grid gap-3 md:grid-cols-2">
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Path</p>
					<p class="mt-1 font-mono text-xs break-all">{file.path}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Type · Size</p>
					<p class="mt-1 text-sm">{file.contentType ?? '—'} · {formatBytes(file.sizeBytes)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Created</p>
					<p class="mt-1 text-sm">{formatInstant(file.createdAt)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Updated</p>
					<p class="mt-1 text-sm">{formatInstant(file.updatedAt)}</p>
				</div>
			</div>

			<pre class="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/10 p-4 text-xs text-foreground">{file.content}</pre>
		</Card.Content>
	</Card.Root>
{/if}
