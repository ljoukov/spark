<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData | null } = $props();

	const successMessage = $derived(form?.success?.message ?? '');
	const hasSuccess = $derived(Boolean(successMessage));
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
					{successMessage}
				</p>
			{:else if errorMessage}
				<p
					class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{errorMessage}
				</p>
			{/if}

			<div class="rounded-lg border bg-muted/30 p-4">
				<form
					method="POST"
					action="?/startHelloWorld"
					class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
				>
					<div class="space-y-1">
						<p class="text-sm font-medium text-muted-foreground">Hello World</p>
						<p class="text-xs text-muted-foreground/80">
							Queues a helloWorld task that logs "Hello World" on the server.
						</p>
					</div>
					<Button type="submit" class="md:w-auto">Run task</Button>
				</form>
			</div>

			<div class="rounded-lg border bg-muted/30 p-4">
				<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div class="space-y-1">
						<p class="text-sm font-medium text-muted-foreground">Generate welcome session</p>
						<p class="text-xs text-muted-foreground/80">
							Creates a new welcome template for learners from a topic. The task generates plan,
							quizzes, coding problems, and story media in the background.
						</p>
					</div>
					<form
						method="POST"
						action="?/startWelcomeSession"
						class="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center"
					>
						<label class="sr-only" for="welcome-topic">Topic</label>
						<Input
							id="welcome-topic"
							name="topic"
							placeholder="e.g. Dynamic programming basics"
							required
							class="md:w-72"
						/>
						<Button type="submit" class="md:w-auto">Run task</Button>
					</form>
				</div>
			</div>
		</Card.Content>
	</Card.Root>
</div>
