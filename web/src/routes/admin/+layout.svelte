<script lang="ts">
	// Layout for /admin using shadcn Sidebar
	import AppSidebar from '$lib/components/admin/app-sidebar.svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { applyDocumentTheme, startAutomaticThemeSync } from '$lib/utils/theme';
	import { invalidateAll, afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	import { startIdTokenCookieSync } from '$lib/auth/tokenCookie';
	import {
		getFirebaseApp,
		startGoogleSignInRedirect,
		firebaseSignOut
	} from '$lib/utils/firebaseClient';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { getFirestore, doc, onSnapshot, type Firestore } from 'firebase/firestore';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
    import { z } from 'zod';
    import type { AdminUser } from '$lib/types/admin';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let adminUser = $state<AdminUser>({
		uid: data.user?.uid ?? 'guest',
		email: data.user?.email ?? null,
		name: data.user?.name ?? null,
		photoUrl: data.user?.photoUrl ?? null,
		loginUrl: null
	});

	const sidebarUser = $derived({
		uid: adminUser.uid,
		email: adminUser.email,
		name: adminUser.name,
		photoUrl: adminUser.photoUrl,
		loginUrl: adminUser.loginUrl
	});

	// Sidebar props
	let currentPath = $state('');

	function toTitle(segment: string): string {
		return segment
			.split('-')
			.map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : ''))
			.join(' ');
	}

	type Crumb = { label: string; href: string };
	const breadcrumbs = $state<Crumb[]>([]);
	function recomputeBreadcrumbs(pathname: string): void {
		const parts = pathname.split('/').filter(Boolean);
		const items: Crumb[] = [];
		if (parts[0] !== 'admin') {
			breadcrumbs.splice(0, breadcrumbs.length, ...items);
			return;
		}
		let href = '/admin';
		items.push({ label: 'Admin', href });
		for (let i = 1; i < parts.length; i++) {
			href += `/${parts[i]}`;
			items.push({ label: toTitle(parts[i]!), href });
		}
		breadcrumbs.splice(0, breadcrumbs.length, ...items);
	}

	async function onSignOut() {
		await firebaseSignOut();
		if (typeof window !== 'undefined') {
			window.location.href = '/admin';
		}
	}

	// Sign-in overlay logic from previous layout
	type AdminAuthState = 'anonymous' | 'allowed' | 'forbidden';
	const authState = $derived((data.authState ?? 'anonymous') as AdminAuthState);
	const showShell = $derived(authState === 'allowed');
	const showLogin = $derived(authState === 'anonymous');
	const showBlocked = $derived(authState === 'forbidden');
	const ui = $state({ signingIn: false });
	async function handleGoogleSignIn(): Promise<void> {
		ui.signingIn = true;
		try {
			await startGoogleSignInRedirect();
		} finally {
			ui.signingIn = false;
		}
	}

	if (typeof window !== 'undefined') {
		const systemPreference = window.matchMedia('(prefers-color-scheme: dark)');
		applyDocumentTheme(systemPreference.matches ? 'dark' : 'light');
	}

	onMount(() => {
		// initial
		currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
		recomputeBreadcrumbs(currentPath);

		// keep breadcrumbs in sync with client-side navigation
		afterNavigate((nav) => {
			const next =
				nav.to?.url?.pathname ??
				(typeof window !== 'undefined' ? window.location.pathname : currentPath);
			currentPath = next;
			recomputeBreadcrumbs(next);
		});

		const stopThemeSync = startAutomaticThemeSync();

		// Subscribe to Firestore user profile for name/email/photo/loginUrl
		let stopProfile = () => {};
		try {
			if (adminUser.uid && adminUser.uid !== 'guest') {
				const db: Firestore = getFirestore(getFirebaseApp());
				const ref = doc(db, 'spark', adminUser.uid);
				const profileSchema = z
					.object({
						name: z.string().trim().min(1).nullable().optional(),
						email: z.string().email().nullable().optional(),
						photoUrl: z.string().url().nullable().optional(),
						loginUrl: z.string().url().nullable().optional(),
						login: z
							.object({ url: z.string().url().nullable().optional() })
							.partial()
							.nullish(),
						app: z
							.object({
								loginUrl: z.string().url().nullable().optional(),
								login_url: z.string().url().nullable().optional()
							})
							.partial()
							.nullish()
					})
					.partial();

				stopProfile = onSnapshot(ref, (snap) => {
					if (!snap.exists()) {
						return;
					}
					const raw = snap.data();
					const parsed = profileSchema.safeParse(raw);
					if (!parsed.success) {
						return;
					}
					const data = parsed.data;
					adminUser.name = data.name ?? adminUser.name ?? null;
					adminUser.email = data.email ?? adminUser.email ?? null;
					adminUser.photoUrl = data.photoUrl ?? adminUser.photoUrl ?? null;
					const url =
						data.loginUrl ??
						(data.login && data.login.url ? data.login.url : null) ??
						(data.app && data.app.loginUrl ? data.app.loginUrl : null) ??
						(data.app && data.app.login_url ? data.app.login_url : null);
					adminUser.loginUrl = url ?? null;
				});
			}
		} catch {
			// ignore client Firestore init errors in preview
		}

		let stopCookieSync: () => void = () => {};
		let stopAuth: () => void = () => {};
		if (!data.authDisabled) {
			stopCookieSync = startIdTokenCookieSync();
			const auth = getAuth(getFirebaseApp());
			let refreshed = false;
			stopAuth = onIdTokenChanged(auth, (user) => {
				if (user && !refreshed) {
					refreshed = true;
					setTimeout(() => {
						void invalidateAll();
					}, 0);
				}
			});
		}
		return () => {
			stopThemeSync();
			stopProfile();
			stopCookieSync();
			stopAuth();
		};
	});
