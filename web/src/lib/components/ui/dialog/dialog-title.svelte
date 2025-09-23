<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.TitleProps> & {
		children?: Snippet;
	} = $props();
</script>

<DialogPrimitive.Title
	data-slot="dialog-title"
	class={cn('text-lg leading-none font-semibold tracking-tight', className)}
	{...restProps}
>
	{@render children?.()}
</DialogPrimitive.Title>
