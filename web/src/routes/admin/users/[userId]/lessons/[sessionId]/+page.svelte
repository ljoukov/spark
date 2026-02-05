<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const session = $derived(data.session);
	const planItems = $derived(data.planItems);
	const completion = $derived(data.completion);
	const sessionDocFound = $derived(data.sessionDocFound);

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
		if (status === 'completed') {
			return 'bg-emerald-100 text-emerald-800 border-emerald-200';
		}
		if (status === 'in_progress') {
			return 'bg-sky-100 text-sky-800 border-sky-200';
		}
		if (status === 'ready') {
			return 'bg-muted text-muted-foreground border-border';
		}
		if (status === 'generating') {
			return 'bg-amber-100 text-amber-800 border-amber-200';
		}
		if (status === 'error') {
			return 'bg-destructive/10 text-destructive border-destructive/30';
		}
		return 'bg-muted text-muted-foreground border-border';
	}

	function itemStatusBadgeClass(status: string): string {
		if (status === 'completed') {
			return 'bg-emerald-100 text-emerald-800 border-emerald-200';
		}
		if (status === 'in_progress') {
			return 'bg-sky-100 text-sky-800 border-sky-200';
		}
		return 'bg-muted text-muted-foreground border-border';
	}
</script>

{#if !sessionDocFound}
	<p class="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
		Lesson document not found. Showing read-only view for this ID anyway.
	</p>
{/if}

<Card.Root class="border-border/70 bg-card/95 shadow-sm">
	<Card.Header>
		<Card.Title>Lesson</Card.Title>
		<Card.Description>Read-only view of the session and its progress state.</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		<div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
			<div class="space-y-1">
				<div class="flex flex-wrap items-center gap-2">
					<p class="text-base font-semibold text-foreground">
						<span class="mr-1">{session.emoji}</span>{session.title}
					</p>
					<span
						class={cn(
							'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
							statusBadgeClass(session.status)
						)}
					>
						{session.status}
					</span>
				</div>
				<p class="text-xs text-muted-foreground">
					<span class="font-mono">{session.id}</span>
				</p>
			</div>
		</div>

		<div class="grid gap-3 md:grid-cols-2">
			<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
				<p class="text-xs text-muted-foreground">Created</p>
				<p class="mt-1 text-sm">{formatInstant(session.createdAt)}</p>
			</div>
			<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
				<p class="text-xs text-muted-foreground">Last progress</p>
				<p class="mt-1 text-sm">{formatInstant(data.lastProgressAt)}</p>
			</div>
			<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
				<p class="text-xs text-muted-foreground">Completion</p>
				<p class="mt-1 text-sm">{completion.completed}/{completion.total} steps</p>
			</div>
			<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
				<p class="text-xs text-muted-foreground">Topics</p>
				<p class="mt-1 text-sm">
					{#if session.topics.length === 0}
						—
					{:else}
						{session.topics.join(', ')}
					{/if}
				</p>
			</div>
		</div>

		{#if session.tagline}
			<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
				<p class="text-xs text-muted-foreground">Tagline</p>
				<p class="mt-1 text-sm">{session.tagline}</p>
			</div>
		{/if}

		{#if session.summary}
			<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
				<p class="text-xs text-muted-foreground">Summary</p>
				<p class="mt-1 whitespace-pre-wrap text-sm">{session.summary}</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<Card.Root class="border-border/70 bg-card/95 shadow-sm">
	<Card.Header>
		<Card.Title>Plan</Card.Title>
		<Card.Description>
			{#if planItems.length === 0}
				No plan items found.
			{:else}
				{planItems.length} item{planItems.length === 1 ? '' : 's'}.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each planItems as item (item.id)}
			<div class="rounded-xl border border-border/70 p-4">
				<div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
					<div class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<p class="text-sm font-semibold text-foreground">{item.title}</p>
							<span
								class={cn(
									'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
									itemStatusBadgeClass(item.state.status)
								)}
							>
								{item.state.status}
							</span>
							<span class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
								{item.kind}
							</span>
						</div>
						<p class="text-xs text-muted-foreground">
							<span class="font-mono">{item.id}</span>
						</p>
						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Started</span>
								<span class="ml-1">{formatInstant(item.state.startedAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Completed</span>
								<span class="ml-1">{formatInstant(item.state.completedAt)}</span>
							</p>
						</div>
						{#if item.summary}
							<p class="pt-1 text-xs text-muted-foreground">{item.summary}</p>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</Card.Content>
</Card.Root>

