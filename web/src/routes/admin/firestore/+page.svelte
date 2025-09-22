<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	let { data }: { data: { ok: boolean; text: string } } = $props();
</script>

<div class="mx-auto w-full max-w-5xl">
	<Card.Root>
		<Card.Header>
			<Card.Title>Firestore Admin SDK</Card.Title>
			<Card.Description
				>Document diagnostics from spark/test-user/docs/adminSdkDiagnostics</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<div class="rounded-lg border bg-muted/40 p-3">
				<pre class="text-xs leading-relaxed break-words whitespace-pre-wrap">{data.text}</pre>
			</div>
			{#if !data.ok}
				<Separator class="my-4" />
				<p class="text-xs text-destructive">
					Request failed or returned an error. See payload above.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
