<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const users = $derived(data.users);
	const query = $derived(data.query);
	const notice = $derived(data.notice);

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
</script>

<div class="mx-auto w-full max-w-5xl space-y-6">
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Users</Card.Title>
			<Card.Description>Find users by email or user ID, then manage lessons.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="GET"
				class="flex flex-col gap-2 md:flex-row md:items-center"
				aria-label="User search"
			>
				<label class="sr-only" for="user-search">Email or user ID</label>
				<Input
					id="user-search"
					name="q"
					value={query}
					placeholder="Email (exact) or user ID"
					autocomplete="off"
					class="md:w-96"
				/>
				<div class="flex gap-2">
					<Button type="submit">Search</Button>
					<a
						href="/admin/users"
						class={cn(buttonVariants({ variant: 'secondary' }), 'inline-flex')}
					>
						Clear
					</a>
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Results</Card.Title>
			<Card.Description>
				{#if users.length === 0}
					{notice || 'No users to show.'}
				{:else}
					Showing {users.length} user{users.length === 1 ? '' : 's'}.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#each users as user (user.uid)}
				<div
					class="flex flex-col gap-3 rounded-xl border border-border/70 p-4 md:flex-row md:items-center md:justify-between"
				>
					<div class="space-y-1">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<p class="text-sm font-semibold text-foreground">
								{user.email ?? 'No email'}
							</p>
							{#if user.isAnonymous}
								<span class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
									Anonymous
								</span>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">
							<span class="font-mono">{user.uid}</span>
						</p>
						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Created</span>
								<span class="ml-1">{formatInstant(user.createdAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Last activity</span>
								<span class="ml-1">{formatInstant(user.lastActivityAt)}</span>
							</p>
						</div>
					</div>

					<div class="flex flex-wrap gap-2">
						<a
							href={`/admin/users/${user.uid}`}
							class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
						>
							Lessons
						</a>
					</div>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
