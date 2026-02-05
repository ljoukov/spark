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
	const login = $derived(data.login);
	const has = $derived(data.has);

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

	function loginLabel(value: string): string {
		if (value === 'guest') {
			return 'Guest';
		}
		if (value === 'email') {
			return 'E-mail';
		}
		if (value === 'google') {
			return 'Google';
		}
		if (value === 'apple') {
			return 'Apple';
		}
		return 'Other';
	}
</script>

<div class="mx-auto w-full max-w-5xl space-y-6">
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Users</Card.Title>
			<Card.Description>Find users by email or user ID, then manage lessons.</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="space-y-3">
				<form
					method="GET"
					action="/admin/users"
					class="flex flex-col gap-2 md:flex-row md:items-center"
					aria-label="Find user"
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
					<Button type="submit">Find user</Button>
				</form>

				<form
					method="GET"
					action="/admin/users"
					class="flex flex-col gap-2 md:flex-row md:items-center"
					aria-label="User filters"
				>
					<label class="sr-only" for="login-filter">Login type</label>
					<select
						id="login-filter"
						name="login"
						class="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:w-44 dark:bg-input/30"
						onchange={(event) => {
							const form = (event.currentTarget as HTMLSelectElement).form;
							if (form) {
								form.requestSubmit();
							}
						}}
					>
						<option value="all" selected={login === 'all'}>All logins</option>
						<option value="guest" selected={login === 'guest'}>Guest</option>
						<option value="email" selected={login === 'email'}>E-mail</option>
						<option value="google" selected={login === 'google'}>Google</option>
						<option value="apple" selected={login === 'apple'}>Apple</option>
					</select>

					<label class="sr-only" for="has-filter">Has artifacts</label>
					<select
						id="has-filter"
						name="has"
						class="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:w-44 dark:bg-input/30"
						onchange={(event) => {
							const form = (event.currentTarget as HTMLSelectElement).form;
							if (form) {
								form.requestSubmit();
							}
						}}
					>
						<option value="all" selected={has === 'all'}>Any artifacts</option>
						<option value="lessons" selected={has === 'lessons'}>Has lessons</option>
						<option value="chats" selected={has === 'chats'}>Has chats</option>
						<option value="agents" selected={has === 'agents'}>Has agent runs</option>
					</select>
				</form>
			</div>
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
							<span class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
								{loginLabel(user.loginType)}
							</span>
						</div>
						{#if user.name}
							<p class="text-xs text-muted-foreground">{user.name}</p>
						{/if}
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
						<a
							href={`/admin/users/${user.uid}/chats`}
							class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
						>
							Chats
						</a>
						<a
							href={`/admin/users/${user.uid}/agents`}
							class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
						>
							Agent runs
						</a>
					</div>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
