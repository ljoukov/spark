<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		children,
		child,
		...restProps
	}: WithoutChildrenOrChild<PopoverPrimitive.TriggerProps> & {
		children?: Snippet;
		child?: PopoverPrimitive.TriggerProps['child'];
	} = $props();
</script>

<PopoverPrimitive.Trigger bind:ref {child} {...restProps}>
	{@render children?.()}
</PopoverPrimitive.Trigger>
