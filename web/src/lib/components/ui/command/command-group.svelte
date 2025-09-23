<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className, ...restProps } = $props();
</script>

<CommandPrimitive.Group
	class={cn('overflow-hidden p-1 text-foreground', className)}
	{...restProps}
/>
