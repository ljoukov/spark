<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	const params = new URLSearchParams({ r: data.r });
	const loginUrl = `/auth/start?${params.toString()}`;
</script>

<div class="p-8">
	<div>You need to be logged in</div>
	<a href={loginUrl} class="text-blue-500 hover:underline">Login</a>
</div>
