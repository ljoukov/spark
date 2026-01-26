<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		firebaseSignOut,
		getRedirectResultIdToken,
		startGoogleSignInRedirect
	} from '$lib/utils/firebaseClient';
	import type { AdminSessionState } from '$lib/types/admin';
	import { onMount } from 'svelte';

	let { session }: { session: AdminSessionState } = $props();

	type FetchErrorPayload = { message?: string } | null;

	const ui = $state({
		signingIn: false,
		signingOut: false,
		errorMessage: '',
		successMessage: ''
	});

	const isAdmin = $derived(session.status === 'admin');
	const isSignedOut = $derived(session.status === 'signed_out');
	const signedInUser = $derived(
		session.status === 'admin' || session.status === 'not_admin' ? session.user : null
	);

	const primaryActionLabel = $derived(ui.signingIn ? 'Signing in…' : 'Sign in with Google');
	const signOutLabel = $derived(ui.signingOut ? 'Signing out…' : 'Sign out');

	function resetMessages() {
		ui.errorMessage = '';
		ui.successMessage = '';
	}

	async function exchangeIdToken(idToken: string, { showSuccessMessage = true } = {}) {
		resetMessages();
		ui.signingIn = true;

		try {
			const response = await fetch('/admin/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ idToken })
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as FetchErrorPayload;
				await firebaseSignOut();
				ui.errorMessage = payload?.message ?? 'Unable to sign in. Please try again.';
				return;
			}

			if (showSuccessMessage) {
				ui.successMessage = 'Signed in successfully.';
			}
			await invalidateAll();
		} catch (error) {
			const fallback = 'Unexpected error while signing in.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
			ui.signingIn = false;
		}
	}

	async function resumeGoogleSignIn() {
		if (typeof window === 'undefined') {
			return;
		}

		try {
			const idToken = await getRedirectResultIdToken();
			if (!idToken) {
				return;
			}
			await exchangeIdToken(idToken, { showSuccessMessage: false });
		} catch (error) {
			const fallback = 'Unexpected error while resuming sign in.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		}
	}

	onMount(() => {
		if (session.status === 'signed_out') {
			void resumeGoogleSignIn();
		}
	});

	async function handleGoogleSignIn() {
		resetMessages();
		ui.signingIn = true;

		try {
			await startGoogleSignInRedirect();
		} catch (error) {
			const fallback = 'Unexpected error while starting sign in.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			ui.signingIn = false;
		}
	}

	async function handleSignOut() {
		resetMessages();
		ui.signingOut = true;

		try {
			const response = await fetch('/admin/session', { method: 'DELETE' });
			await firebaseSignOut();
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as FetchErrorPayload;
				ui.errorMessage = payload?.message ?? 'Could not clear session. Please refresh.';
				return;
			}

			ui.successMessage = 'Signed out.';
			if (typeof window !== 'undefined') {
				window.location.href = '/admin';
				return;
			}
			await invalidateAll();
		} catch (error) {
			const fallback = 'Unexpected error while signing out.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
			ui.signingOut = false;
		}
	}
</script>

<div class="min-h-[100vh] bg-background px-4 py-16">
	<div class="mx-auto flex max-w-lg flex-col gap-10">
		<header class="text-center">
			<h1 class="text-3xl font-semibold text-foreground">Spark Admin</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				Secure area for internal tools. Sign in with an authorized Google account to continue.
			</p>
		</header>

		<section
			class="rounded-3xl border border-border bg-card p-8 shadow-xl shadow-black/5 backdrop-blur"
		>
			{#if isAdmin}
				<div class="flex flex-col gap-4 text-sm">
					<p class="text-muted-foreground">Signed in as:</p>
					<div class="rounded-xl border border-border bg-background/60 p-4 shadow-inner">
						<p class="font-medium text-foreground">{signedInUser?.email ?? signedInUser?.uid}</p>
						{#if signedInUser?.name}
							<p class="mt-1 text-xs text-muted-foreground">{signedInUser.name}</p>
						{/if}
						<p class="mt-2 text-xs text-muted-foreground">UID: {signedInUser?.uid}</p>
					</div>
					<p class="text-sm text-muted-foreground">
						You're authenticated. Choose a tool from the admin navigation.
					</p>
					<button
						type="button"
						class="text-destructive-foreground inline-flex items-center justify-center rounded-full bg-destructive px-5 py-2 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleSignOut}
						disabled={ui.signingOut}
					>
						{signOutLabel}
					</button>
				</div>
			{:else if !isSignedOut}
				<div class="flex flex-col gap-4 text-sm">
					<p class="font-medium text-foreground">Access denied</p>
					<p class="text-muted-foreground">
						The account {signedInUser?.email ?? signedInUser?.uid} is not authorized for admin access.
					</p>
					<button
						type="button"
						class="text-destructive-foreground inline-flex items-center justify-center rounded-full bg-destructive px-5 py-2 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleSignOut}
						disabled={ui.signingOut}
					>
						{signOutLabel}
					</button>
				</div>
			{:else}
				<div class="flex flex-col gap-6">
					<button
						type="button"
						class="inline-flex items-center justify-center gap-3 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleGoogleSignIn}
						disabled={ui.signingIn}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 533.5 544.3"
							class="h-5 w-5"
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
						<span>{primaryActionLabel}</span>
					</button>
					<p class="text-xs text-muted-foreground">
						We only grant access to approved internal accounts.
					</p>
				</div>
			{/if}

			{#if ui.errorMessage}
				<p class="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{ui.errorMessage}
				</p>
			{/if}

			{#if ui.successMessage}
				<p
					class="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
				>
					{ui.successMessage}
				</p>
			{/if}
		</section>
	</div>
</div>
