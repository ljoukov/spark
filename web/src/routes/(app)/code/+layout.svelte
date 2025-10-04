<script lang="ts">
        import { goto } from '$app/navigation';
        import CheckIcon from '@lucide/svelte/icons/check';
        import { onMount, setContext } from 'svelte';
        import type { Snippet } from 'svelte';
        import { writable } from 'svelte/store';
        import * as Avatar from '$lib/components/ui/avatar/index.js';
        import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
        import {
                themePreference,
                setThemePreference,
                type ThemePreference
        } from '$lib/stores/themePreference';
        import type { LayoutData } from './$types';

	type ClientUser = NonNullable<LayoutData['user']>;

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const initialUser = data.user;
	const userStore = writable<ClientUser | null>(initialUser);
	setContext('spark-code:user', { subscribe: userStore.subscribe });

	let user = $state<ClientUser | null>(initialUser);
	let theme = $state<ThemePreference>('auto');

	const themeOptions: readonly { label: string; value: ThemePreference }[] = [
		{ label: 'Automatic', value: 'auto' },
		{ label: 'Light', value: 'light' },
		{ label: 'Dark', value: 'dark' }
	];

        onMount(() => {
                const unsubscribeUser = userStore.subscribe((value) => {
                        user = value;
                });
                const unsubscribeTheme = themePreference.subscribe((value) => {
                        theme = value;
                });
                return () => {
                        unsubscribeUser();
                        unsubscribeTheme();
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
	<div class="blob-field" aria-hidden="true"></div>
	<div class="app-shell">
		<header class="app-header">
			<a class="app-brand" href="/code">
				<img src="/favicon.png" alt="Spark logo" class="app-brand__logo" />
				<div class="app-brand__text">
					<span class="app-brand__title">Spark Code</span>
					<span class="app-brand__separator" aria-hidden="true">•</span>
					<span class="app-brand__tagline">Think. Hack. Spark.</span>
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
							<span class="app-user-menu__name">{getDisplayName()}</span>
							<span class="app-user-menu__email">{getEmailLabel()}</span>
						</div>
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
							Log out
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

	.blob-field {
		position: absolute;
		top: 0;
		left: 50%;
		width: 100dvw;
		height: 100dvh;
		transform: translateX(-50%);
		pointer-events: none;
		filter: blur(90px);
		background:
			radial-gradient(68% 68% at 12% 2%, var(--blob-gold), transparent 68%),
			radial-gradient(58% 58% at 22% 26%, var(--blob-yellow), transparent 70%),
			radial-gradient(54% 54% at 72% 18%, var(--blob-pink), transparent 72%),
			radial-gradient(60% 60% at 24% 80%, var(--blob-blue), transparent 74%),
			radial-gradient(50% 50% at 86% 86%, var(--blob-yellow-soft), transparent 76%);
		opacity: var(--blob-opacity);
	}

	.app-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 3rem;
		padding: 0 1rem;
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

	.app-user-menu__name {
		display: block;
		font-weight: 600;
		font-size: 0.95rem;
	}

	.app-user-menu__email {
		display: block;
		font-size: 0.8rem;
		color: var(--muted-foreground);
		white-space: normal;
		word-break: break-word;
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
