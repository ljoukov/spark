<script lang="ts">
	import { onMount } from 'svelte';
	import { getFirebaseApp, startGoogleSignInRedirect } from '$lib/utils/firebaseClient';
	import { clearIdTokenCookie, setIdTokenCookie } from '$lib/auth/tokenCookie';
	import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';

	const GOOGLE_REDIRECT_FLAG = 'spark:googleRedirectInFlight';
	const RESUME_TIMEOUT_MS = 2500;

	let redirecting = $state(false);
	let lastSyncedUid = $state<string | null>(null);

	const ui = $state({
		startingGoogleRedirect: false,
		syncingProfile: false,
		errorMessage: ''
	});

	const statusMessage = $derived(
		ui.syncingProfile
			? 'Finishing sign-in…'
			: ui.startingGoogleRedirect
				? 'Redirecting to Google…'
				: ''
	);

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

	function redirectToTarget(): void {
		if (redirecting) {
			return;
		}
		redirecting = true;
		if (typeof window !== 'undefined') {
			window.location.href = resolveRedirectTarget();
		}
	}

	function isRedirectInFlight(): boolean {
		if (typeof window === 'undefined') {
			return false;
		}
		try {
			return window.sessionStorage.getItem(GOOGLE_REDIRECT_FLAG) === '1';
		} catch {
			return false;
		}
	}

	function markRedirectInFlight(): void {
		if (typeof window === 'undefined') {
			return;
		}
		try {
			window.sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, '1');
		} catch {
			// Ignore storage failures; redirect still works without a loop guard.
		}
	}

	function clearRedirectInFlight(): void {
		if (typeof window === 'undefined') {
			return;
		}
		try {
			window.sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
		} catch {
			// Ignore.
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
		clearRedirectInFlight();

		if (lastSyncedUid === user.uid) {
			const mirrored = await mirrorCookie(user);
			if (mirrored) {
				redirectToTarget();
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

		redirectToTarget();
	}

	async function startRedirect(): Promise<void> {
		if (ui.startingGoogleRedirect || ui.syncingProfile || redirecting) {
			return;
		}
		ui.errorMessage = '';
		ui.startingGoogleRedirect = true;
		try {
			markRedirectInFlight();
			await startGoogleSignInRedirect();
		} catch (error) {
			const fallback = 'Unable to start Google sign-in. Please try again.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			ui.startingGoogleRedirect = false;
			clearRedirectInFlight();
		}
	}

	onMount(() => {
		if (typeof window === 'undefined') {
			return () => {};
		}

		const auth = getAuth(getFirebaseApp());
		const redirectInFlightAtBoot = isRedirectInFlight();
		let resumeTimer: number | null = null;

		const unsubscribe = onAuthStateChanged(auth, (user) => {
			if (resumeTimer !== null) {
				window.clearTimeout(resumeTimer);
				resumeTimer = null;
			}

			if (!user) {
				clearIdTokenCookie();
				if (redirectInFlightAtBoot) {
					resumeTimer = window.setTimeout(() => {
						resumeTimer = null;
						if (auth.currentUser) {
							return;
						}
						clearRedirectInFlight();
						ui.errorMessage = 'Unable to resume Google sign-in. Please try again.';
						ui.startingGoogleRedirect = false;
					}, RESUME_TIMEOUT_MS);
				} else {
					void startRedirect();
				}
				return;
			}

			void finishSignIn(user);
		});

		return () => {
			unsubscribe();
			if (resumeTimer !== null) {
				window.clearTimeout(resumeTimer);
				resumeTimer = null;
			}
		};
	});
</script>

<svelte:head>
	<title>Signing in · Spark</title>
</svelte:head>

<div class="continue-backdrop" aria-live="polite">
	<div class="continue-card">
		<h1 class="continue-title">Signing you in…</h1>
		{#if statusMessage}
			<p class="continue-status">{statusMessage}</p>
		{/if}
		{#if ui.errorMessage}
			<p class="continue-error">{ui.errorMessage}</p>
			<div class="continue-actions">
				<button type="button" class="continue-button" onclick={() => void startRedirect()}>
					Try again
				</button>
				<a class="continue-link" href={`/login?redirectTo=${encodeURIComponent(resolveRedirectTarget())}`}>
					Back to login
				</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.continue-backdrop {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 3rem 1.5rem;
		background:
			radial-gradient(120% 120% at 50% -10%, hsla(45 87% 90% / 0.7) 0%, transparent 70%),
			hsl(38 82% 97%);
		color: hsl(222 47% 11%);
	}

	.continue-card {
		width: min(420px, 100%);
		padding: 2.25rem 2.25rem 2rem;
		border-radius: 1.75rem;
		background: rgba(255, 255, 255, 0.96);
		border: 1px solid rgba(15, 23, 42, 0.12);
		box-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.5);
		backdrop-filter: blur(22px);
		text-align: center;
	}

	.continue-title {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.continue-status {
		margin: 0.75rem 0 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: rgba(30, 41, 59, 0.78);
		font-weight: 500;
	}

	.continue-error {
		margin: 1.25rem 0 0;
		border-radius: 1rem;
		padding: 0.85rem 1.1rem;
		font-size: 0.9rem;
		line-height: 1.45;
		font-weight: 500;
		background: rgba(239, 68, 68, 0.18);
		border: 1px solid rgba(248, 113, 113, 0.5);
		color: hsl(0 84% 60%);
	}

	.continue-actions {
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: center;
	}

	.continue-button {
		border: 0;
		border-radius: 999px;
		padding: 0.85rem 1.25rem;
		width: min(240px, 100%);
		font-size: 0.95rem;
		font-weight: 600;
		background: #1d4ed8;
		color: white;
		cursor: pointer;
	}

	.continue-button:hover {
		filter: brightness(1.05);
	}

	.continue-link {
		font-size: 0.9rem;
		font-weight: 600;
		color: #1d4ed8;
		text-decoration: none;
	}

	.continue-link:hover {
		text-decoration: underline;
	}
	
	@media (prefers-reduced-motion: reduce) {
		.continue-button {
			transition: none;
		}
	}
</style>
