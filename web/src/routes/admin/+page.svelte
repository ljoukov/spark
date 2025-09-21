<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { firebaseSignOut, googleSignInAndGetIdToken } from '$lib/utils/firebaseClient';
	import type { PageData } from './$types';

	type FetchErrorPayload = { message?: string } | null;

	let { data } = $props<{ data: PageData }>();

	const ui = $state({
		signingIn: false,
		signingOut: false,
		errorMessage: '',
		successMessage: ''
	});

	function resetMessages() {
		ui.errorMessage = '';
		ui.successMessage = '';
	}

	async function handleGoogleSignIn() {
		resetMessages();
		ui.signingIn = true;

		try {
			const idToken = await googleSignInAndGetIdToken();
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

			ui.successMessage = 'Signed in successfully.';
			await invalidateAll();
		} catch (error) {
			const fallback = 'Unexpected error while signing in.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
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
			await invalidateAll();
		} catch (error) {
			const fallback = 'Unexpected error while signing out.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
			ui.signingOut = false;
		}
	}

	const primaryActionLabel = $derived(ui.signingIn ? 'Signing in...' : 'Sign in with Google');

	const signOutLabel = $derived(ui.signingOut ? 'Signing out...' : 'Sign out');
</script>

<svelte:head>
	<title>Admin · GCSE Spark</title>
</svelte:head>

<div class="min-h-screen px-4 py-16">
	<div class="mx-auto flex max-w-lg flex-col gap-12">
		<header class="text-center">
			<h1 class="text-3xl font-semibold text-[color:var(--text-primary)]">GCSE Spark Admin</h1>
			<p class="mt-2 text-sm text-[color:var(--text-secondary)]">
				Secure area for internal tools. Sign in with an authorized Google account to continue.
			</p>
		</header>

		<section
			class="rounded-3xl border border-[color:var(--surface-border)] bg-[color:var(--surface-color)] p-8 shadow-xl shadow-[color:var(--shadow-color)] backdrop-blur"
		>
			{#if data.status === 'admin'}
				<div class="flex flex-col gap-4">
					<p class="text-sm text-[color:var(--text-secondary)]">Signed in as:</p>
					<div
						class="rounded-xl bg-white/60 p-4 text-sm text-[color:var(--text-primary)] shadow-inner shadow-[color:var(--shadow-color)] dark:bg-slate-900/60"
					>
						<p class="font-medium">{data.user.email ?? data.user.uid}</p>
						{#if data.user.name}
							<p class="mt-1 text-xs text-[color:var(--text-secondary)]">{data.user.name}</p>
						{/if}
						<p class="mt-2 text-xs text-[color:var(--text-secondary)]">UID: {data.user.uid}</p>
					</div>
					<p class="text-sm text-[color:var(--text-secondary)]">
						You're authenticated. Choose a tool from the admin navigation.
					</p>
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-full bg-red-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
						onclick={handleSignOut}
						disabled={ui.signingOut}
					>
						{signOutLabel}
					</button>
				</div>
			{:else if data.status === 'not_admin'}
				<div class="flex flex-col gap-4">
					<p class="font-medium text-[color:var(--text-primary)]">Access denied</p>
					<p class="text-sm text-[color:var(--text-secondary)]">
						The account {data.user.email ?? data.user.uid} is not authorized for admin access.
					</p>
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-full bg-red-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
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
						class="inline-flex items-center justify-center gap-3 rounded-full bg-[color:var(--text-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-primary)] disabled:cursor-not-allowed disabled:bg-[rgba(15,23,42,0.4)]"
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
								d="M533.5 278.4c0-17.4-1.5-34.1-4.4-50.2H272v95.0h147.2c-6.4 34.6-25.9 63.9-55.1 83.5v69.0h88.9c52.1-47.9 80.5-118.4 80.5-197.3z"
							/>
							<path
								fill="#34a853"
								d="M272 544.3c74.7 0 137.4-24.7 183.2-67.6l-88.9-69.0c-24.7 16.6-56.3 26.4-94.3 26.4-72.6 0-134-49.0-155.9-114.9H24.2v72.3C69.4 482.2 162.5 544.3 272 544.3z"
							/>
							<path
								fill="#fbbc04"
								d="M116.1 318.9c-4.2-12.6-6.6-26.1-6.6-40s2.4-27.4 6.6-40V166.6H24.2C9.0 196.3 0 231.4 0 268.9s9.0 72.6 24.2 102.3l91.9-72.3z"
							/>
							<path
								fill="#ea4335"
								d="M272 107.7c40.8 0 77.3 14.0 106.1 41.4l79.6-79.6C409.4 24.8 346.7 0 272 0 162.5 0 69.4 62.1 24.2 166.6l91.9 72.3C138 156.7 199.4 107.7 272 107.7z"
							/>
						</svg>
						<span>{primaryActionLabel}</span>
					</button>
					<p class="text-xs text-[color:var(--text-secondary)]">
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
