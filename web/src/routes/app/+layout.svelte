<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { startIdTokenCookieSync } from '$lib/auth/tokenCookie';
	import { getFirebaseApp, startGoogleSignInRedirect } from '$lib/utils/firebaseClient';
	import { cn } from '$lib/utils.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	type ClientUser = {
		uid: string;
		email: string | null;
		name: string | null;
		photoUrl: string | null;
		isAnonymous: boolean;
	};

	function fromServerUser(user: LayoutData['user'] | null): ClientUser | null {
		if (!user) {
			return null;
		}
		return {
			uid: user.uid,
			email: user.email,
			name: user.name ?? null,
			photoUrl: user.photoUrl ?? null,
			isAnonymous: false
		};
	}

	let clientUser = $state<ClientUser | null>(fromServerUser(data.user));

	const ui = $state({
		showAuth: !data.user,
		showAnonConfirm: false,
		signingInWithGoogle: false,
		signingInAnonymously: false,
		syncingProfile: false,
		errorMessage: ''
	});

	const googleButtonLabel = $derived(
		ui.signingInWithGoogle ? 'Redirecting to Google…' : 'Continue with Google'
	);
	const guestButtonLabel = $derived(
		ui.signingInAnonymously ? 'Setting up guest mode…' : 'Use guest mode'
	);
	const syncingMessage = $derived(
		ui.syncingProfile && !ui.errorMessage ? 'Finishing sign-in…' : ''
	);

	let stopCookieSync: (() => void) | undefined;
	let unsubscribeAuth: (() => void) | undefined;
	let lastSyncedUid: string | null = data.user?.uid ?? null;

	function resetError() {
		ui.errorMessage = '';
	}

	async function syncProfile(user: User): Promise<boolean> {
		ui.syncingProfile = true;
		try {
			const idToken = await user.getIdToken();
			const response = await fetch('/api/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${idToken}`
				},
				body: JSON.stringify({
					name: user.displayName ?? null,
					email: user.email ?? null,
					photoUrl: user.photoURL ?? null,
					isAnonymous: user.isAnonymous
				})
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				const message = payload?.message ?? 'Unable to sync your account. Please try again.';
				throw new Error(message);
			}

			lastSyncedUid = user.uid;
			ui.errorMessage = '';
			return true;
		} catch (error) {
			const fallback = 'Unexpected error while syncing your account.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			return false;
		} finally {
			ui.syncingProfile = false;
		}
	}

	onMount(() => {
		const auth = getAuth(getFirebaseApp());
		stopCookieSync = startIdTokenCookieSync(auth);

		unsubscribeAuth = onAuthStateChanged(auth, (user) => {
			if (!user) {
				clientUser = null;
				ui.showAuth = true;
				ui.showAnonConfirm = false;
				lastSyncedUid = null;
				return;
			}

			clientUser = {
				uid: user.uid,
				email: user.email ?? null,
				name: user.displayName ?? null,
				photoUrl: user.photoURL ?? null,
				isAnonymous: user.isAnonymous
			};
			ui.showAuth = false;
			ui.showAnonConfirm = false;

			if (lastSyncedUid === user.uid) {
				return;
			}

			void (async () => {
				const synced = await syncProfile(user);
				if (synced) {
					await invalidateAll();
				}
			})();
		});

		return () => {
			stopCookieSync?.();
			unsubscribeAuth?.();
		};
	});

	async function handleGoogleSignIn() {
		if (ui.signingInWithGoogle) {
			return;
		}
		resetError();
		ui.signingInWithGoogle = true;
		try {
			await startGoogleSignInRedirect();
		} catch (error) {
			const fallback = 'Unable to start Google sign-in. Please try again.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			ui.signingInWithGoogle = false;
		}
	}

	function handleOpenAnonymousConfirm() {
		ui.showAnonConfirm = true;
	}

	function handleAnonymousDialogChange(open: boolean) {
		ui.showAnonConfirm = open;
	}

	function handleCancelAnonymous() {
		ui.showAnonConfirm = false;
	}

	async function handleAnonymousContinue() {
		if (ui.signingInAnonymously) {
			return;
		}
		resetError();
		ui.signingInAnonymously = true;
		try {
			const auth = getAuth(getFirebaseApp());
			await signInAnonymously(auth);
			ui.showAnonConfirm = false;
		} catch (error) {
			const fallback = 'Guest mode is unavailable right now. Please try again in a moment.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
			ui.signingInAnonymously = false;
		}
	}
</script>

