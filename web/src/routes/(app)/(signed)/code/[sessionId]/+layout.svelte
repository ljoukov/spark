<script lang="ts">
	import { setContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { writable } from 'svelte/store';
	import { initializeUserStats } from '$lib/client/userStats';
	import type { LayoutData } from './$types';

	const CONTEXT_KEY = 'spark-code:session-data';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	initializeUserStats(data.stats ?? null);

	const contextStore = writable({
		session: data.session,
		stats: data.stats ?? null,
		userId: data.userId
	});

	setContext(CONTEXT_KEY, { subscribe: contextStore.subscribe });

	$effect(() => {
		contextStore.set({
			session: data.session,
			stats: data.stats ?? null,
			userId: data.userId
		});
	});
</script>

{@render children()}
