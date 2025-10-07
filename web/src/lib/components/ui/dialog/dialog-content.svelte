<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

    let {
        ref = $bindable(null),
        class: className,
        children,
        portalProps,
        hideClose = false,
        ...restProps
    }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
        children?: Snippet;
        portalProps?: DialogPrimitive.PortalProps;
        hideClose?: boolean;
    } = $props();
</script>

<DialogPrimitive.Portal {...portalProps}>
	<DialogPrimitive.Overlay
		data-slot="dialog-overlay"
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
	/>
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			'fixed top-[50%] left-[50%] z-50 grid w-full max-w-3xl translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:rounded-lg',
			className
		)}
		{...restProps}
	>
        {@render children?.()}
        {#if !hideClose}
            <DialogPrimitive.Close
                class="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none"
            >
                <XIcon class="size-4" />
                <span class="sr-only">Close</span>
            </DialogPrimitive.Close>
        {/if}
	</DialogPrimitive.Content>
</DialogPrimitive.Portal>
