<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type Events = {
		keep: void;
		quit: void;
	};

	const dispatch = createEventDispatcher<Events>();

	export let heading = 'Take a break?';
	export let description: string;
	export let keepLabel = 'Keep practicing';
	export let quitLabel = 'Quit now';
	export let quitDisabled = false;
	export let quitBusy = false;

	function handleKeep() {
		dispatch('keep');
	}

	function handleQuit() {
		if (quitDisabled) {
			return;
		}
		dispatch('quit');
	}
</script>

<div
	class="finish-header space-y-3 border-b border-border/60 bg-gradient-to-br from-primary/15 via-background to-background px-6 py-6 text-center dark:from-primary/12"
>
	<h2 class="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{heading}</h2>
	<p class="text-sm leading-relaxed text-muted-foreground">{description}</p>
</div>
<div
	class="finish-footer flex flex-col items-center gap-3 border-t border-border/60 bg-background px-6 py-6 sm:flex-row sm:items-center sm:justify-center"
>
	<Button class="finish-cancel w-full sm:w-auto sm:min-w-[9rem]" onclick={handleKeep}>
		{keepLabel}
	</Button>
	<Button
		class="finish-continue w-full sm:w-auto sm:min-w-[9rem]"
		disabled={quitDisabled}
		aria-busy={quitBusy ? 'true' : undefined}
		onclick={handleQuit}
	>
		{#if quitBusy}
			<span class="finish-spinner-inline" aria-hidden="true"></span>
		{/if}
		<span>{quitLabel}</span>
	</Button>
</div>

<style>
	:global(.finish-dialog) {
		--finish-border: rgba(15, 23, 42, 0.18);
		border-radius: 1.5rem;
		background: color-mix(in srgb, hsl(var(--background)) 98%, transparent 2%);
		box-shadow:
			0 0 0 1px var(--finish-border),
			0 35px 90px -40px rgba(15, 23, 42, 0.45);
	}

	:global([data-theme='dark'] .finish-dialog) {
		--finish-border: rgba(148, 163, 184, 0.38);
		box-shadow:
			0 0 0 1px var(--finish-border),
			0 35px 90px -40px rgba(2, 6, 23, 0.75);
	}

	/* .finish-footer {
		background: color-mix(in srgb, hsl(var(--background)) 96%, transparent 4%);
	}

	:global([data-theme='dark'] .finish-footer),
	:global(:root:not([data-theme='light']) .finish-footer) {
		background: color-mix(in srgb, rgba(15, 23, 42, 0.96) 90%, rgba(30, 41, 59, 0.96) 10%);
	} */

	:global(.finish-cancel) {
		background: #0284c7 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(14, 165, 233, 0.35);
	}

	:global(.finish-cancel:hover) {
		background: #0ea5e9 !important;
	}

	:global(.finish-continue) {
		background: #f97316 !important;
		color: #ffffff !important;
		justify-content: center;
		gap: 0.45rem;
		box-shadow: 0 18px 40px rgba(251, 146, 60, 0.35);
	}

	:global(.finish-continue:hover) {
		background: #fb923c !important;
	}

	:global(.finish-continue:disabled),
	:global(.finish-continue[disabled]) {
		background: #f97316 !important;
	}

	.finish-spinner-inline {
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 9999px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: rgba(255, 255, 255, 0.95);
		animation: finish-inline-spin 0.75s linear infinite;
	}

	@keyframes finish-inline-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@media (min-width: 40rem) {
		.finish-footer {
			flex-direction: row;
			align-items: center;
		}
	}
</style>
