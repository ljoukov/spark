<script lang="ts">
	import HomeIcon from '@lucide/svelte/icons/home';
	import BotIcon from '@lucide/svelte/icons/bot';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import LinkIcon from '@lucide/svelte/icons/link';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { cn } from '$lib/utils.js';
	import type { AdminUser } from '$lib/types/admin';

	type NavItem = {
		title: string;
		href: Pathname;
		icon: typeof HomeIcon;
		highlight: (path: string) => boolean;
	};

	const primaryNav = [
		{
			title: 'Home',
			href: '/admin',
			icon: HomeIcon,
			highlight: (path) => path === '/admin' || path === '/admin/'
		},
		{
			title: 'Firestore',
			href: '/admin/firestore',
			icon: DatabaseIcon,
			highlight: (path) => path.startsWith('/admin/firestore')
		},
		{
			title: 'Gemini',
			href: '/admin/gemini',
			icon: BotIcon,
			highlight: (path) => path.startsWith('/admin/gemini')
		},
	] satisfies readonly NavItem[];

	let {
		currentPath,
		user,
		onSignOut
	}: {
		currentPath: string;
		user: AdminUser;
		onSignOut: () => Promise<void>;
	} = $props();

	const sidebar = Sidebar.useSidebar();

	function getDisplayName(target: AdminUser): string {
		return target.name?.trim() || target.email?.trim() || target.uid;
	}

	function getInitials(target: AdminUser): string {
		const from = getDisplayName(target) || target.uid;
		return from.trim().charAt(0).toUpperCase() || 'A';
	}

	function getEmailLabel(target: AdminUser): string {
		return target.email ?? 'No email on file';
	}

	const defaultAvatarSrc = '/images/admin-avatar.svg';
	const avatarSrc = $derived(user.photoUrl ?? defaultAvatarSrc);
	const signingOut = $state({ active: false, error: '' });
	const copyState = $state<{ status: 'idle' | 'copied' | 'error'; message: string }>({
		status: 'idle',
		message: ''
	});
	const copyLoginState = $state<{ status: 'idle' | 'copied' | 'error'; message: string }>({
		status: 'idle',
		message: ''
	});

	async function copyUserId(): Promise<void> {
		try {
			if (typeof navigator === 'undefined' || !navigator.clipboard) {
				copyState.status = 'error';
				copyState.message = 'Clipboard not available';
				return;
			}
			await navigator.clipboard.writeText(user.uid);
			copyState.status = 'copied';
			copyState.message = 'Copied user ID';
			setTimeout(() => {
				copyState.status = 'idle';
				copyState.message = '';
			}, 1200);
		} catch (error) {
			copyState.status = 'error';
			copyState.message = error instanceof Error ? error.message : 'Failed to copy user ID';
		}
	}

	async function copyLoginUrl(): Promise<void> {
		try {
			if (!user.loginUrl) {
				copyLoginState.status = 'error';
				copyLoginState.message = 'No login URL';
				return;
			}
			if (typeof navigator === 'undefined' || !navigator.clipboard) {
				copyLoginState.status = 'error';
				copyLoginState.message = 'Clipboard not available';
				return;
			}
			await navigator.clipboard.writeText(user.loginUrl);
			copyLoginState.status = 'copied';
			copyLoginState.message = 'Copied login URL';
			setTimeout(() => {
				copyLoginState.status = 'idle';
				copyLoginState.message = '';
			}, 1200);
		} catch (error) {
			copyLoginState.status = 'error';
			copyLoginState.message = error instanceof Error ? error.message : 'Failed to copy login URL';
		}
	}

	async function handleSignOut() {
		if (signingOut.active) {
			return;
		}
		signingOut.active = true;
		signingOut.error = '';
		try {
			await onSignOut();
		} catch (error) {
			signingOut.error = error instanceof Error ? error.message : 'Failed to sign out.';
		} finally {
			signingOut.active = false;
		}
	}

	async function handleUserMenuSignOut(event: Event) {
		event.preventDefault();
		await handleSignOut();
	}
</script>

