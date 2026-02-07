<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	const widgets = [
		{
			title: 'Quiz UI',
			description: 'Full-screen quiz previews and grading layouts.',
			href: '/admin/ui/quiz',
			cta: 'Open'
		},
		{
			title: 'Spark chat stream',
			description: 'Preview the /spark chat loading + thinking states.',
			href: '/admin/ui/spark-stream',
			cta: 'Open'
		},
		{
			title: 'Dialogs',
			description: 'Confirmation, error, and progress dialog states.',
			href: null,
			cta: 'Soon'
		},
		{
			title: 'Cards & banners',
			description: 'Content cards, alerts, and inline status banners.',
			href: null,
			cta: 'Soon'
		}
	] as const;
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">UI previews</h1>
		<p class="text-sm text-muted-foreground">
			Launcher for visual checks across the Spark admin UI widgets.
		</p>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Available widgets</Card.Title>
			<Card.Description>Each widget opens a preview page.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 md:grid-cols-2">
			{#each widgets as widget}
				<div
					class="flex h-full flex-col justify-between gap-4 rounded-xl border border-border/70 p-4"
				>
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{widget.title}</p>
						<p class="text-xs text-muted-foreground">{widget.description}</p>
					</div>
					{#if widget.href}
						<a
							href={widget.href}
							class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'self-start')}
						>
							{widget.cta}
						</a>
					{:else}
						<span
							class={cn(
								buttonVariants({ variant: 'secondary', size: 'sm' }),
								'pointer-events-none self-start opacity-60'
							)}
						>
							{widget.cta}
						</span>
					{/if}
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
