<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className, ...restProps } = $props();
</script>

<CommandPrimitive.GroupHeading
	data-slot="command-group-heading"
	class={cn('px-2 pb-1.5 pt-2 text-xs font-medium text-muted-foreground', className)}
	{...restProps}
/>
