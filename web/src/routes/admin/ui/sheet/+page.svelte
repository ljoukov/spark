<script lang="ts">
	import {
		AnnotatedTextPanel,
		sampleAnnotatedTextDocument,
		type AnnotatedTextTheme
	} from '$lib/components/annotated-text/index.js';
	import { PaperSheet, samplePaperSheets } from '$lib/components/paper-sheet/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let activeSheetId = $state(samplePaperSheets[0]?.id ?? '');
	let annotatedTextTheme = $state<AnnotatedTextTheme>('light');

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
				Showcase for the paper-style worksheet and annotated-text components ported to Svelte and
				stored in <code>$lib/components</code>. Use the mock review inside each worksheet to preview
				the per-question tutor note and reply interaction.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
		</div>
	</div>

	<div class="sheet-preview-stage">
		<div class="sheet-preview-section-copy">
			<h2 class="sheet-preview-section-title">Worksheet</h2>
			<p class="sheet-preview-section-description">
				Reusable paper-sheet component from <code>$lib/components/paper-sheet</code>, now with
				question-level tutor feedback cards and mock reply interactions.
			</p>
		</div>

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
						<PaperSheet sheet={activeSheet} reviewMode="mock" />
					{/key}
				</div>
			</div>
		{/if}
	</div>

	<div
		class={`sheet-preview-stage annotated-stage ${annotatedTextTheme === 'dark' ? 'is-dark' : 'is-light'}`}
	>
		<div class="sheet-preview-section-copy">
			<h2 class="sheet-preview-section-title">Annotated Text</h2>
			<p class="sheet-preview-section-description">
				Reusable inline-annotation component from <code>$lib/components/annotated-text</code>.
			</p>
		</div>

		<div class="sheet-preview-tabs">
			<button
				type="button"
				class={`sheet-preview-tab ${annotatedTextTheme === 'light' ? 'is-active' : ''}`}
				style={`--sample-color:${annotatedTextTheme === 'light' ? '#7c3aed' : '#8b5cf6'};`}
				aria-pressed={annotatedTextTheme === 'light'}
				onclick={() => {
					annotatedTextTheme = 'light';
				}}
			>
				Light theme
			</button>
			<button
				type="button"
				class={`sheet-preview-tab ${annotatedTextTheme === 'dark' ? 'is-active' : ''}`}
				style={`--sample-color:${annotatedTextTheme === 'dark' ? '#fbbf24' : '#8b5cf6'};`}
				aria-pressed={annotatedTextTheme === 'dark'}
				onclick={() => {
					annotatedTextTheme = 'dark';
				}}
			>
				Dark theme
			</button>
		</div>

		<div class="sheet-preview-canvas">
			<div class="annotated-preview-paper">
				<AnnotatedTextPanel document={sampleAnnotatedTextDocument} theme={annotatedTextTheme} />
			</div>
		</div>
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

	.sheet-preview-section-copy {
		margin-bottom: 18px;
	}

	.sheet-preview-section-title {
		margin: 0 0 6px;
		font-size: 18px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: #1f1f1f;
	}

	.sheet-preview-section-description {
		margin: 0;
		font-size: 13px;
		line-height: 1.7;
		color: #555;
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
		max-width: 1024px;
	}

	.annotated-stage.is-dark {
		background:
			radial-gradient(circle at top left, rgba(196, 189, 224, 0.16), transparent 34%),
			linear-gradient(180deg, #221c3d 0%, #16122a 100%);
	}

	.annotated-stage.is-dark .sheet-preview-tab {
		border-color: #302850;
		background: #1f1b35;
		color: #a89ec4;
	}

	.annotated-stage.is-dark .sheet-preview-tab.is-active {
		color: #ffffff;
	}

	.annotated-stage.is-dark .sheet-preview-section-title {
		color: #e4dff5;
	}

	.annotated-stage.is-dark .sheet-preview-section-description {
		color: #a89ec4;
	}

	.annotated-preview-paper {
		width: 100%;
		max-width: 1024px;
		border-radius: 12px;
		padding: 24px;
		box-shadow:
			0 4px 30px rgba(0, 0, 0, 0.18),
			0 1px 4px rgba(0, 0, 0, 0.1);
		background: #ffffff;
	}

	.annotated-stage.is-dark .annotated-preview-paper {
		background: #1f1b35;
		box-shadow:
			0 4px 40px rgba(0, 0, 0, 0.6),
			0 1px 6px rgba(0, 0, 0, 0.4);
	}

	@media (max-width: 640px) {
		.sheet-preview-stage {
			padding-right: 10px;
			padding-left: 10px;
		}

		.annotated-preview-paper {
			padding: 18px;
		}
	}
</style>
