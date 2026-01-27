<script lang="ts">
	import { onMount } from 'svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { getFirebaseApp, startGoogleSignInRedirect } from '$lib/utils/firebaseClient';
	import { clearIdTokenCookie, setIdTokenCookie } from '$lib/auth/tokenCookie';
	import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';

	let redirecting = $state(false);
	let lastSyncedUid = $state<string | null>(null);

	const ui = $state({
		signingInWithGoogle: false,
		syncingProfile: false,
		errorMessage: ''
	});

	const googleButtonLabel = $derived(
		ui.signingInWithGoogle ? 'Redirecting to Google…' : 'Continue with Google'
	);
	const syncingMessage = $derived(
		ui.syncingProfile && !ui.errorMessage ? 'Finishing sign-in…' : ''
	);

	function resetError() {
		ui.errorMessage = '';
	}

	function redirectToSpark(): void {
		if (redirecting) {
			return;
		}
		redirecting = true;
		if (typeof window !== 'undefined') {
			window.location.href = '/spark';
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

	async function handleGoogleSignIn() {
		if (ui.signingInWithGoogle || ui.syncingProfile || redirecting) {
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

	onMount(() => {
		if (typeof window === 'undefined') {
			return () => {};
		}

		const auth = getAuth(getFirebaseApp());
		const unsubscribe = onAuthStateChanged(auth, async (user) => {
			if (!user) {
				clearIdTokenCookie();
				ui.signingInWithGoogle = false;
				lastSyncedUid = null;
				return;
			}

			const navigateToSpark = () => {
				ui.errorMessage = '';
				redirectToSpark();
			};

			if (lastSyncedUid === user.uid) {
				const mirrored = await mirrorCookie(user);
				if (mirrored) {
					navigateToSpark();
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
			navigateToSpark();
		});

		return () => {
			unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>Login · Spark</title>
</svelte:head>

<div class="auth-backdrop" aria-live="polite">
	<div class="auth-blob-field" aria-hidden="true"></div>
	<div class="auth-card">
		<header class="auth-header">
			<p class="auth-eyebrow">Spark account</p>
			<h1 class="auth-title">Sign in to Spark</h1>
			<p class="auth-alt-text">Continue with Google to open your workspace.</p>
		</header>

		<Button
			onclick={handleGoogleSignIn}
			disabled={ui.signingInWithGoogle || ui.syncingProfile || redirecting}
			class={buttonVariants({ variant: 'default', size: 'lg' }) +
				' w-full justify-center rounded-full'}
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

		{#if syncingMessage}
			<p class="auth-alert info">{syncingMessage}</p>
		{/if}

		{#if ui.errorMessage}
			<p class="auth-alert error">{ui.errorMessage}</p>
		{/if}
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
		--app-content-border: rgba(255, 255, 255, 0.55);
		--app-subtitle-color: var(--text-secondary, rgba(30, 41, 59, 0.78));
		--auth-dialog-border: rgba(15, 23, 42, 0.12);
		--auth-dialog-foreground: #0f172a;
		--auth-dialog-subtitle: rgba(30, 41, 59, 0.78);
		--auth-dialog-eyebrow: rgba(30, 64, 175, 0.82);
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
		gap: 1.75rem;
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
		font-size: clamp(2rem, 4vw, 2.4rem);
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

	:global([data-theme='dark'] .auth-alert.info) {
		background: rgba(14, 165, 233, 0.22);
		border: 1px solid rgba(56, 189, 248, 0.45);
		color: #e0f2fe;
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

		:global(:root:not([data-theme='light']) .auth-alert.info) {
			background: rgba(14, 165, 233, 0.22);
			border: 1px solid rgba(56, 189, 248, 0.45);
			color: #e0f2fe;
		}
	}
</style>
