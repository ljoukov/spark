<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { onMount, setContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { fromStore, writable } from 'svelte/store';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import {
		themePreference,
		setThemePreference,
		type ThemePreference
	} from '$lib/stores/themePreference';
	import type { LayoutData } from './$types';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { getAuth, onIdTokenChanged, type User } from 'firebase/auth';

	type ClientUser = NonNullable<LayoutData['user']>;
	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	type ExperienceKey = 'lesson' | 'spark' | null;

	function resolveExperience(routeId: string | null | undefined): ExperienceKey {
		if (!routeId) {
			return null;
		}
		if (routeId.includes('/spark/lesson')) {
			return 'lesson';
		}
		if (routeId.includes('/spark')) {
			return 'spark';
		}
		return null;
	}

	function resolveSessionHomeHref(experience: ExperienceKey, sessionId: string | null): string {
		if (experience === 'lesson') {
			return sessionId ? `/spark/lesson/${sessionId}` : '/spark/lesson';
		}
		if (experience === 'spark') {
			return '/spark';
		}
		return '/spark';
	}

	function resolveBrandCopy(experience: ExperienceKey): { title: string; tagline: string | null } {
		if (experience === 'lesson') {
			return { title: 'Spark Lessons', tagline: 'Think. Hack. Spark.' };
		}
		if (experience === 'spark') {
			return { title: 'Spark', tagline: 'Think. Hack. Spark.' };
		}
		return { title: 'Spark', tagline: 'Think. Hack. Spark.' };
	}

	const userStore = writable<ClientUser | null>(null);
	setContext('spark:user', userStore);
	const userSnapshot = fromStore(userStore);
	const user = $derived(userSnapshot.current);

	$effect(() => {
		userStore.set(data.user ?? null);
	});
	const sessionId = $derived($page.params.sessionId ?? null);
	const experience = $derived(resolveExperience($page.route.id));
	const sessionHomeHref = $derived(resolveSessionHomeHref(experience, sessionId));
	const brandCopy = $derived(resolveBrandCopy(experience));
	const logoutLabel = $derived(user?.isAnonymous ? 'Delete guest account' : 'Log out');
	let theme = $state<ThemePreference>('auto');
	let copiedIdentity = $state(false);

	const canCopyIdentity = $derived(Boolean(user?.uid && user.uid.trim().length > 0));
	const hasEmailIdentity = $derived(Boolean(user?.email && user.email.trim().length > 0));

	const themeOptions: readonly { label: string; value: ThemePreference }[] = [
		{ label: 'Automatic', value: 'auto' },
		{ label: 'Light', value: 'light' },
		{ label: 'Dark', value: 'dark' }
	];

		function getIdentityCopyValue(): string | null {
			if (!user?.uid || user.uid.trim().length === 0) {
				return null;
			}
			const lines: string[] = [];
			const name = user.name?.trim() ?? '';
			if (name.length > 0) {
				lines.push(`Name: ${name}`);
			}
			const email = user.email?.trim() ?? '';
			if (email.length > 0) {
				lines.push(`Email: ${email}`);
			}
			lines.push(`UserID: ${user.uid.trim()}`);
			return lines.join('\n');
		}

	async function copyIdentityToClipboard(): Promise<void> {
		const value = getIdentityCopyValue();
		if (!value) {
			return;
		}
		try {
			if (navigator?.clipboard?.writeText) {
				await navigator.clipboard.writeText(value);
			} else {
				const textarea = document.createElement('textarea');
				textarea.value = value;
				textarea.style.position = 'fixed';
				textarea.style.top = '0';
				textarea.style.left = '0';
				textarea.style.opacity = '0';
				document.body.appendChild(textarea);
				textarea.focus();
				textarea.select();
				document.execCommand('copy');
				document.body.removeChild(textarea);
			}
		} catch (error) {
			console.warn('Failed to copy user identity to clipboard', error);
			return;
		}

		copiedIdentity = true;
		window.setTimeout(() => {
			copiedIdentity = false;
		}, 1200);
	}

	function patchUser(partial: Partial<ClientUser>): void {
		userStore.update((current) => {
			if (!current) {
				return current;
			}
			const next = { ...current };
			if ('uid' in partial && partial.uid && partial.uid !== current.uid) {
				next.uid = partial.uid;
			}
			if ('name' in partial) {
				next.name = partial.name ?? null;
			}
			if ('email' in partial) {
				next.email = partial.email ?? null;
			}
			if ('photoUrl' in partial) {
				next.photoUrl = partial.photoUrl ?? null;
			}
			if ('isAnonymous' in partial && typeof partial.isAnonymous === 'boolean') {
				next.isAnonymous = partial.isAnonymous;
			}
			return next;
		});
	}

	function signatureFor(user: User): string {
		return [
			user.uid,
			user.displayName ?? '',
			user.email ?? '',
			user.photoURL ?? '',
			user.isAnonymous ? '1' : '0'
		].join('|');
	}

	onMount(() => {
		const unsubscribeTheme = themePreference.subscribe((value) => {
			theme = value;
		});

		let stopAuthListener: () => void = () => {};
		let syncingProfile = false;
		let lastSyncedSignature: string | null = null;
		let redirectingToLogin = false;
		let bootAuthTimer: number | null = null;

		async function syncProfileFrom(firebaseUser: User): Promise<void> {
			if (syncingProfile) {
				return;
			}
			syncingProfile = true;
			const signature = signatureFor(firebaseUser);
			if (lastSyncedSignature === signature) {
				syncingProfile = false;
				return;
			}
			try {
				const idToken = await firebaseUser.getIdToken();
				const response = await fetch('/api/login', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${idToken}`
					},
					body: JSON.stringify({
						name: firebaseUser.displayName ?? null,
						email: firebaseUser.email ?? null,
						photoUrl: firebaseUser.photoURL ?? null,
						isAnonymous: firebaseUser.isAnonymous
					})
				});
				if (!response.ok) {
					const details = await response.json().catch(() => null);
					console.warn('Failed to sync profile for Spark user', details);
					return;
				}
				lastSyncedSignature = signature;
			} catch (error) {
				console.error('Unexpected error while syncing Spark profile', error);
			} finally {
				syncingProfile = false;
			}
		}

		function updateUserFromAuth(firebaseUser: User): void {
			const patch: Partial<ClientUser> = { isAnonymous: firebaseUser.isAnonymous };
			if (firebaseUser.displayName) {
				patch.name = firebaseUser.displayName;
			}
			if (firebaseUser.email) {
				patch.email = firebaseUser.email;
			}
			if (firebaseUser.photoURL) {
				patch.photoUrl = firebaseUser.photoURL;
			}
			patchUser(patch);
		}

		try {
			const app = getFirebaseApp();
			const auth = getAuth(app);
			const clearSessionAndRedirect = async (): Promise<void> => {
				if (redirectingToLogin) {
					return;
				}
				redirectingToLogin = true;
				try {
					await fetch('/api/logout', { method: 'POST' });
				} catch {
					// Best-effort; ignore failures while redirecting.
				}
				const redirectTo = `${window.location.pathname}${window.location.search}`;
				window.location.href = `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
			};

			stopAuthListener = onIdTokenChanged(auth, (firebaseUser) => {
				if (firebaseUser) {
					if (bootAuthTimer !== null) {
						window.clearTimeout(bootAuthTimer);
						bootAuthTimer = null;
					}
					updateUserFromAuth(firebaseUser);
					void syncProfileFrom(firebaseUser);
					return;
				}

				// If SSR thinks we're signed in (session cookie) but Firebase is missing, the UI will
				// half-render and all Firestore reads will fail. Give Firebase a moment to hydrate
				// its persisted state before we clear the server session + bounce to /login.
				if (bootAuthTimer !== null) {
					return;
				}
				bootAuthTimer = window.setTimeout(() => {
					bootAuthTimer = null;
					if (auth.currentUser) {
						return;
					}
					void clearSessionAndRedirect();
				}, 1200);
			});
		} catch (error) {
			console.error('Failed to initialize Spark auth listeners', error);
		}

		return () => {
			unsubscribeTheme();
			stopAuthListener();
			if (bootAuthTimer !== null) {
				window.clearTimeout(bootAuthTimer);
				bootAuthTimer = null;
			}
		};
	});

	function getDisplayName(): string {
		if (!user) {
			return 'Spark guest';
		}
		if (user.name && user.name.trim().length > 0) {
			return user.name.trim();
		}
		if (user.email && user.email.trim().length > 0) {
			return user.email.trim();
		}
		return 'Spark guest';
	}

	function getEmailLabel(): string {
		if (!user) {
			return 'Guest session';
		}
		if (user.email && user.email.trim().length > 0) {
			return user.email.trim();
		}
		return user.isAnonymous ? 'Guest session' : 'Email not provided';
	}

	function getAvatarInitials(): string {
		return initialsFrom(user);
	}

	function initialsFrom(target: ClientUser | null): string {
		if (!target) {
			return 'SP';
		}
		if (target.name && target.name.trim().length > 0) {
			const parts = target.name
				.trim()
				.split(/\s+/)
				.slice(0, 2)
				.map((segment) => segment[0]!.toUpperCase());
			if (parts.length) {
				return parts.join('');
			}
		}
		if (target.email && target.email.length > 0) {
			return target.email.slice(0, 2).toUpperCase();
		}
		return 'SP';
	}

	function handleThemeSelect(value: ThemePreference): void {
		setThemePreference(value);
	}

	async function handleLogout(): Promise<void> {
		await goto('/logout');
	}
</script>

<div class="app-page">
	<div class="app-shell">
		<header class="app-header" data-experience={experience ?? ''}>
			<a class="app-brand" href={sessionHomeHref}>
				<img src="/favicon.png" alt="Spark logo" class="app-brand__logo" />
				<div class="app-brand__text">
					<span class="app-brand__title">{brandCopy.title}</span>
					{#if brandCopy.tagline}
						<span class="app-brand__separator" aria-hidden="true">•</span>
						<span class="app-brand__tagline">{brandCopy.tagline}</span>
					{/if}
				</div>
			</a>
			<div class="app-header__actions">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="app-user-trigger" aria-label="Open user menu">
						<Avatar.Root class="app-avatar">
							{#if user?.photoUrl}
								<Avatar.Image src={user.photoUrl} alt={getDisplayName()} />
							{/if}
							<Avatar.Fallback aria-hidden="true">{getAvatarInitials()}</Avatar.Fallback>
						</Avatar.Root>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="app-user-menu" align="end" sideOffset={12}>
						<DropdownMenu.Label class="app-user-menu__label">Signed in</DropdownMenu.Label>
						<div class="app-user-menu__identity">
							<div class="app-user-menu__row">
								<span class="app-user-menu__name">{getDisplayName()}</span>
								{#if canCopyIdentity && !hasEmailIdentity}
										<button
											type="button"
											class="app-user-menu__copy"
											aria-label="Copy user info"
											title="Copy user info"
											onclick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												void copyIdentityToClipboard();
											}}
									>
										{#if copiedIdentity}
											<CheckIcon class="app-user-menu__copy-icon" />
										{:else}
											<CopyIcon class="app-user-menu__copy-icon" />
										{/if}
									</button>
								{/if}
							</div>
							<div class="app-user-menu__row app-user-menu__row--secondary">
								<span class="app-user-menu__email">{getEmailLabel()}</span>
								{#if canCopyIdentity && hasEmailIdentity}
										<button
											type="button"
											class="app-user-menu__copy"
											aria-label="Copy user info"
											title="Copy user info"
											onclick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												void copyIdentityToClipboard();
											}}
									>
										{#if copiedIdentity}
											<CheckIcon class="app-user-menu__copy-icon" />
										{:else}
											<CopyIcon class="app-user-menu__copy-icon" />
										{/if}
									</button>
								{/if}
							</div>
						</div>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							class="app-user-menu__link"
							onSelect={() => {
								void goto('/spark/lessons');
							}}
						>
							Lessons
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger class="app-user-menu__subtrigger">
								Appearance
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent class="app-appearance-menu" alignOffset={-8} sideOffset={8}>
								<DropdownMenu.RadioGroup
									value={theme}
									onValueChange={(value) => handleThemeSelect(value as ThemePreference)}
								>
									{#each themeOptions as option}
										<DropdownMenu.RadioItem value={option.value} class="app-appearance-menu__item">
											<CheckIcon class="theme-check" />
											<span>{option.label}</span>
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							class="app-user-menu__logout"
							onSelect={handleLogout}
							variant="destructive"
						>
							{logoutLabel}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</header>

		<main class="app-main">
			<section class="app-content">
				{@render children?.()}
			</section>
		</main>
	</div>
</div>

<style>
	.app-page {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100dvh;
		min-height: 100dvh;
		width: 100%;
		overflow: hidden;
		background:
			radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
			var(--app-surface);
		color: var(--text-primary, var(--foreground));
	}

	@supports not (height: 100dvh) {
		.app-page {
			height: 100vh;
			min-height: 100vh;
		}
	}

	.app-page::before {
		content: '';
		position: absolute;
		top: -20%;
		left: 50%;
		width: 120dvw;
		height: 140dvh;
		transform: translateX(-50%);
		pointer-events: none;
		background-repeat: no-repeat;
		background-image:
			radial-gradient(
				closest-side at 12% 20%,
				color-mix(in srgb, var(--blob-gold) 75%, transparent) 0%,
				transparent 72%
			),
			radial-gradient(
				closest-side at 78% 18%,
				color-mix(in srgb, var(--blob-pink) 70%, transparent) 0%,
				transparent 74%
			),
			radial-gradient(
				closest-side at 30% 74%,
				color-mix(in srgb, var(--blob-blue) 70%, transparent) 0%,
				transparent 76%
			),
			radial-gradient(
				closest-side at 82% 70%,
				color-mix(in srgb, var(--blob-yellow-soft) 65%, transparent) 0%,
				transparent 80%
			),
			radial-gradient(
				closest-side at 46% 48%,
				color-mix(in srgb, var(--blob-yellow) 60%, transparent) 0%,
				transparent 78%
			);
		opacity: min(0.85, var(--blob-opacity, 0.65));
		transition: opacity 0.3s ease;
		z-index: 0;
	}

	.app-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		z-index: 1;
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 3rem;
		padding: 0 1.25rem;
		gap: 1rem;
		border-bottom: 1px solid rgba(148, 163, 184, 0.32);
		background: color-mix(in srgb, var(--app-content-bg) 50%, transparent);
		box-shadow: 0 25px 60px -40px rgba(15, 23, 42, 0.25);
		backdrop-filter: blur(18px);
		position: sticky;
		top: 0;
		z-index: 10;
		flex-shrink: 0;
	}

	:global([data-theme='dark'] .app-header),
	:global(:root:not([data-theme='light']) .app-header) {
		background: color-mix(in srgb, rgba(6, 11, 25, 1) 50%, transparent);
		border-bottom-color: rgba(148, 163, 184, 0.24);
		box-shadow: 0 35px 80px -45px rgba(2, 6, 23, 0.45);
	}

	.app-brand {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-shrink: 0;
	}

	.app-brand__logo {
		width: 2rem;
		height: 2rem;
		border-radius: 0.875rem;
		box-shadow: 0 18px 45px -25px rgba(15, 23, 42, 0.35);
	}

	.app-brand__text {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-weight: 600;
		font-family:
			'-apple-system', 'system-ui', 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji',
			'Segoe UI Emoji';
		font-size: 0.875rem;
		line-height: 1.25rem;
		color: var(--app-subtitle-color);
	}

	.app-brand__title {
		letter-spacing: -0.01em;
		color: var(--foreground);
	}

	.app-brand__separator {
		opacity: 0.45;
	}

	.app-brand__tagline {
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var(--app-subtitle-color);
	}

	.app-header__actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: auto;
	}

	:global(.app-avatar) {
		height: 2rem;
		width: 2rem;
		border-radius: 9999px;
		border: 2px solid rgba(255, 255, 255, 0.65);
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
	}

	:global(.app-user-trigger) {
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		border-radius: 9999px;
	}

	:global(.app-user-menu) {
		min-width: 16rem;
		padding: 0.45rem 0.5rem 0.6rem;
		border-radius: 0.9rem;
	}

	:global(.app-user-menu__label) {
		display: block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--app-subtitle-color);
	}

	.app-user-menu__identity {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.6rem 0 0.75rem;
	}

	.app-user-menu__row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.app-user-menu__row--secondary {
		align-items: flex-start;
	}

		.app-user-menu__name {
			display: block;
			font-weight: 600;
			font-size: 0.95rem;
			min-width: 0;
			word-break: break-word;
			flex: 1;
		}

	.app-user-menu__email {
		display: block;
		font-size: 0.8rem;
		color: var(--muted-foreground);
		white-space: normal;
		word-break: break-word;
		min-width: 0;
		flex: 1;
	}

		.app-user-menu__copy {
			flex: 0 0 auto;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 18px;
			height: 18px;
			padding: 0;
			border: 0;
			border-radius: 9999px;
			background: transparent;
			color: var(--muted-foreground);
			cursor: pointer;
		}

	.app-user-menu__copy:hover {
		background: var(--muted);
		color: var(--foreground);
	}

	.app-user-menu__copy:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	:global(.app-user-menu__copy-icon) {
		width: 1rem;
		height: 1rem;
	}

	:global(.app-appearance-menu) {
		padding: 0.4rem;
		border-radius: 0.75rem;
		min-width: 11rem;
	}

	:global(.app-appearance-menu__item) {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.9rem;
	}

	:global(.app-appearance-menu__item[data-state='checked']) {
		font-weight: 600;
	}

	:global(.app-appearance-menu__item > span:first-child) {
		display: none;
	}

	:global(.theme-check) {
		height: 1rem;
		width: 1rem;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	:global(.app-appearance-menu__item[data-state='checked'] .theme-check) {
		opacity: 1;
	}

	:global(.app-user-menu__link) {
		font-weight: 600;
	}

	:global(.app-user-menu__logout) {
		font-weight: 600;
	}

	.app-main {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		scrollbar-gutter: stable both-edges;
	}

	/* CSS-only lock: when page content contains a `.workspace` (code editor).
	   Marked global so Svelte doesn't treat it as unused in this component scope. */
	:global(.app-main:has(.workspace)) {
		overflow-y: hidden;
		overscroll-behavior: contain;
	}

	.app-content {
		flex: 1 0 auto;
		display: flex;
		flex-direction: column;
		gap: clamp(1.6rem, 3vw, 2.6rem);
		min-height: 0;
	}
</style>
