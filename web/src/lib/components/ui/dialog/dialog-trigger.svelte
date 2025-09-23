<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		child,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.TriggerProps> & {
		children?: Snippet;
	} = $props();
</script>

<DialogPrimitive.Trigger
	bind:ref
	class={cn('inline-flex items-center justify-center gap-2', className)}
	data-slot="dialog-trigger"
	{child}
	{...restProps}
>
	{@render children?.()}
</DialogPrimitive.Trigger>
