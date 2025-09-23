<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className, ...restProps } = $props();
</script>

<CommandPrimitive.Loading
	class={cn('py-6 text-center text-sm text-muted-foreground', className)}
	{...restProps}
/>
