<script lang="ts">
	import HomeIcon from '@lucide/svelte/icons/home';
	import BotIcon from '@lucide/svelte/icons/bot';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils.js';
	import type { AdminUser } from '$lib/types/admin';

	type NavItem = {
		title: string;
		href: string;
		icon: typeof HomeIcon;
		highlight: (path: string) => boolean;
	};

	const primaryNav: NavItem[] = [
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
		}
	];

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
					class="border-sidebar-border size-10 rounded-lg border object-cover"
				/>
				<div>
					<p class="font-semibold">GCSE Spark</p>
					<p class="text-sidebar-foreground/70 text-xs">Admin tools</p>
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
									<a
										{...props}
										href={resolve(item.href)}
										class={cn(
											'text-sidebar-foreground/80 hover:text-sidebar-foreground flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium no-underline transition-colors',
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

	<Sidebar.Footer class="border-sidebar-border border-t px-3 py-4">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="w-full">
				<div
					class="bg-sidebar-accent/40 hover:bg-sidebar-accent flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition"
				>
					<Avatar.Root class="h-9 w-9">
						<Avatar.Image src={avatarSrc} alt={getDisplayName(user)} />
						<Avatar.Fallback>{getInitials(user)}</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{getDisplayName(user)}</p>
						<p class="text-sidebar-foreground/70 truncate text-xs">{getEmailLabel(user)}</p>
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
				<DropdownMenu.Label class="text-muted-foreground text-xs">Signed in</DropdownMenu.Label>
				<DropdownMenu.Item class="flex flex-col items-start gap-0">
					<span class="break-words text-sm font-medium">{getDisplayName(user)}</span>
					<span class="text-muted-foreground break-words text-xs">{getEmailLabel(user)}</span>
				</DropdownMenu.Item>
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
