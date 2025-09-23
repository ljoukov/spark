<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, ...restProps } = $props();
</script>

<div class="flex items-center gap-2 border-b px-3" data-slot="command-input-wrapper">
	<SearchIcon class="size-4 shrink-0 text-muted-foreground" />
	<CommandPrimitive.Input
		class={cn(
			'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
			className
		)}
		{...restProps}
	/>
</div>
