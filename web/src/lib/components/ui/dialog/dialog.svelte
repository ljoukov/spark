<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		children,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.RootProps> & {
		children?: Snippet;
	} = $props();
</script>

<DialogPrimitive.Root data-slot="dialog-root" {...restProps}>
	{@render children?.()}
</DialogPrimitive.Root>
