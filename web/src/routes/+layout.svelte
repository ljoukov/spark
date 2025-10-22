<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applyDocumentTheme, startAutomaticThemeSync } from '$lib/utils/theme';
	import { themePreference, type ThemePreference } from '$lib/stores/themePreference';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { startIdTokenCookieSync } from '$lib/auth/tokenCookie';
	import { getAuth } from 'firebase/auth';
	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';

	injectAnalytics({ mode: dev ? 'development' : 'production' });

	let { children } = $props();

	onMount(() => {
		let stopAutoSync: (() => void) | null = null;
		let stopTokenSync: (() => void) | null = null;
		const unsubscribe = themePreference.subscribe((preference: ThemePreference) => {
			if (stopAutoSync) {
				stopAutoSync();
				stopAutoSync = null;
			}
			if (preference === 'auto') {
				stopAutoSync = startAutomaticThemeSync();
				return;
			}
			applyDocumentTheme(preference);
		});

		try {
			const app = getFirebaseApp();
			const auth = getAuth(app);
			stopTokenSync = startIdTokenCookieSync(auth);
		} catch (error) {
			console.warn('Failed to start Firebase ID token cookie sync', error);
		}

		return () => {
			unsubscribe();
			stopAutoSync?.();
			stopTokenSync?.();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.png" />
	<meta name="theme-color" content="#070a1a" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#020617" media="(prefers-color-scheme: dark)" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{@render children?.()}
