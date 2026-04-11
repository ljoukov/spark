<script lang="ts">
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type SheetPreviewTabId =
		| 'overview'
		| 'catalog'
		| 'thumbnails'
		| 'worksheet'
		| 'feedback'
		| 'annotated-text';

	const tabs: Array<{ id: SheetPreviewTabId; href: string; label: string }> = [
		{ id: 'overview', href: '/admin/ui/sheet', label: 'Overview' },
		{ id: 'catalog', href: '/admin/ui/sheet/catalog', label: 'Catalog' },
		{ id: 'thumbnails', href: '/admin/ui/sheet/thumbnails', label: 'Thumbnails' },
		{ id: 'worksheet', href: '/admin/ui/sheet/worksheet', label: 'Worksheet' },
		{ id: 'feedback', href: '/admin/ui/sheet/feedback', label: 'Feedback states' },
		{
			id: 'annotated-text',
			href: '/admin/ui/sheet/annotated-text',
			label: 'Annotated text'
		}
	];

	let { current }: { current: SheetPreviewTabId } = $props();
</script>

<div class="flex flex-wrap gap-2">
	{#each tabs as tab (tab.id)}
		<a
			href={tab.href}
			aria-current={current === tab.id ? 'page' : undefined}
			class={cn(
				buttonVariants({ variant: current === tab.id ? 'default' : 'secondary', size: 'sm' })
			)}
		>
			{tab.label}
		</a>
	{/each}
</div>
