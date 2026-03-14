<script lang="ts">
	import { PaperSheet, samplePaperSheets } from '$lib/components/paper-sheet/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let activeSheetId = $state(samplePaperSheets[0]?.id ?? '');

	const activeSheet = $derived.by(() => {
		for (const sheet of samplePaperSheets) {
			if (sheet.id === activeSheetId) {
				return sheet;
			}
		}
		return samplePaperSheets[0] ?? null;
	});
</script>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Sheet UI preview</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Showcase for the paper-style worksheet component ported to Svelte and stored in
				<code>$lib/components/paper-sheet</code>.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
		</div>
	</div>

	<div class="sheet-preview-stage">
		<div class="sheet-preview-tabs">
			{#each samplePaperSheets as sample (sample.id)}
				<button
					type="button"
					class={`sheet-preview-tab ${activeSheetId === sample.id ? 'is-active' : ''}`}
					style={`--sample-color:${sample.color};`}
					aria-pressed={activeSheetId === sample.id}
					onclick={() => {
						activeSheetId = sample.id;
					}}
				>
					{sample.subject}: {sample.title}
				</button>
			{/each}
		</div>

		{#if activeSheet}
			<div class="sheet-preview-canvas">
				<div class="sheet-preview-paper">
					{#key activeSheet.id}
						<PaperSheet sheet={activeSheet} />
					{/key}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.sheet-preview-stage {
		border-radius: 28px;
		background:
			radial-gradient(circle at top left, rgba(255, 255, 255, 0.5), transparent 36%),
			linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%);
		padding: 24px 16px 32px;
	}

	.sheet-preview-tabs {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-bottom: 20px;
	}

	.sheet-preview-tab {
		border: 2px solid #cccccc;
		border-radius: 999px;
		background: #ffffff;
		padding: 8px 18px;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 12.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #555555;
		cursor: pointer;
		transition:
			background-color 0.2s ease,
			border-color 0.2s ease,
			color 0.2s ease,
			transform 0.2s ease;
	}

	.sheet-preview-tab:hover {
		transform: translateY(-1px);
	}

	.sheet-preview-tab.is-active {
		border-color: var(--sample-color);
		background: var(--sample-color);
		color: #ffffff;
	}

	.sheet-preview-canvas {
		display: flex;
		justify-content: center;
	}

	.sheet-preview-paper {
		width: 100%;
		max-width: 750px;
	}

	@media (max-width: 640px) {
		.sheet-preview-stage {
			padding-right: 10px;
			padding-left: 10px;
		}
	}
</style>
