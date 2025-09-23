<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.DescriptionProps> & {
		children?: Snippet;
	} = $props();
</script>

<DialogPrimitive.Description
	data-slot="dialog-description"
	class={cn('text-sm text-muted-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</DialogPrimitive.Description>
