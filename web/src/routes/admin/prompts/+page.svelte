<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const copyState = $state({
		activeId: null as string | null,
		status: 'idle' as 'idle' | 'copied' | 'error',
		message: ''
	});

	function getCopyLabel(targetId: string): string {
		if (copyState.activeId !== targetId) {
			return 'Copy prompt';
		}
		if (copyState.status === 'copied') {
			return 'Copied!';
		}
		if (copyState.status === 'error') {
			return 'Copy failed';
		}
		return 'Copy prompt';
	}

	async function copyPrompt(targetId: string, text: string): Promise<void> {
		copyState.activeId = targetId;
		copyState.status = 'idle';
		copyState.message = '';

		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			copyState.status = 'error';
			copyState.message = 'Clipboard is not available in this environment.';
			return;
		}

		try {
			await navigator.clipboard.writeText(text);
			copyState.status = 'copied';
			copyState.message = 'Copied to clipboard.';
			setTimeout(() => {
				if (copyState.activeId === targetId && copyState.status === 'copied') {
					copyState.activeId = null;
					copyState.status = 'idle';
					copyState.message = '';
				}
			}, 2000);
		} catch (error) {
			copyState.status = 'error';
			copyState.message = error instanceof Error ? error.message : 'Unable to copy this prompt.';
		}
	}
</script>

<div class="mx-auto w-full max-w-5xl space-y-6">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold tracking-tight">Prompt catalogue</h1>
		<p class="text-sm text-muted-foreground">
			Review the exact instructions we send to Gemini for quiz generation, judging, and audits.
		</p>
	</header>

	<div class="grid gap-6">
		{#each data.prompts as prompt (prompt.id)}
			<Card.Root>
				<Card.Header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div class="space-y-1">
						<Card.Title>{prompt.title}</Card.Title>
						<Card.Description>{prompt.description}</Card.Description>
					</div>
					<button
						type="button"
						class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'whitespace-nowrap')}
						onclick={() => copyPrompt(prompt.id, prompt.example)}
					>
						{getCopyLabel(prompt.id)}
					</button>
				</Card.Header>
				{#if copyState.activeId === prompt.id && copyState.status === 'error'}
					<div class="px-6 text-xs font-medium text-destructive">
						{copyState.message}
					</div>
				{/if}
				<Card.Content class="space-y-4">
					<div class="grid gap-1 text-sm text-muted-foreground">
						<div class="flex flex-wrap items-baseline gap-2">
							<span class="font-medium text-foreground">Model(s):</span>
							<span>{prompt.models.join(', ')}</span>
						</div>
						<div class="flex flex-wrap items-baseline gap-2">
							<span class="font-medium text-foreground">Used by:</span>
							<span>{prompt.usedBy}</span>
						</div>
					</div>
					<div>
						<p class="text-sm font-medium text-foreground">Prompt preview</p>
						<div
							class="mt-2 rounded-md border bg-muted/50 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap"
						>
							{prompt.example}
						</div>
					</div>
					{#if prompt.variables.length}
						<div>
							<p class="text-sm font-medium text-foreground">Dynamic inputs</p>
							<ul class="mt-2 space-y-2 text-sm text-muted-foreground">
								{#each prompt.variables as variable (variable.name)}
									<li>
										<span class="font-semibold text-foreground">
											{variable.name}:
										</span>
										<span class="ml-1">{variable.description}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if prompt.notes.length}
						<div>
							<p class="text-sm font-medium text-foreground">Notes</p>
							<ul class="mt-2 space-y-2 text-sm text-muted-foreground">
								{#each prompt.notes as note, index (index)}
									<li>{note}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>
