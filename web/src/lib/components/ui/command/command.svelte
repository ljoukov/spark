<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, ...restProps } = $props();
</script>

<CommandPrimitive.Root
	class={cn(
		'flex h-full w-full flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
		className
	)}
	{...restProps}
/>
