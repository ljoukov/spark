<script lang="ts">
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Minimize2 from '@lucide/svelte/icons/minimize-2';

	type PaneSide = 'left' | 'right';

	const DEFAULT_LAYOUT = [50, 50] as const;
	const LEFT_MAX_LAYOUT = [100, 0] as const;
	const RIGHT_MAX_LAYOUT = [0, 100] as const;

	const iconButtonClasses = cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'rounded-md');

	let leftText = '';
	let rightText = '';
	let maximizedPane: PaneSide | null = null;
	let paneGroup: { setLayout: (layout: number[]) => void; getLayout: () => number[] } | null = null;

	function applyLayout(layout: readonly number[]) {
		paneGroup?.setLayout([...layout]);
	}

	function toggleMaximize(side: PaneSide) {
		if (side === maximizedPane) {
			maximizedPane = null;
			applyLayout(DEFAULT_LAYOUT);
			return;
		}

		applyLayout(side === 'left' ? LEFT_MAX_LAYOUT : RIGHT_MAX_LAYOUT);
		maximizedPane = side;
	}

	function handleLayoutChange(layout: number[]) {
		const [left, right] = layout;
		const almostEqual = (a: number, b: number, epsilon = 0.5) => Math.abs(a - b) <= epsilon;

		if (almostEqual(left, 100) && almostEqual(right, 0)) {
			maximizedPane = 'left';
		} else if (almostEqual(left, 0) && almostEqual(right, 100)) {
			maximizedPane = 'right';
		} else {
			maximizedPane = null;
		}
	}
</script>

<section class="flex min-h-screen flex-col gap-4 bg-background p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Split Text Workspace</h1>
		<p class="text-sm text-muted-foreground">
			Compare or edit text side by side with a draggable divider.
		</p>
	</header>

	<Resizable.PaneGroup
		direction="horizontal"
		class="flex h-[60vh] w-full overflow-hidden rounded-lg border bg-card shadow"
		bind:this={paneGroup}
		onLayoutChange={handleLayoutChange}
	>
		<Resizable.Pane defaultSize={DEFAULT_LAYOUT[0]} minSize={0}>
			<div class="flex h-full w-full flex-1 flex-col gap-2 p-4">
				<div class="flex items-center justify-between gap-2">
					<label class="text-sm font-medium text-muted-foreground" for="left-text">Left Text</label>
					<button
						type="button"
						class={iconButtonClasses}
						on:click={() => toggleMaximize('left')}
						aria-label={maximizedPane === 'left' ? 'Return left pane to normal size' : 'Maximize left pane'}
					>
						{#if maximizedPane === 'left'}
							<Minimize2 class="size-4" />
						{:else}
							<Maximize2 class="size-4" />
						{/if}
					</button>
				</div>
				<textarea
					id="left-text"
					bind:value={leftText}
					placeholder="Start typing..."
					class="flex-1 resize-none rounded-md border border-input bg-background p-3 text-sm shadow-sm outline-none ring-offset-background focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
				></textarea>
			</div>
		</Resizable.Pane>
		<Resizable.Handle withHandle class="bg-border" />
		<Resizable.Pane defaultSize={DEFAULT_LAYOUT[1]} minSize={0}>
			<div class="flex h-full w-full flex-1 flex-col gap-2 p-4">
				<div class="flex items-center justify-between gap-2">
					<label class="text-sm font-medium text-muted-foreground" for="right-text">Right Text</label>
					<button
						type="button"
						class={iconButtonClasses}
						on:click={() => toggleMaximize('right')}
						aria-label={maximizedPane === 'right' ? 'Return right pane to normal size' : 'Maximize right pane'}
					>
						{#if maximizedPane === 'right'}
							<Minimize2 class="size-4" />
						{:else}
							<Maximize2 class="size-4" />
						{/if}
					</button>
				</div>
				<textarea
					id="right-text"
					bind:value={rightText}
					placeholder="Start typing..."
					class="flex-1 resize-none rounded-md border border-input bg-background p-3 text-sm shadow-sm outline-none ring-offset-background focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
				></textarea>
			</div>
		</Resizable.Pane>
	</Resizable.PaneGroup>
</section>
