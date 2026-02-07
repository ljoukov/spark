<script lang="ts">
	import { onMount } from 'svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { clearIdTokenCookie, setIdTokenCookie } from '$lib/auth/tokenCookie';
	import { getAuth, signInWithEmailAndPassword, type User } from 'firebase/auth';

	let email = $state('');
	let password = $state('');
	let redirecting = $state(false);
	let lastSyncedUid = $state<string | null>(null);

	const ui = $state({
		signingIn: false,
		syncingProfile: false,
		errorMessage: ''
	});

	function resetError() {
		ui.errorMessage = '';
	}

	function resolveRedirectTarget(): string {
		if (typeof window === 'undefined') {
			return '/spark';
		}
		const raw = new URL(window.location.href).searchParams.get('redirectTo');
		if (!raw) {
			return '/spark';
		}
		if (!raw.startsWith('/') || raw.startsWith('//')) {
			return '/spark';
		}
		if (raw.includes('\n') || raw.includes('\r')) {
			return '/spark';
		}
		return raw;
	}

	function redirectToSpark(): void {
		if (redirecting) {
			return;
		}
		redirecting = true;
		if (typeof window !== 'undefined') {
			window.location.href = resolveRedirectTarget();
		}
	}

	type SyncErrorDetails = {
		status: number;
		payload: unknown;
	};

	function normalizeSyncError(details: SyncErrorDetails | null): string {
		if (!details) {
			return 'Unexpected error while syncing your account.';
		}
		if (details.status === 401) {
			return 'Your Spark session expired. Please sign in again.';
		}
		if (
			details.payload &&
			typeof details.payload === 'object' &&
			details.payload !== null &&
			'message' in details.payload &&
			typeof (details.payload as { message?: unknown }).message === 'string'
		) {
			const message = (details.payload as { message: string }).message.trim();
			if (message.length > 0) {
				return message;
			}
		}
		if (details.payload instanceof Error && typeof details.payload.message === 'string') {
			const message = details.payload.message.trim();
			if (message.length > 0) {
				return message;
			}
		}
		return 'Unexpected error while syncing your account.';
	}

	async function mirrorCookie(user: User): Promise<boolean> {
		try {
			const idToken = await user.getIdToken();
			setIdTokenCookie(idToken);
			return true;
		} catch (error) {
			const fallback = 'Unable to prepare your session. Please try again.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			return false;
		}
	}

	async function syncProfile(user: User): Promise<boolean> {
		ui.syncingProfile = true;
		let lastError: SyncErrorDetails | null = null;
		try {
			for (const forceRefresh of [false, true] as const) {
				let idToken: string;
				try {
					idToken = await user.getIdToken(forceRefresh);
				} catch (error) {
					lastError = { status: 0, payload: error };
					continue;
				}

				try {
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

					if (response.ok) {
						lastSyncedUid = user.uid;
						ui.errorMessage = '';
						return true;
					}

					const payload = await response.json().catch(() => null);
					lastError = { status: response.status, payload };
					if (response.status === 401 && !forceRefresh) {
						continue;
					}
					if (response.status === 401) {
						clearIdTokenCookie();
					}
					ui.errorMessage = normalizeSyncError(lastError);
					return false;
				} catch (error) {
					lastError = { status: 0, payload: error };
					// Retry once with a forced refresh.
				}
			}

			if (lastError && lastError.status === 401) {
				clearIdTokenCookie();
			}
			ui.errorMessage = normalizeSyncError(lastError);
			return false;
		} finally {
			ui.syncingProfile = false;
		}
	}

	async function finishSignIn(user: User): Promise<void> {
		if (lastSyncedUid === user.uid) {
			const mirrored = await mirrorCookie(user);
			if (mirrored) {
				redirectToSpark();
			}
			return;
		}
		const synced = await syncProfile(user);
		if (!synced) {
			return;
		}
		const mirrored = await mirrorCookie(user);
		if (!mirrored) {
			return;
		}
		redirectToSpark();
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (ui.signingIn || ui.syncingProfile || redirecting) {
			return;
		}
		const trimmedEmail = email.trim();
		if (!trimmedEmail || !password) {
			ui.errorMessage = 'Enter both email and password to continue.';
			return;
		}
		resetError();
		ui.signingIn = true;
		try {
			const auth = getAuth(getFirebaseApp());
			const credential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
			await finishSignIn(credential.user);
		} catch (error) {
			const fallback = 'Unable to sign in with that email and password.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
			ui.signingIn = false;
		}
	}

	onMount(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const auth = getAuth(getFirebaseApp());
		if (auth.currentUser) {
			void finishSignIn(auth.currentUser);
		}
	});
