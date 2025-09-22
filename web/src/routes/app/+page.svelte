<script lang="ts">
	import { onMount } from 'svelte';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { getApp } from 'firebase/app';
	import {
		getAuth,
		GoogleAuthProvider,
		signInWithRedirect,
		signInWithPopup,
		getRedirectResult,
		onAuthStateChanged,
		onIdTokenChanged,
		setPersistence,
		browserLocalPersistence,
		browserSessionPersistence,
		type User
	} from 'firebase/auth';
	import { startIdTokenCookieSync, clearIdTokenCookie } from '$lib/auth/tokenCookie';

	let user: User | null = null;
	let statusText = 'Loading…';
	let resultText = '';

	function setStatus(text: string) {
		statusText = text;
	}

	function supportsStorage(api: Storage): boolean {
		try {
			const key = '__test__' + Math.random();
			api.setItem(key, '1');
			const ok = api.getItem(key) === '1';
			api.removeItem(key);
			return ok;
		} catch (e) {
			return false;
		}
	}

	function dumpEnv(prefix: string) {
		if (typeof window === 'undefined') {
			return;
		}
		const info = {
			prefix,
			location: window.location.href,
			appOptions: getApp().options,
			usingAuthDomain: (getApp().options as any).authDomain,
			hasLocalStorage: supportsStorage(window.localStorage),
			hasSessionStorage: supportsStorage(window.sessionStorage),
			localFirebaseKeys: Object.keys(window.localStorage || {}).filter((k) =>
				k.toLowerCase().includes('firebase')
			),
			sessionFirebaseKeys: Object.keys(window.sessionStorage || {}).filter((k) =>
				k.toLowerCase().includes('firebase')
			)
		};
		resultText = JSON.stringify(info, null, 2);
		console.log('[welcome]', info);
	}

	async function withPersistence(auth: ReturnType<typeof getAuth>) {
		try {
			await setPersistence(auth, browserLocalPersistence);
		} catch (e) {
			await setPersistence(auth, browserSessionPersistence);
		}
	}

	async function handleRedirect() {
		const auth = getAuth(getFirebaseApp());
		setStatus('Starting redirect…');
		await withPersistence(auth);
		const provider = new GoogleAuthProvider();
		provider.setCustomParameters({ prompt: 'select_account' });
		signInWithRedirect(auth, provider).catch((err: unknown) => {
			setStatus('Redirect error');
			dumpEnv('redirect-error');
			resultText += '\n' + (err instanceof Error ? err.message : String(err));
		});
	}

	async function handlePopup() {
		const auth = getAuth(getFirebaseApp());
		setStatus('Opening popup…');
		await withPersistence(auth);
		const provider = new GoogleAuthProvider();
		provider.setCustomParameters({ prompt: 'select_account' });
		try {
			const result = await signInWithPopup(auth, provider);
			dumpEnv('popup-success');
			resultText += '\n' + 'popup signed in';
			user = result.user;
			setStatus('Signed in');
		} catch (err) {
			dumpEnv('popup-error');
			resultText += '\n' + (err instanceof Error ? err.message : String(err));
			setStatus('Popup error');
		}
	}

	async function handleSignOut() {
		const auth = getAuth(getFirebaseApp());
		try {
			await auth.signOut();
		} catch (err) {
			console.error('Sign-out error:', err);
		}
	}

	onMount(() => {
		const auth = getAuth(getFirebaseApp());
		const stopCookieSync = startIdTokenCookieSync(auth);

		onAuthStateChanged(auth, (u) => {
			user = u;
			setStatus(u ? 'Signed in' : 'Not signed in');
		});

		(async () => {
			try {
				dumpEnv('page-load');
				await withPersistence(auth);
				const result = await getRedirectResult(auth);
				if (result && result.user) {
					dumpEnv('redirect-success');
					resultText += '\n' + 'redirect success';
					user = result.user;
					setStatus('Signed in');
				} else {
					resultText += '\n' + 'redirect no-result';
				}
			} catch (err) {
				dumpEnv('redirect-catch');
				resultText += '\n' + (err instanceof Error ? err.message : String(err));
				setStatus('Redirect error');
			}
		})();

		return () => {
			stopCookieSync();
			clearIdTokenCookie();
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
			<div style="margin-top: 0.75rem;" class="row">
				<button
					on:click={handleSignOut}
					style="padding: 0.5rem 0.9rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;"
					>Sign out</button
				>
			</div>
		</div>
	{:else}
		<p style="margin: 0.5rem 0 1rem 0;">Not signed in.</p>
		<div class="row">
			<button
				on:click={handleRedirect}
				style="padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;"
				>Sign in with Google (redirect)</button
			>
			<button
				on:click={handlePopup}
				style="padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;"
				>Try popup</button
			>
		</div>
	{/if}

	<div style="margin-top: 1rem;">
		<p style="margin: 0.25rem 0; color: #666; font-size: 0.9em;">Status: {statusText}</p>
		<pre
			style="white-space: pre-wrap; background: #f8f8f8; border: 1px solid #eee; padding: 0.75rem; border-radius: 6px;">{resultText}</pre>
	</div>
</main>
