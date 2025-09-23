<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, ...restProps } = $props();
</script>

<CommandPrimitive.List
	class={cn(
		'overflow-y-auto overflow-x-hidden py-1',
		'max-h-[calc(100vh-12rem)]',
		className
	)}
	{...restProps}
/>
