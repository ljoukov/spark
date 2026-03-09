<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	const sessions = $derived(data.sessions);
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

	function formatMarks(awarded: number | null, max: number | null): string {
		if (awarded === null || max === null) {
			return '—';
		}
		return `${awarded.toString()}/${max.toString()}`;
	}

	function statusBadgeClass(status: string): string {
		if (status === 'completed') {
			return 'bg-emerald-100 text-emerald-800 border-emerald-200';
		}
		if (status === 'awaiting_student') {
			return 'bg-amber-100 text-amber-800 border-amber-200';
		}
		if (status === 'responding') {
			return 'bg-sky-100 text-sky-800 border-sky-200';
		}
		if (status === 'booting') {
			return 'bg-muted text-muted-foreground border-border';
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
		<Card.Title>Tutors</Card.Title>
		<Card.Description>
			{#if sessions.length === 0}
				No tutor sessions found.
			{:else}
				Showing {sessions.length} session{sessions.length === 1 ? '' : 's'}.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each sessions as session (session.id)}
			<div class="rounded-xl border border-border/70 p-4">
				<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div class="min-w-0 space-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<p class="font-mono text-xs break-all">{session.id}</p>
							<span
								class={cn(
									'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
									statusBadgeClass(session.status)
								)}
							>
								{session.status}
							</span>
						</div>

						<p class="text-sm font-semibold text-foreground">{session.title}</p>
						<p class="text-xs text-muted-foreground">
							Problem {session.source.problemIndex}. {session.source.problemTitle}
						</p>

						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Workspace</span>
								<span class="ml-1 font-mono break-all">{session.workspaceId}</span>
							</p>
							<p>
								<span class="text-foreground/70">Tutor agent</span>
								{#if session.activeTurnAgentId}
									<a
										href={`/admin/users/${data.user.uid}/agents/${session.activeTurnAgentId}`}
										class="ml-1 font-mono break-all text-foreground hover:underline"
									>
										{session.activeTurnAgentId}
									</a>
								{:else}
									<span class="ml-1">—</span>
								{/if}
							</p>
							<p>
								<span class="text-foreground/70">Grader agent</span>
								{#if session.graderAgentId}
									<a
										href={`/admin/users/${data.user.uid}/agents/${session.graderAgentId}`}
										class="ml-1 font-mono break-all text-foreground hover:underline"
									>
										{session.graderAgentId}
									</a>
								{:else}
									<span class="ml-1">—</span>
								{/if}
							</p>
							<p>
								<span class="text-foreground/70">Source grader run</span>
								<a
									href={`/admin/users/${data.user.uid}/graders#grader-run-${session.source.runId}`}
									class="ml-1 font-mono break-all text-foreground hover:underline"
								>
									{session.source.runId}
								</a>
							</p>
							<p>
								<span class="text-foreground/70">Problem ID</span>
								<span class="ml-1 font-mono break-all">{session.source.problemId}</span>
							</p>
							<p>
								<span class="text-foreground/70">Marks</span>
								<span class="ml-1">
									{formatMarks(session.source.awardedMarks, session.source.maxMarks)}
								</span>
							</p>
							<p>
								<span class="text-foreground/70">Created</span>
								<span class="ml-1">{formatInstant(session.createdAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Updated</span>
								<span class="ml-1">{formatInstant(session.updatedAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Completed</span>
								<span class="ml-1">{formatInstant(session.completedAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Focus</span>
								<span class="ml-1">{session.focusLabel ?? '—'}</span>
							</p>
						</div>

						{#if session.preview}
							<p class="rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
								{session.preview}
							</p>
						{/if}

						{#if session.error}
							<p class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
								{session.error}
							</p>
						{/if}

						<details class="rounded-md border border-border/70 bg-muted/10">
							<summary class="cursor-pointer px-3 py-2 text-xs font-medium text-foreground">
								Raw session data
							</summary>
							<pre
								class="max-h-96 overflow-auto border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground"
							>{session.rawJson}</pre>
						</details>
					</div>

					<form method="POST" action="?/deleteSession" class="shrink-0">
						<input type="hidden" name="sessionId" value={session.id} />
						<Button
							type="submit"
							variant="destructive"
							size="sm"
							onclick={(event) => {
								if (
									!confirm(
										'Delete this tutor session and its workspace files? This cannot be undone.'
									)
								) {
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
