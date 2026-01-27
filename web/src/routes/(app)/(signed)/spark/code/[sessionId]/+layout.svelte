<script lang="ts">
	import { setContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { initializeUserStats } from '$lib/client/userStats';
	import type { LayoutData } from './$types';

	const CONTEXT_KEY = 'spark-code:session-data';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const getSessionContext = () => ({
		session: data.session,
		stats: data.stats ?? null,
		userId: data.userId
	});

	setContext(CONTEXT_KEY, getSessionContext);

	$effect(() => {
		initializeUserStats(data.stats ?? null);
	});
</script>

{@render children()}
