<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applyDocumentTheme, startAutomaticThemeSync } from '$lib/utils/theme';
	import { themePreference, type ThemePreference } from '$lib/stores/themePreference';

	let { children } = $props();

	onMount(() => {
		let stopAutoSync: (() => void) | null = null;
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

		return () => {
			unsubscribe();
			stopAutoSync?.();
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
