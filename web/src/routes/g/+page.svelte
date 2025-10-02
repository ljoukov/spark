<script lang="ts">
	import * as Resizable from '$lib/components/ui/resizable/index.js';

	let leftText = '';
	let rightText = '';
</script>

<section class="bg-background flex min-h-screen flex-col gap-4 p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Split Text Workspace</h1>
		<p class="text-muted-foreground text-sm">
			Compare or edit text side by side with a draggable divider.
		</p>
	</header>

	<Resizable.PaneGroup
		direction="horizontal"
		class="bg-card flex h-[60vh] w-full overflow-hidden rounded-lg border shadow"
	>
		<Resizable.Pane defaultSize={50} minSize={25}>
			<div class="flex h-full w-full flex-1 flex-col gap-2 p-4">
				<label class="text-muted-foreground text-sm font-medium" for="left-text">Left Text</label>
				<textarea
					id="left-text"
					bind:value={leftText}
					placeholder="Start typing..."
					class="border-input bg-background ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 flex-1 resize-none rounded-md border p-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				></textarea>
			</div>
		</Resizable.Pane>
		<Resizable.Handle withHandle class="bg-border" />
		<Resizable.Pane defaultSize={50} minSize={25}>
			<div class="flex h-full w-full flex-1 flex-col gap-2 p-4">
				<label class="text-muted-foreground text-sm font-medium" for="right-text">Right Text</label>
				<textarea
					id="right-text"
					bind:value={rightText}
					placeholder="Start typing..."
					class="border-input bg-background ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 flex-1 resize-none rounded-md border p-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				></textarea>
			</div>
		</Resizable.Pane>
	</Resizable.PaneGroup>
</section>
