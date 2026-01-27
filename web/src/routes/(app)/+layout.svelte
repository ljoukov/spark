<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { applyDocumentTheme, startAutomaticThemeSync } from '$lib/utils/theme';
	import { themePreference, type ThemePreference } from '$lib/stores/themePreference';
	import { startIdTokenCookieSync } from '$lib/auth/tokenCookie';

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
			stopTokenSync = startIdTokenCookieSync();
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

{@render children?.()}
