import type { ComponentProps } from 'svelte';

import Root from './button.svelte';
import { buttonVariants, type ButtonSize, type ButtonVariant } from './variants.js';

type ButtonProps = ComponentProps<typeof Root>;

export {
	Root,
	type ButtonProps as Props,
	//
	Root as Button,
	buttonVariants,
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant
};
