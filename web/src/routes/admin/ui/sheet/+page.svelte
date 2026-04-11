<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import SheetPreviewNav from './SheetPreviewNav.svelte';

	const sections = [
		{
			title: 'Catalog',
			description:
				'Canonical inventory of every supported sheet surface, with required inputs and live specimens.',
			href: '/admin/ui/sheet/catalog'
		},
		{
			title: 'Thumbnails',
			description:
				'Explorations for the /spark/sheets list card output: same shell, leaner content strategies.',
			href: '/admin/ui/sheet/thumbnails'
		},
		{
			title: 'Worksheet',
			description:
				'Full @ljoukov/sheet previews with seeded sample worksheets and tab switching between subjects.',
			href: '/admin/ui/sheet/worksheet'
		},
		{
			title: 'Feedback states',
			description:
				'Static gallery plus a progression simulator for question-level feedback runtime states.',
			href: '/admin/ui/sheet/feedback'
		},
		{
			title: 'Annotated text',
			description: 'Standalone annotated-text previews with light and dark theme toggles.',
			href: '/admin/ui/sheet/annotated-text'
		}
	] as const;
</script>

<svelte:head>
	<title>Sheet UI previews · Spark admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Sheet UI previews</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Entry point for the sheet preview surfaces. Use the catalog for the full support matrix,
				then open the focused preview that matches the surface you want to inspect.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
		</div>

		<SheetPreviewNav current="overview" />
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Preview sections</Card.Title>
			<Card.Description
				>Open the focused preview that matches the surface you want to inspect.</Card.Description
			>
		</Card.Header>
		<Card.Content class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			{#each sections as section}
				<div
					class="flex h-full flex-col justify-between gap-4 rounded-xl border border-border/70 p-4"
				>
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{section.title}</p>
						<p class="text-xs text-muted-foreground">{section.description}</p>
					</div>
					<a
						href={section.href}
						class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'self-start')}
					>
						Open
					</a>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
