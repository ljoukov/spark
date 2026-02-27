<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import {
		buttonVariants,
		type ButtonSize,
		type ButtonVariant
	} from './variants.js';
	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href: hrefProp = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();

	// Ensure in-app links are base-path aware and satisfy lint rule
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
</script>

{#if hrefProp}
	{@const href =
		typeof hrefProp === 'string' && hrefProp.startsWith('/')
			? (resolve as (route: string) => ResolvedPathname)(hrefProp)
			: hrefProp}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		onclick={(e) => {
			if (disabled) {
				e.preventDefault();
			}
		}}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
