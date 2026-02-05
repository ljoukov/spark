<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { buttonVariants, Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const user = $derived(data.user);
	const userDocFound = $derived(data.userDocFound);

	const displayName = $derived(user.name?.trim() || user.email?.trim() || user.uid);
	const initials = $derived(displayName.trim().charAt(0).toUpperCase() || 'U');
	const photoUrl = $derived(user.photoUrl ?? undefined);

	const pathname = $derived($page.url.pathname);
	const baseHref = $derived(`/admin/users/${user.uid}`);
	const lessonsHref = $derived(baseHref);
	const chatsHref = $derived(`${baseHref}/chats`);

	const isLessonsActive = $derived(
		pathname === lessonsHref || pathname.startsWith(`${baseHref}/lessons/`)
	);
	const isChatsActive = $derived(pathname.startsWith(`${baseHref}/chats`));

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

	function signInLabel(): string {
		if (user.isAnonymous) {
			return 'Guest';
		}
		if (user.signInProvider === 'google.com') {
			return 'Google';
		}
		if (user.signInProvider === 'apple.com') {
			return 'Apple';
		}
		return user.signInProvider ?? '—';
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-6">
	<div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">User</h1>
			<p class="text-sm text-muted-foreground">Review artifacts and manage sessions.</p>
		</div>
		<Button href="/admin/users" variant="secondary" size="sm">Back to users</Button>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>User details</Card.Title>
			<Card.Description>
				{#if userDocFound}
					Loaded from Firestore user doc.
				{:else}
					User doc not found. Showing artifacts for this ID anyway.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<div class="flex items-center gap-3">
					<Avatar.Root class="h-10 w-10">
						<Avatar.Image src={photoUrl} alt={displayName} />
						<Avatar.Fallback>{initials}</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0">
						<p class="truncate text-base font-semibold text-foreground">{displayName}</p>
						<p class="truncate text-xs text-muted-foreground">
							{user.email ?? 'No email'} · <span class="font-mono">{user.uid}</span>
						</p>
					</div>
				</div>
			</div>

			<div class="grid gap-3 md:grid-cols-2">
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Created</p>
					<p class="mt-1 text-sm">{formatInstant(user.createdAt)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Last activity</p>
					<p class="mt-1 text-sm">{formatInstant(user.lastActivityAt)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Current session</p>
					<p class="mt-1 font-mono text-xs break-all">{user.currentSessionId ?? '—'}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Sign-in</p>
					<p class="mt-1 text-sm">{signInLabel()}</p>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<div class="flex flex-wrap gap-2">
		<a
			href={lessonsHref}
			class={cn(
				buttonVariants({ variant: isLessonsActive ? 'default' : 'secondary', size: 'sm' })
			)}
		>
			Lessons
		</a>
		<a
			href={chatsHref}
			class={cn(buttonVariants({ variant: isChatsActive ? 'default' : 'secondary', size: 'sm' }))}
		>
			Chats
		</a>
	</div>

	{@render children?.()}
</div>

