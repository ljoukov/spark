<script lang="ts">
	import { onMount } from 'svelte';
	import { getFirebaseApp, firebaseSignOut } from '$lib/utils/firebaseClient';
	import {
		getAuth,
		GoogleAuthProvider,
		signInWithRedirect,
		getRedirectResult,
		onAuthStateChanged,
		setPersistence,
		browserLocalPersistence,
		browserSessionPersistence,
		type User
	} from 'firebase/auth';

	let user: User | null = null;
	let redirectStatus: 'idle' | 'starting' | 'success' | 'no-result' | 'error' = 'idle';
	let errorMessage: string | null = null;

	function getErrorMessage(err: unknown): string {
		if (typeof err === 'string') {
			return err;
		}
		if (err && typeof err === 'object' && 'message' in err) {
			const withMessage = err as { message?: unknown };
			return typeof withMessage.message === 'string'
				? withMessage.message
				: String(withMessage.message);
		}
		return String(err);
	}

	function ensureAuth() {
		const app = getFirebaseApp();
		const auth = getAuth(app);
		return auth;
	}

	async function signInWithGoogleRedirect() {
		errorMessage = null;
		redirectStatus = 'starting';
		const auth = ensureAuth();

		try {
			// Ensure persistence survives full-page redirects
			await setPersistence(auth, browserLocalPersistence);
		} catch {
			await setPersistence(auth, browserSessionPersistence);
		}

		const provider = new GoogleAuthProvider();
		provider.setCustomParameters({ prompt: 'select_account' });
		signInWithRedirect(auth, provider).catch((err) => {
			redirectStatus = 'error';
			errorMessage = getErrorMessage(err);
		});
	}

	async function signOut() {
		errorMessage = null;
		try {
			await firebaseSignOut();
		} catch (err) {
			errorMessage = getErrorMessage(err);
		}
	}

	onMount(() => {
		const auth = ensureAuth();

		const unsubscribe = onAuthStateChanged(auth, (u) => {
			user = u;
		});

		(async () => {
			try {
				// Ensure we use durable persistence before processing redirect result
				try {
					await setPersistence(auth, browserLocalPersistence);
				} catch {
					await setPersistence(auth, browserSessionPersistence);
				}

				const result = await getRedirectResult(auth);
				if (result) {
					user = result.user;
					redirectStatus = 'success';
				} else {
					redirectStatus = 'no-result';
				}
			} catch (err) {
				redirectStatus = 'error';
				errorMessage = getErrorMessage(err);
			}
		})();

		return () => {
			unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>Welcome — Firebase Redirect Test</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main style="max-width: 720px; margin: 2rem auto; padding: 1rem; font: inherit;">
	<h1 style="margin-bottom: 1rem;">Firebase Sign-in (Redirect) Test</h1>

	{#if user}
		<div style="margin: 1rem 0; padding: 0.75rem 1rem; border: 1px solid #ddd; border-radius: 8px;">
			<p style="margin: 0 0 0.5rem 0;">Signed in as:</p>
			<p style="margin: 0.25rem 0; font-weight: 600;">
				{user.displayName ?? user.email ?? '(no display name)'}
			</p>
			<p style="margin: 0.25rem 0; color: #666; font-size: 0.9em;">uid: {user.uid}</p>
			<div style="margin-top: 0.75rem;">
				<button
					on:click={signOut}
					style="padding: 0.5rem 0.9rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;"
				>
					Sign out
				</button>
			</div>
		</div>
	{:else}
		<p style="margin: 0.5rem 0 1rem 0;">Not signed in.</p>
		<button
			on:click={signInWithGoogleRedirect}
			style="padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;"
		>
			Sign in with Google (redirect)
		</button>
	{/if}

	<div style="margin-top: 1rem;">
		<p style="margin: 0.25rem 0; color: #666; font-size: 0.9em;">
			Redirect status: {redirectStatus}
		</p>
		{#if errorMessage}
			<pre
				style="white-space: pre-wrap; background: #f8f8f8; border: 1px solid #eee; padding: 0.75rem; border-radius: 6px; color: #b00020;">{errorMessage}</pre>
		{/if}
	</div>
</main>
