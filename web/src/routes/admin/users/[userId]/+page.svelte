<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	const lessons = $derived(data.lessons);
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
</script>

{#if successMessage}
	<p
		class="rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
	>
		{successMessage}
	</p>
{:else if errorMessage}
	<p
		class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
	>
		{errorMessage}
	</p>
{/if}

<Card.Root class="border-border/70 bg-card/95 shadow-sm">
	<Card.Header>
		<Card.Title>Lessons</Card.Title>
		<Card.Description>
			{#if lessons.length === 0}
				No lessons found.
			{:else}
				Showing {lessons.length} lesson{lessons.length === 1 ? '' : 's'}.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each lessons as lesson (lesson.id)}
			<div class="rounded-xl border border-border/70 p-4">
				<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<a
								href={`/admin/users/${data.user.uid}/lessons/${lesson.id}`}
								class="text-base font-semibold text-foreground hover:underline"
							>
								<span class="mr-1">{lesson.emoji}</span>{lesson.title}
							</a>
							<span
								class={cn(
									'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
									statusBadgeClass(lesson.status)
								)}
							>
								{lesson.status}
							</span>
						</div>
						<p class="text-xs text-muted-foreground">
							<span class="font-mono">{lesson.id}</span>
						</p>
						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Created</span>
								<span class="ml-1">{formatInstant(lesson.createdAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Last progress</span>
								<span class="ml-1">{formatInstant(lesson.lastProgressAt)}</span>
							</p>
							<p class="md:col-span-2">
								<span class="text-foreground/70">Completion</span>
								<span class="ml-1">{lesson.completed}/{lesson.total} steps</span>
							</p>
						</div>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<Button href={`/admin/users/${data.user.uid}/lessons/${lesson.id}`} variant="secondary" size="sm">
							View
						</Button>

						<form method="POST" action="?/resetLesson">
							<input type="hidden" name="sessionId" value={lesson.id} />
							<Button
								type="submit"
								variant="secondary"
								size="sm"
								onclick={(event) => {
									if (
										!confirm(
											'Reset progress for this lesson? This clears completion state but keeps lesson content.'
										)
									) {
										event.preventDefault();
									}
								}}
							>
								Reset progress
							</Button>
						</form>

						<form method="POST" action="?/deleteLesson">
							<input type="hidden" name="sessionId" value={lesson.id} />
							<Button
								type="submit"
								variant="destructive"
								size="sm"
								onclick={(event) => {
									if (
										!confirm(
											'Delete this lesson and all of its saved data (quiz/code/media/state)? This cannot be undone.'
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
			</div>
		{/each}
	</Card.Content>
</Card.Root>

