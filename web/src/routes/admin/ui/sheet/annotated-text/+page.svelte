<script lang="ts">
	import {
		AnnotatedTextPanel,
		sampleAnnotatedTextDocument,
		type AnnotatedTextTheme
	} from '$lib/components/annotated-text/index.js';
	import SheetPreviewNav from '../SheetPreviewNav.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let annotatedTextTheme = $state<AnnotatedTextTheme>('light');
</script>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Annotated text preview</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Standalone annotated-text panel preview from <code>$lib/components/annotated-text</code>.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
		</div>

		<SheetPreviewNav current="annotated-text" />
	</div>

	<div
		class={`sheet-preview-stage annotated-stage ${annotatedTextTheme === 'dark' ? 'is-dark' : 'is-light'}`}
	>
		<div class="sheet-preview-section-copy">
			<h2 class="sheet-preview-section-title">Theme preview</h2>
			<p class="sheet-preview-section-description">
				Swap themes to check annotation contrast, link styling, and code block rendering.
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

	.annotated-stage.is-dark {
		background:
			radial-gradient(circle at top left, rgba(196, 189, 224, 0.16), transparent 34%),
			linear-gradient(180deg, #221c3d 0%, #16122a 100%);
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

	.annotated-stage.is-dark .sheet-preview-section-title {
		color: #f8fafc;
	}

	.sheet-preview-section-description {
		margin: 0;
		font-size: 13px;
		line-height: 1.7;
		color: #555;
	}

	.annotated-stage.is-dark .sheet-preview-section-description {
		color: #c5bbdf;
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

	.annotated-stage.is-dark .sheet-preview-tab {
		border-color: #302850;
		background: #1f1b35;
		color: #a89ec4;
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

	.annotated-preview-paper {
		width: 100%;
		max-width: 1100px;
	}
</style>
