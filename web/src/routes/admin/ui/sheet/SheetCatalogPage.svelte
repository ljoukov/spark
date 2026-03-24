<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import SheetCatalogPreview from './SheetCatalogPreview.svelte';
	import SheetPreviewNav from './SheetPreviewNav.svelte';
	import {
		sheetCatalogCategories,
		sheetCatalogItems,
		type SheetCatalogCategoryId
	} from './catalog-data';

	type CatalogFilter = 'all' | SheetCatalogCategoryId;

	let activeFilter = $state<CatalogFilter>('all');

	const visibleSections = $derived.by(() => {
		return sheetCatalogCategories.flatMap((category) => {
			const items = sheetCatalogItems.filter((item) => {
				return activeFilter === 'all' || item.categoryId === activeFilter
					? item.categoryId === category.id
					: false;
			});
			if (items.length === 0) {
				return [];
			}
			return [
				{
					...category,
					items
				}
			];
		});
	});

	const categoryCounts = Object.fromEntries(
		sheetCatalogCategories.map((category) => [
			category.id,
			sheetCatalogItems.filter((item) => item.categoryId === category.id).length
		])
	) as Record<SheetCatalogCategoryId, number>;

	const supportMetrics = [
		{
			value: sheetCatalogItems.length.toString(),
			label: 'Catalogued surfaces'
		},
		{
			value: categoryCounts.inputs.toString(),
			label: 'Problem input types'
		},
		{
			value: `${categoryCounts.outputs + categoryCounts.runtime}`,
			label: 'Review and runtime states'
		},
		{
			value: categoryCounts.adjacent.toString(),
			label: 'Adjacent surfaces'
		}
	] as const;

	const sourceFiles = [
		'packages/schemas/src/paperSheet.ts',
		'web/src/lib/components/paper-sheet/paper-sheet.svelte',
		'web/src/lib/components/paper-sheet/paper-sheet-question-feedback.svelte',
		'web/src/lib/components/annotated-text/annotated-text-panel.svelte'
	] as const;
</script>

<svelte:head>
	<title>Sheet UI catalog · Spark admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Sheet UI catalog</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Canonical inventory of what the current sheet UI supports. The surrounding page follows the
				standard admin layout; the preview panes render the actual sheet components.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
			<a href="/admin/ui/sheet" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Overview
			</a>
			<a
				href="/admin/ui/sheet/worksheet"
				class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
			>
				Worksheet preview
			</a>
		</div>

		<SheetPreviewNav current="catalog" />
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Coverage</Card.Title>
			<Card.Description>
				Use this route to check what sheet surfaces already exist before adding exam-specific
				variants.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-6">
			<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				{#each supportMetrics as metric}
					<div class="rounded-xl border border-border/70 p-4">
						<p class="text-2xl font-semibold tracking-tight text-foreground">{metric.value}</p>
						<p class="text-xs text-muted-foreground">{metric.label}</p>
					</div>
				{/each}
			</div>

			<div class="space-y-2">
				<p class="text-sm font-medium text-foreground">Source files</p>
				<div class="flex flex-wrap gap-2">
					{#each sourceFiles as source}
						<span
							class="rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground"
						>
							{source}
						</span>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<p class="text-sm font-medium text-foreground">Filter by surface family</p>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class={cn(
							buttonVariants({
								variant: activeFilter === 'all' ? 'default' : 'secondary',
								size: 'sm'
							})
						)}
						aria-pressed={activeFilter === 'all'}
						onclick={() => {
							activeFilter = 'all';
						}}
					>
						All surfaces
					</button>
					{#each sheetCatalogCategories as category}
						<button
							type="button"
							class={cn(
								buttonVariants({
									variant: activeFilter === category.id ? 'default' : 'secondary',
									size: 'sm'
								})
							)}
							aria-pressed={activeFilter === category.id}
							onclick={() => {
								activeFilter = category.id;
							}}
						>
							{category.label} · {categoryCounts[category.id]}
						</button>
					{/each}
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	{#each visibleSections as section}
		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header>
				<Card.Title>{section.title}</Card.Title>
				<Card.Description>{section.description}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#each section.items as item (item.id)}
					<div
						class="grid gap-4 rounded-xl border border-border/70 p-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]"
					>
						<div class="space-y-4">
							<div class="space-y-2">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
										{item.kindLabel}
									</span>
									<code
										class="rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
									>
										{item.component}
									</code>
								</div>
								<div class="space-y-1">
									<h3 class="text-base font-semibold text-foreground">{item.title}</h3>
									<p class="text-sm text-muted-foreground">{item.description}</p>
								</div>
							</div>

							<div class="space-y-2">
								<p class="text-sm font-medium text-foreground">Required inputs</p>
								<div class="flex flex-wrap gap-2">
									{#each item.requiredInputs as input}
										<span
											class="rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground"
										>
											{input}
										</span>
									{/each}
								</div>
							</div>

							{#if item.optionalInputs}
								<div class="space-y-2">
									<p class="text-sm font-medium text-foreground">Optional inputs</p>
									<div class="flex flex-wrap gap-2">
										{#each item.optionalInputs as input}
											<span
												class="rounded-md border border-border/70 bg-muted/20 px-2 py-1 font-mono text-xs text-muted-foreground"
											>
												{input}
											</span>
										{/each}
									</div>
								</div>
							{/if}

							{#if item.answerShape}
								<div class="space-y-2">
									<p class="text-sm font-medium text-foreground">Answer payload</p>
									<code
										class="block rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
									>
										{item.answerShape}
									</code>
								</div>
							{/if}

							{#if item.note}
								<p
									class="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
								>
									{item.note}
								</p>
							{/if}
						</div>

						<div class="min-w-0">
							<SheetCatalogPreview {item} />
						</div>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/each}
</div>
