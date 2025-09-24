<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, ...restProps } = $props();
</script>

<CommandPrimitive.List
	class={cn('overflow-x-hidden overflow-y-auto py-1', 'max-h-[calc(100vh-12rem)]', className)}
	{...restProps}
/>