<Sidebar.Root>
	<Sidebar.Header class="px-4 py-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-4">
				<img
					src="/favicon.png"
					alt="Spark"
					title="Spark"
					class="size-10 rounded-lg border border-sidebar-border object-cover"
				/>
				<div>
					<p class="font-semibold">GCSE Spark</p>
					<p class="text-xs text-sidebar-foreground/70">Admin tools</p>
				</div>
			</div>
		</div>
	</Sidebar.Header>

	<Sidebar.Content class="flex-1 overflow-y-auto px-2 py-4">
		<Sidebar.Group>
			<Sidebar.GroupLabel>Navigation</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each primaryNav as item (item.title)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={item.highlight(currentPath)}>
								{#snippet child({ props })}
									{@const href = resolve(item.href)}
									<a
										{...props}
										{href}
										class={cn(
											'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/80 no-underline transition-colors hover:text-sidebar-foreground',
											props?.class as string | undefined
										)}
										onclick={() => {
											if (sidebar.isMobile) {
												sidebar.setOpenMobile(false);
											}
										}}
									>
										<item.icon class="h-4 w-4" aria-hidden="true" />
										<span>{item.title}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer class="border-t border-sidebar-border px-3 py-4">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="w-full">
				<div
					class="flex w-full items-center gap-3 rounded-xl bg-sidebar-accent/40 px-3 py-2 text-left transition hover:bg-sidebar-accent"
				>
					<Avatar.Root class="h-9 w-9">
						<Avatar.Image src={avatarSrc} alt={getDisplayName(user)} />
						<Avatar.Fallback>{getInitials(user)}</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{getDisplayName(user)}</p>
						<p class="truncate text-xs text-sidebar-foreground/70">{getEmailLabel(user)}</p>
					</div>
					<MoreVerticalIcon class="ml-auto h-4 w-4 opacity-70" />
				</div>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				align="end"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				sideOffset={4}
			>
				<DropdownMenu.Label class="text-xs text-muted-foreground">Signed in</DropdownMenu.Label>
				<DropdownMenu.Item class="flex flex-col items-start gap-0">
					<span class="text-sm font-medium break-words">{getDisplayName(user)}</span>
					<span class="text-xs break-words text-muted-foreground">{getEmailLabel(user)}</span>
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Label class="text-xs text-muted-foreground">User ID</DropdownMenu.Label>
				<DropdownMenu.Item class="cursor-default">
					<span class="font-mono text-[11px] leading-tight">{user.uid}</span>
				</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={copyUserId} class="flex items-center gap-2">
					<CopyIcon class="h-4 w-4" />
					{#if copyState.status === 'copied'}
						<span>Copied</span>
					{:else}
						<span>Copy user ID</span>
					{/if}
				</DropdownMenu.Item>
				{#if copyState.status === 'error' && copyState.message}
					<div class="px-2 pb-1">
						<p class="text-[11px] text-red-500">{copyState.message}</p>
					</div>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Label class="text-xs text-muted-foreground">Login URL</DropdownMenu.Label>
				<DropdownMenu.Item class="cursor-default">
					{#if user.loginUrl}
						<span class="font-mono text-[11px] leading-tight break-all">{user.loginUrl}</span>
					{:else}
						<span class="text-[11px] text-muted-foreground">Not set</span>
					{/if}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					onSelect={copyLoginUrl}
					class="flex items-center gap-2"
					disabled={!user.loginUrl}
				>
					<LinkIcon class="h-4 w-4" />
					{#if copyLoginState.status === 'copied'}
						<span>Copied login URL</span>
					{:else}
						<span>Copy login URL</span>
					{/if}
				</DropdownMenu.Item>
				{#if copyLoginState.status === 'error' && copyLoginState.message}
					<div class="px-2 pb-1">
						<p class="text-[11px] text-red-500">{copyLoginState.message}</p>
					</div>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					onSelect={handleUserMenuSignOut}
					variant="destructive"
					disabled={signingOut.active}
				>
					<LogOutIcon class="mr-2 h-4 w-4" />
					{signingOut.active ? 'Signing out…' : 'Log out'}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		{#if signingOut.error}
			<p class="mt-3 text-xs text-red-500">{signingOut.error}</p>
		{/if}
	</Sidebar.Footer>

	<Sidebar.Rail />
</Sidebar.Root>
