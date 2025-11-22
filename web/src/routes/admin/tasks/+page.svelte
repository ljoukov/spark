<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData | null } = $props();

	const hasSuccess = $derived(Boolean(form?.success));
	const errorMessage = $derived(form?.error ?? '');
</script>

<div class="mx-auto w-full max-w-4xl">
	<Card.Root>
		<Card.Header>
			<Card.Title>Tasks</Card.Title>
			<Card.Description>Fire background jobs in the Spark task queue.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if hasSuccess}
				<p
					class="rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
				>
					Started Hello World task.
				</p>
			{:else if errorMessage}
				<p
					class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{errorMessage}
				</p>
			{/if}

			<form
				method="POST"
				action="?/startHelloWorld"
				class="flex items-center justify-between gap-4"
			>
				<div>
					<p class="text-sm font-medium text-muted-foreground">Hello World</p>
					<p class="text-xs text-muted-foreground/80">
						Queues a helloWorld task that logs "Hello World" on the server.
					</p>
				</div>
				<Button type="submit">Run task</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
