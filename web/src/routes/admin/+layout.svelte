<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import AppSidebar from '$lib/components/admin/app-sidebar.svelte';
	import SessionGate from '$lib/components/admin/session-gate.svelte';
	import { firebaseSignOut } from '$lib/utils/firebaseClient';
	import type { LayoutData } from './$types';
	import type { AdminSessionState } from '$lib/types/admin';
	import type { Snippet } from 'svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let { data, children } = $props<{ data: LayoutData; children?: Snippet | undefined }>();

	const pageStore = page;
	const session = $derived(data.session as AdminSessionState);

	type BreadcrumbItem = { label: string; href: string; isCurrent: boolean };

	function normalizePath(pathname: string | undefined): string {
		const fallback = '/admin';
		if (!pathname) {
			return fallback;
		}
		const normalized = pathname.replace(/\/+$/, '') || fallback;
		return normalized.startsWith('/admin') ? normalized : fallback;
	}

	function buildBreadcrumbs(path: string): BreadcrumbItem[] {
		const items: BreadcrumbItem[] = [
			{ label: 'Home', href: '/admin', isCurrent: path === '/admin' }
		];
		if (path.startsWith('/admin/gemini') && path !== '/admin') {
			items[0].isCurrent = false;
			items.push({ label: 'Gemini', href: '/admin/gemini', isCurrent: true });
		}
		return items;
	}

	const currentPath = $derived(normalizePath($pageStore.url.pathname));
	const breadcrumbItems = $derived(buildBreadcrumbs(currentPath));
	let signingOut = false;

	async function handleSignOut() {
		if (signingOut) {
			return;
		}
		signingOut = true;
		try {
			const response = await fetch('/admin/session', { method: 'DELETE' });
			await firebaseSignOut();
			if (!response.ok) {
				throw new Error('Failed to clear admin session.');
			}
			if (typeof window !== 'undefined') {
				window.location.href = '/admin';
				return;
			}
			await invalidateAll();
		} finally {
			signingOut = false;
		}
	}
</script>

{#if session.status !== 'admin'}
	<SessionGate {session} />
{:else}
	<Sidebar.Provider>
		<AppSidebar {currentPath} user={session.user} onSignOut={handleSignOut} />
		<Sidebar.Inset>
			<header
				class="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/92 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70"
			>
				<Sidebar.Trigger
					class="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted/60 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					aria-label="Toggle navigation"
				/>
				<Separator orientation="vertical" class="h-6" />
				<div class="flex flex-1 items-center overflow-hidden">
					<Breadcrumb.Root class="text-sm">
						<Breadcrumb.List class="flex items-center gap-1 text-muted-foreground">
							{#each breadcrumbItems as item, index (item.href)}
								<Breadcrumb.Item class="truncate">
									{#if item.isCurrent}
										<Breadcrumb.Page class="font-semibold text-foreground"
											>{item.label}</Breadcrumb.Page
										>
									{:else}
										<Breadcrumb.Link href={item.href} class="hover:text-foreground"
											>{item.label}</Breadcrumb.Link
										>
									{/if}
								</Breadcrumb.Item>
								{#if index < breadcrumbItems.length - 1}
									<Breadcrumb.Separator />
								{/if}
							{/each}
						</Breadcrumb.List>
					</Breadcrumb.Root>
				</div>
			</header>
			<div class="flex flex-1 flex-col gap-6 bg-background px-4 py-6">
				{@render children?.()}
			</div>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
