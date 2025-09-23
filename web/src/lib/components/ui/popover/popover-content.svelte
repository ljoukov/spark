<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		align = 'center',
		sideOffset = 4,
		collisionPadding = 8,
		...restProps
	}: {
		class?: string;
		align?: 'start' | 'center' | 'end';
		sideOffset?: number;
		collisionPadding?: number | { top?: number; bottom?: number; left?: number; right?: number };
	} & Record<string, unknown> = $props();
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		class={cn(
			'z-50 min-w-[var(--radix-popover-trigger-width)] max-w-[min(24rem,calc(100vw-2rem))] rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
			className
		)}
		{align}
		{sideOffset}
		{collisionPadding}
		{...restProps}
	/>
</PopoverPrimitive.Portal>