</script>

<svelte:head>
	<title>Sign in with email · Spark</title>
</svelte:head>

<div class="auth-backdrop" aria-live="polite">
	<div class="auth-blob-field" aria-hidden="true"></div>
	<div class="auth-card">
		<header class="auth-header">
			<p class="auth-eyebrow">Spark test access</p>
			<h1 class="auth-title">Sign in with email</h1>
			<p class="auth-alt-text">Use the test account credentials from your local env.</p>
		</header>

		<form class="auth-form" onsubmit={handleSubmit}>
			<label class="field">
				<span>Email</span>
				<Input
					type="email"
					placeholder="you@example.com"
					autocomplete="email"
					required
					bind:value={email}
					disabled={ui.signingIn || ui.syncingProfile || redirecting}
				/>
			</label>
			<label class="field">
				<span>Password</span>
				<Input
					type="password"
					placeholder="********"
					autocomplete="current-password"
					required
					bind:value={password}
					disabled={ui.signingIn || ui.syncingProfile || redirecting}
				/>
			</label>
			<Button
				type="submit"
				disabled={ui.signingIn || ui.syncingProfile || redirecting}
				class={buttonVariants({ variant: 'default', size: 'lg' }) +
					' w-full justify-center rounded-full'}
			>
				{ui.signingIn ? 'Signing in...' : 'Continue'}
			</Button>
		</form>

		{#if ui.syncingProfile && !ui.errorMessage}
			<p class="auth-alert info">Finishing sign-in...</p>
		{/if}

		{#if ui.errorMessage}
			<p class="auth-alert error">{ui.errorMessage}</p>
		{/if}

		<footer class="auth-footer">
			<span class="auth-footer__prompt">Need the standard login?</span>
			<a href="/login">Return to Spark login</a>
		</footer>
	</div>
</div>

<style>
	.auth-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(3rem, 6vw, 6rem) clamp(1.5rem, 4vw, 3.5rem);
		overflow-x: hidden;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		background:
			radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
			var(--app-surface);
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
		--auth-dialog-border: rgba(15, 23, 42, 0.12);
		--auth-dialog-foreground: #0f172a;
		--auth-dialog-subtitle: rgba(30, 41, 59, 0.78);
		--auth-dialog-eyebrow: rgba(245, 158, 11, 0.85);
		--auth-dialog-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.5);
	}

	@supports (height: 100dvh) {
		.auth-backdrop {
			min-height: 100dvh;
		}
	}

	.auth-blob-field {
		position: absolute;
		inset: -40%;
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

	.auth-card {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		width: min(420px, 100%);
		padding: clamp(2.5rem, 4vw, 2.9rem) clamp(2.25rem, 4vw, 2.75rem) clamp(2rem, 4vw, 2.5rem);
		border-radius: 1.85rem;
		background: var(--app-content-bg);
		border: 1px solid var(--auth-dialog-border);
		box-shadow: var(--auth-dialog-shadow);
		backdrop-filter: blur(22px);
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
		color: var(--auth-dialog-eyebrow);
		font-weight: 600;
	}

	.auth-title {
		margin: 0;
		font-size: clamp(1.9rem, 3.6vw, 2.2rem);
		font-weight: 600;
		color: var(--auth-dialog-foreground);
	}

	.auth-alt-text {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--auth-dialog-subtitle);
		font-weight: 500;
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: rgba(15, 23, 42, 0.75);
	}

	.auth-alert {
		margin: 0;
		border-radius: 1rem;
		padding: 0.85rem 1.1rem;
		font-size: 0.9rem;
		line-height: 1.45;
		font-weight: 500;
	}

	.auth-alert.info {
		background: rgba(14, 165, 233, 0.16);
		border: 1px solid rgba(14, 165, 233, 0.35);
		color: #0f172a;
	}

	.auth-alert.error {
		background: rgba(239, 68, 68, 0.18);
		border: 1px solid rgba(248, 113, 113, 0.5);
		color: #fee2e2;
	}

	.auth-footer {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		border-radius: 1.25rem;
		background: rgba(148, 163, 184, 0.12);
		padding: 0.85rem 1.1rem;
		font-size: 0.8rem;
		color: var(--auth-dialog-subtitle);
		font-weight: 500;
	}

	.auth-footer a {
		color: #1d4ed8;
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: transparent;
		transition:
			color 0.25s ease,
			text-decoration-color 0.25s ease;
	}

	.auth-footer a:hover {
		color: #0f172a;
		text-decoration-color: currentColor;
	}

	.auth-footer a:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
</style>