</script>

{#if showShell}
	<Sidebar.Provider>
		<AppSidebar
			{currentPath}
			user={sidebarUser}
			{onSignOut}
		/>
		<Sidebar.Inset>
			<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
				<Sidebar.Trigger class="-ml-1" />
				<Separator orientation="vertical" class="mr-2 h-4" />
				<Breadcrumb.Root>
					<Breadcrumb.List>
						{#each breadcrumbs as c, i (c.href)}
							<Breadcrumb.Item class={i === 0 ? 'hidden md:block' : ''}>
								<Breadcrumb.Link
									href={c.href}
									aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}
								>
									{c.label}
								</Breadcrumb.Link>
							</Breadcrumb.Item>
							{#if i < breadcrumbs.length - 1}
								<Breadcrumb.Separator class={i === 0 ? 'hidden md:block' : ''} />
							{/if}
						{/each}
					</Breadcrumb.List>
				</Breadcrumb.Root>
			</header>
			<div class="flex flex-1 flex-col gap-4 p-4">
				{@render children?.()}
			</div>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}

{#if showLogin}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<Card.Root class="w-full max-w-md border-border bg-card/95 shadow-xl backdrop-blur">
			<Card.Header>
				<Card.Title>Admin Sign In</Card.Title>
				<Card.Description>Sign in with Google to access the admin area.</Card.Description>
			</Card.Header>
			<Card.Content>
				<button
					type="button"
					class={cn(buttonVariants({ variant: 'default', size: 'default' }), 'w-full')}
					onclick={handleGoogleSignIn}
					disabled={ui.signingIn}
				>
					{#if ui.signingIn}
						Signing in…
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 533.5 544.3"
							class="mr-2 h-4 w-4"
							aria-hidden="true"
						>
							<path
								fill="#4285f4"
								d="M533.5 278.4c0-17.4-1.5-34.1-4.4-50.2H272v95h147.2c-6.4 34.6-25.9 63.9-55.1 83.5v69h88.9c52.1-47.9 80.5-118.4 80.5-197.3z"
							/>
							<path
								fill="#34a853"
								d="M272 544.3c74.7 0 137.4-24.7 183.2-67.6l-88.9-69c-24.7 16.6-56.3 26.4-94.3 26.4-72.6 0-134-49-155.9-114.9H24.2v72.3C69.4 482.2 162.5 544.3 272 544.3z"
							/>
							<path
								fill="#fbbc04"
								d="M116.1 318.9c-4.2-12.6-6.6-26.1-6.6-40s2.4-27.4 6.6-40V166.6H24.2C9 196.3 0 231.4 0 268.9s9 72.6 24.2 102.3l91.9-72.3z"
							/>
							<path
								fill="#ea4335"
								d="M272 107.7c40.8 0 77.3 14 106.1 41.4l79.6-79.6C409.4 24.8 346.7 0 272 0 162.5 0 69.4 62.1 24.2 166.6l91.9 72.3C138 156.7 199.4 107.7 272 107.7z"
							/>
						</svg>
						Sign in with Google
					{/if}
				</button>
			</Card.Content>
		</Card.Root>
	</div>
{/if}

{#if showBlocked}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<Card.Root class="w-full max-w-md border-border bg-card/95 shadow-xl backdrop-blur">
			<Card.Header>
				<Card.Title>No Admin Access</Card.Title>
				<Card.Description>
					{#if data.user?.email}
						{data.user.email} does not have admin permissions.
					{:else}
						This account does not have admin permissions.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<p class="text-sm text-muted-foreground">
					Please sign in with an authorized admin account or contact support to request access.
				</p>
				<button
					type="button"
					class={cn(buttonVariants({ variant: 'default', size: 'default' }), 'w-full')}
					onclick={onSignOut}
				>
					Sign out
				</button>
			</Card.Content>
		</Card.Root>
	</div>
{/if}