{#if clientUser}
	<div class="app-layout">
		{@render children?.()}
	</div>
{/if}

{#if ui.showAuth}
	<div class="auth-backdrop" aria-hidden={clientUser !== null}>
		<div class="auth-blob-field" aria-hidden="true"></div>
		<div class="auth-card">
			<header class="auth-header">
				<p class="auth-eyebrow">Welcome to Spark</p>
				<h2 class="auth-title">Scan. Learn. Spark.</h2>
			</header>

			<Button
				onclick={handleGoogleSignIn}
				disabled={ui.signingInWithGoogle || ui.syncingProfile}
				class={cn(
					buttonVariants({ variant: 'default', size: 'lg' }),
					'w-full justify-center rounded-full'
				)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 533.5 544.3"
					class="size-5"
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
				<span>{googleButtonLabel}</span>
			</Button>

			<div class="auth-alt-copy">
				<p class="auth-alt-label">or</p>
				<p class="auth-alt-text">
					Use guest mode and keep this session on this device. Add your email later to sync
					everywhere.
				</p>
			</div>

			{#if syncingMessage}
				<p class="auth-alert info">{syncingMessage}</p>
			{/if}

			{#if ui.errorMessage}
				<p class="auth-alert error">{ui.errorMessage}</p>
			{/if}

			<footer class="auth-footer">
				<span>Need a quick start?</span>
				<button type="button" onclick={handleOpenAnonymousConfirm}>Use guest mode</button>
			</footer>
		</div>
	</div>
{/if}

<Dialog.Root open={ui.showAnonConfirm} onOpenChange={handleAnonymousDialogChange}>
	<Dialog.Content class="anon-dialog">
		<Dialog.Header class="anon-header">
			<Dialog.Title>Use guest mode?</Dialog.Title>
			<Dialog.Description>
				Guest mode keeps this session on this device. Add your email later if you want to sync
				across phones and laptops.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="anon-footer">
			<Button
				variant="secondary"
				onclick={handleCancelAnonymous}
				class={cn(buttonVariants({ size: 'lg', variant: 'secondary' }), 'anon-cancel')}
			>
				Back
			</Button>
			<Button
				onclick={handleAnonymousContinue}
				disabled={ui.signingInAnonymously}
				class={cn(buttonVariants({ size: 'lg' }), 'anon-continue')}
			>
				{guestButtonLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(:root) {
		color-scheme: light dark;
		--auth-dialog-bg: rgba(255, 255, 255, 0.96);
		--auth-dialog-border: rgba(15, 23, 42, 0.12);
		--auth-dialog-foreground: #0f172a;
		--auth-dialog-subtitle: rgba(30, 41, 59, 0.78);
		--auth-dialog-eyebrow: rgba(30, 64, 175, 0.82);
		--auth-dialog-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.5);
	}

	:global([data-theme='dark']) {
		--auth-dialog-bg: rgba(6, 11, 25, 0.78);
		--auth-dialog-border: rgba(148, 163, 184, 0.26);
		--auth-dialog-foreground: #e2e8f0;
		--auth-dialog-subtitle: rgba(226, 232, 240, 0.78);
		--auth-dialog-eyebrow: rgba(148, 197, 255, 0.9);
		--auth-dialog-shadow: 0 40px 120px -70px rgba(2, 6, 23, 0.75);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) {
			--auth-dialog-bg: rgba(6, 11, 25, 0.78);
			--auth-dialog-border: rgba(148, 163, 184, 0.26);
			--auth-dialog-foreground: #e2e8f0;
			--auth-dialog-subtitle: rgba(226, 232, 240, 0.78);
			--auth-dialog-eyebrow: rgba(148, 197, 255, 0.9);
			--auth-dialog-shadow: 0 40px 120px -70px rgba(2, 6, 23, 0.75);
		}
	}

	:global([data-slot='dialog-overlay']) {
		/* Darken/blur only the guest-mode confirmation for readability */
		background: rgba(2, 6, 23, 0.68);
		backdrop-filter: blur(4px);
	}

	.app-layout {
		min-height: 100vh;
		min-height: 100svh;
	}

	.auth-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: calc(var(--safe-area-top) + clamp(3rem, 6vw, 6rem))
			calc(var(--safe-area-right) + clamp(1.5rem, 4vw, 3.5rem))
			calc(var(--safe-area-bottom) + clamp(3rem, 6vw, 6rem))
			calc(var(--safe-area-left) + clamp(1.5rem, 4vw, 3.5rem));
		min-height: 100vh;
		min-height: 100svh;
		isolation: isolate;
		color: var(--text-primary, var(--foreground));
		--app-surface: hsl(38 82% 97%);
		--app-halo: hsla(45 87% 90% / 0.65);
		--blob-gold: hsla(42 96% 84% / 0.9);
		--blob-yellow: hsla(38 95% 82% / 0.88);
		--blob-yellow-soft: hsla(38 92% 91% / 0.88);
		--blob-pink: hsla(332 85% 86% / 0.92);
		--blob-blue: hsla(184 95% 91% / 0.82);
		--blob-opacity: 0.6;
		--app-content-bg: rgba(255, 255, 255, 0.96);
		--app-content-border: rgba(15, 23, 42, 0.12);
		--app-subtitle-color: var(--text-secondary, rgba(30, 41, 59, 0.78));
		--auth-dialog-border: rgba(15, 23, 42, 0.12);
		--auth-dialog-foreground: #0f172a;
		--auth-dialog-subtitle: rgba(30, 41, 59, 0.78);
		--auth-dialog-eyebrow: rgba(30, 64, 175, 0.82);
		--auth-dialog-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.5);
	}

	.auth-backdrop::before {
		content: '';
		position: fixed;
		top: calc(-1 * var(--safe-area-top));
		right: calc(-1 * var(--safe-area-right));
		bottom: calc(-1 * var(--safe-area-bottom));
		left: calc(-1 * var(--safe-area-left));
		background:
			radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
			var(--app-surface);
		background-repeat: no-repeat;
		background-size: cover;
		z-index: -1;
		pointer-events: none;
	}

	.auth-blob-field {
		position: absolute;
		top: calc(-40% - var(--safe-area-top));
		right: calc(-40% - var(--safe-area-right));
		bottom: calc(-40% - var(--safe-area-bottom));
		left: calc(-40% - var(--safe-area-left));
		pointer-events: none;
		filter: blur(90px);
		transform: translateZ(0);
		background:
			radial-gradient(68% 68% at 12% 2%, var(--blob-gold), transparent 68%),
			radial-gradient(58% 58% at 22% 26%, var(--blob-yellow), transparent 70%),
			radial-gradient(54% 54% at 72% 18%, var(--blob-pink), transparent 72%),
			radial-gradient(60% 60% at 24% 80%, var(--blob-blue), transparent 74%),
			radial-gradient(50% 50% at 86% 86%, var(--blob-yellow-soft), transparent 76%);
		opacity: var(--blob-opacity);
	}

	/* Auth card is a plain container (not a modal) */

	.auth-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 2.75rem 2.5rem 2.25rem;
		max-width: 30rem;
		border-radius: 1.75rem;
		border: 1px solid var(--app-content-border, rgba(255, 255, 255, 0.55));
		background: var(--app-content-bg, rgba(255, 255, 255, 0.9));
		color: var(--auth-dialog-foreground, var(--foreground));
		box-shadow: var(--auth-dialog-shadow, 0 30px 80px rgba(15, 23, 42, 0.55));
	}

	.auth-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.auth-eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.28em;
		font-size: 0.7rem;
		color: var(--auth-dialog-eyebrow, rgba(148, 197, 255, 0.9));
		font-weight: 600;
	}

	.auth-header h2 {
		margin: 0;
		font-size: 2.2rem;
		font-weight: 600;
	}

	.auth-alt-copy {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--app-subtitle-color);
	}

	.auth-alt-label {
		text-transform: uppercase;
		letter-spacing: 0.35em;
		font-size: 0.65rem;
		color: var(--app-subtitle-color);
		font-weight: 600;
	}

	.auth-alt-text {
		margin: 0;
		line-height: 1.5;
		color: var(--app-subtitle-color);
		font-weight: 500;
	}

	.auth-alert {
		border-radius: 1rem;
		padding: 0.85rem 1.1rem;
		font-size: 0.9rem;
		line-height: 1.45;
		font-weight: 500;
	}

	.auth-alert.info {
		background: rgba(14, 165, 233, 0.18);
		border: 1px solid rgba(14, 165, 233, 0.45);
		color: #bae6fd;
	}

	.auth-alert.error {
		background: rgba(239, 68, 68, 0.18);
		border: 1px solid rgba(248, 113, 113, 0.5);
		color: #fee2e2;
	}

	.auth-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-radius: 1.25rem;
		background: rgba(148, 163, 184, 0.12);
		padding: 0.85rem 1.1rem;
		font-size: 0.8rem;
		color: var(--app-subtitle-color);
		font-weight: 500;
	}

	.auth-footer button {
		background: none;
		border: none;
		padding: 0;
		color: #1d4ed8;
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: transparent;
		cursor: pointer;
		transition:
			color 0.25s ease,
			text-decoration-color 0.25s ease;
	}

	.auth-footer button:hover {
		color: #0f172a;
		text-decoration-color: currentColor;
	}

	.auth-footer button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	:global(.auth-dialog [data-slot='dialog-close']),
	:global(.anon-dialog [data-slot='dialog-close']) {
		display: none !important;
	}

	:global(.anon-dialog) {
		max-width: 26rem;
		border-radius: 1.5rem;
		border: 1px solid var(--auth-dialog-border, rgba(15, 23, 42, 0.12));
		background: var(--auth-dialog-bg, rgba(255, 255, 255, 0.92));
		color: var(--auth-dialog-foreground, var(--foreground));
		box-shadow: var(--auth-dialog-shadow, 0 30px 80px rgba(15, 23, 42, 0.55));
	}

	:global(.anon-header) {
		padding: 2rem 2rem 0;
		text-align: center;
	}

	:global(.anon-header [data-slot='dialog-title']) {
		font-size: 1.4rem;
		font-weight: 600;
	}

	:global(.anon-header [data-slot='dialog-description']) {
		margin-top: 0.85rem;
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--auth-dialog-subtitle, rgba(15, 23, 42, 0.72));
		font-weight: 500;
	}

	:global(.anon-footer) {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 2rem;
		align-items: stretch;
	}

	@media (min-width: 40rem) {
		:global(.anon-footer) {
			flex-direction: row;
			align-items: center;
		}
	}

	:global(.anon-footer [data-slot='button']) {
		width: 100%;
	}

	:global(.anon-cancel) {
		flex: 1;
		background: #0284c7 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(14, 165, 233, 0.35);
	}

	:global(.anon-cancel:hover) {
		background: #0ea5e9 !important;
	}

	:global(.anon-continue) {
		flex: 1;
		background: #f97316 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(251, 146, 60, 0.35);
	}

	:global(.anon-continue:hover) {
		background: #fb923c !important;
	}

	:global(.anon-continue:disabled) {
		opacity: 0.75;
		cursor: progress;
	}

	/* Dark theme tokens and automatic switching for auth backdrop */
	:global([data-theme='dark'] .auth-backdrop) {
		--app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
		--app-halo: rgba(129, 140, 248, 0.36);
		--blob-gold: rgba(129, 140, 248, 0.45);
		--blob-yellow: rgba(88, 28, 135, 0.4);
		--blob-yellow-soft: rgba(56, 189, 248, 0.28);
		--blob-pink: rgba(129, 140, 248, 0.38);
		--blob-blue: rgba(56, 189, 248, 0.26);
		--blob-opacity: 0.78;
		--app-content-bg: rgba(6, 11, 25, 0.78);
		--app-content-border: rgba(148, 163, 184, 0.26);
		--app-subtitle-color: rgba(226, 232, 240, 0.78);
		--auth-dialog-border: rgba(148, 163, 184, 0.26);
		--auth-dialog-foreground: #e2e8f0;
		--auth-dialog-subtitle: rgba(226, 232, 240, 0.78);
		--auth-dialog-shadow: 0 30px 80px rgba(2, 6, 23, 0.75);
		color: var(--foreground);
	}

	:global([data-theme='dark'] .auth-blob-field) {
		background:
			radial-gradient(64% 64% at 16% 20%, var(--blob-gold), transparent 72%),
			radial-gradient(58% 58% at 78% 24%, var(--blob-blue), transparent 74%),
			radial-gradient(56% 56% at 24% 78%, var(--blob-yellow-soft), transparent 76%),
			radial-gradient(60% 60% at 82% 70%, var(--blob-pink), transparent 80%),
			radial-gradient(70% 70% at 50% 50%, var(--blob-yellow), transparent 82%);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .auth-backdrop) {
			--app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
			--app-halo: rgba(129, 140, 248, 0.36);
			--blob-gold: rgba(129, 140, 248, 0.45);
			--blob-yellow: rgba(88, 28, 135, 0.4);
			--blob-yellow-soft: rgba(56, 189, 248, 0.28);
			--blob-pink: rgba(129, 140, 248, 0.38);
			--blob-blue: rgba(56, 189, 248, 0.26);
			--blob-opacity: 0.78;
			--app-content-bg: rgba(6, 11, 25, 0.78);
			--app-content-border: rgba(148, 163, 184, 0.26);
			--app-subtitle-color: rgba(226, 232, 240, 0.78);
			--auth-dialog-border: rgba(148, 163, 184, 0.26);
			--auth-dialog-foreground: #e2e8f0;
			--auth-dialog-subtitle: rgba(226, 232, 240, 0.78);
			--auth-dialog-shadow: 0 30px 80px rgba(2, 6, 23, 0.75);
			color: var(--foreground);
		}

		:global(:root:not([data-theme='light']) .auth-blob-field) {
			background:
				radial-gradient(64% 64% at 16% 20%, var(--blob-gold), transparent 72%),
				radial-gradient(58% 58% at 78% 24%, var(--blob-blue), transparent 74%),
				radial-gradient(56% 56% at 24% 78%, var(--blob-yellow-soft), transparent 76%),
				radial-gradient(60% 60% at 82% 70%, var(--blob-pink), transparent 80%),
				radial-gradient(70% 70% at 50% 50%, var(--blob-yellow), transparent 82%);
		}
	}
</style>
