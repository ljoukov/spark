<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuth, onAuthStateChanged, type Auth, type User } from 'firebase/auth';

	import { Button } from '$lib/components/ui/button/index.js';
	import { firebaseSignOut, getFirebaseApp } from '$lib/utils/firebaseClient';
	import { clearIdTokenCookie } from '$lib/auth/tokenCookie';

	type LogoutStatus = 'checking' | 'signing_out' | 'signed_out' | 'not_signed_in' | 'error';

	function headingForStatus(status: LogoutStatus, wasGuest: boolean): string {
		switch (status) {
			case 'checking':
				return 'Just a moment…';
			case 'signing_out':
				return wasGuest ? 'Deleting guest account' : 'Signing you out';
			case 'signed_out':
				return wasGuest ? 'Guest account deleted' : 'Signed out of Spark';
			case 'not_signed_in':
				return 'You are not logged into Spark';
			case 'error':
			default:
				return "We couldn't finish signing you out";
		}
	}

	function descriptionForStatus(status: LogoutStatus, wasGuest: boolean): string {
		switch (status) {
			case 'checking':
				return 'Checking your session details.';
			case 'signing_out':
				return wasGuest
					? "We're clearing this guest session from the device."
					: "We're clearing your Spark session securely.";
			case 'signed_out':
				return wasGuest
					? 'Your guest session has been cleared on this device.'
					: 'You can now close this tab or head back to the Spark login page.';
			case 'not_signed_in':
				return 'Use the button below to sign in and pick up where you left off.';
			case 'error':
			default:
				return "Something didn't go to plan. Please try again in a moment.";
		}
	}

	function busyLabelForStatus(status: LogoutStatus, wasGuest: boolean): string {
		if (status === 'signing_out') {
			return wasGuest ? 'Deleting guest account…' : 'Signing you out…';
		}
		return 'Checking your session…';
	}

	function hintForStatus(status: LogoutStatus, wasGuest: boolean): string | null {
		if (status === 'signed_out') {
			return wasGuest
				? 'Guest account deleted. You can sign in whenever you are ready.'
				: 'You are fully signed out. Head back to the Spark login page whenever you are ready.';
		}
		return null;
	}

	const ui = $state({
		status: 'checking' as LogoutStatus,
		errorMessage: '',
		wasGuest: false
	});

	const returnHref = $derived('/');

	let authInstance: Auth | null = null;

	const isBusy = $derived(ui.status === 'checking' || ui.status === 'signing_out');
	const heading = $derived(headingForStatus(ui.status, ui.wasGuest));
	const description = $derived(descriptionForStatus(ui.status, ui.wasGuest));
	const busyLabel = $derived(busyLabelForStatus(ui.status, ui.wasGuest));
	const hint = $derived(hintForStatus(ui.status, ui.wasGuest));
	const showLoginLink = $derived(ui.status === 'signed_out' || ui.status === 'not_signed_in');
	const showRetry = $derived(ui.status === 'error');

	onMount(() => {
		const auth = getAuth(getFirebaseApp());
		authInstance = auth;

		let resolved = false;
		const unsubscribe = onAuthStateChanged(auth, async (user) => {
			if (resolved) {
				return;
			}
			resolved = true;
			await attemptSignOut(user);
			unsubscribe();
		});

		return () => {
			if (!resolved) {
				unsubscribe();
			}
		};
	});

	async function attemptSignOut(user: User | null): Promise<void> {
		ui.errorMessage = '';
		ui.wasGuest = Boolean(user?.isAnonymous);
		if (!user) {
			clearIdTokenCookie();
			ui.status = 'not_signed_in';
			return;
		}

		ui.status = 'signing_out';
		try {
			await firebaseSignOut();
			clearIdTokenCookie();
			ui.status = 'signed_out';
		} catch (error) {
			const fallback = 'Unexpected error while signing out. Please try again.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			ui.status = 'error';
		}
	}

	async function handleRetry(): Promise<void> {
		const auth = authInstance ?? getAuth(getFirebaseApp());
		authInstance = auth;
		await attemptSignOut(auth.currentUser);
	}
</script>

<svelte:head>
	<title>Logout • Spark</title>
</svelte:head>

<div class="auth-backdrop" aria-live="polite">
	<div class="auth-blob-field" aria-hidden="true"></div>
	<div class="auth-card" data-status={ui.status}>
		<header class="auth-header">
			<p class="auth-eyebrow">Spark session</p>
			<h2 class="auth-title">{heading}</h2>
			<p class="auth-alt-text">{description}</p>
		</header>

		{#if isBusy}
			<div class="logout-progress" role="status" aria-live="polite">
				<span class="logout-spinner" aria-hidden="true"></span>
				<span class="logout-progress__label">{busyLabel}</span>
			</div>
		{:else if ui.status === 'error' && ui.errorMessage}
			<p class="auth-alert error" role="alert">{ui.errorMessage}</p>
		{:else if hint}
			<p class="auth-alert info">{hint}</p>
		{/if}

		{#if !isBusy && (showLoginLink || showRetry)}
			<footer class="logout-footer">
				{#if showLoginLink}
					<Button href={returnHref} size="lg" class="logout-action">Back to Spark</Button>
				{/if}
				{#if showRetry}
					<Button
						type="button"
						variant="outline"
						size="lg"
						class="logout-action logout-action--retry"
						onclick={handleRetry}
					>
						Try again
					</Button>
				{/if}
			</footer>
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

	.logout-progress {
		display: flex;
		align-items: center;
		gap: 1rem;
		border-radius: 9999px;
		padding: 0.75rem 1.25rem;
		background: rgba(14, 165, 233, 0.14);
		border: 1px solid rgba(14, 165, 233, 0.35);
		color: #0f172a;
		font-weight: 500;
		font-size: 0.9rem;
	}

	.logout-progress__label {
		flex: 1;
	}

	.logout-spinner {
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 50%;
		border: 3px solid rgba(14, 165, 233, 0.28);
		border-right-color: rgba(14, 165, 233, 0.95);
		animation: logout-spin 0.9s linear infinite;
	}

	@keyframes logout-spin {
		0% {
			transform: rotate(0deg);
		}

		100% {
			transform: rotate(360deg);
		}
	}

	.logout-footer {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	:global(.logout-action) {
		width: 100%;
		border-radius: 9999px;
		justify-content: center;
	}

	:global(.logout-action--retry) {
		background: rgba(15, 23, 42, 0.06);
	}

	@media (min-width: 40rem) {
		.logout-footer {
			flex-direction: row;
		}

		:global(.logout-action) {
			flex: 1;
		}
	}

	:global([data-slot='dialog-overlay']) {
		background: rgba(2, 6, 23, 0.68);
		backdrop-filter: blur(4px);
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
		--auth-footer-link: #93c5fd;
		--auth-footer-link-hover: #e2e8f0;
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
			--auth-footer-link: #93c5fd;
			--auth-footer-link-hover: #e2e8f0;
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
