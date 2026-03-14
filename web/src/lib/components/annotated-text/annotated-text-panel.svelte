<script lang="ts">
	import type {
		AnnotatedTextAnnotation,
		AnnotatedTextDocument,
		AnnotatedTextTheme,
		AnnotatedTextTypeMeta
	} from './types';

	type AnnotatedSegment =
		| {
				type: 'plain';
				text: string;
		  }
		| {
				type: 'annotation';
				text: string;
				annotation: AnnotatedTextAnnotation;
		  };

	type AnnotatedPalette = {
		surface: string;
		border: string;
		text: string;
		textMuted: string;
		textSubtle: string;
		popupText: string;
	};

	const palettes = {
		light: {
			surface: '#fafafa',
			border: '#e0e0e0',
			text: '#1a1a1a',
			textMuted: '#555555',
			textSubtle: '#aaaaaa',
			popupText: '#1a1a1a'
		},
		dark: {
			surface: '#17142a',
			border: '#302850',
			text: '#e4dff5',
			textMuted: '#a89ec4',
			textSubtle: '#6b5f8a',
			popupText: '#f0eef8'
		}
	} satisfies Record<AnnotatedTextTheme, AnnotatedPalette>;

	function rgbaFromHex(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '');
		const red = Number.parseInt(normalized.slice(0, 2), 16);
		const green = Number.parseInt(normalized.slice(2, 4), 16);
		const blue = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}

	function prettifyLabel(value: string): string {
		return value.slice(0, 1).toUpperCase() + value.slice(1);
	}

	function getTypeColors(
		meta: AnnotatedTextTypeMeta,
		theme: AnnotatedTextTheme
	): {
		color: string;
		background: string;
		borderColor: string;
		inactiveBackground: string;
	} {
		if (theme === 'dark') {
			return {
				color: meta.darkColor,
				background: meta.darkBackground,
				borderColor: meta.darkBorderColor,
				inactiveBackground: rgbaFromHex(meta.darkColor, 0.16)
			};
		}

		return {
			color: meta.lightColor,
			background: meta.lightBackground,
			borderColor: meta.lightBorderColor,
			inactiveBackground: rgbaFromHex(meta.lightColor, 0.14)
		};
	}

	function buildSegments(text: string, annotations: AnnotatedTextAnnotation[]): AnnotatedSegment[] {
		const segments: AnnotatedSegment[] = [];
		let cursor = 0;

		for (const annotation of annotations) {
			if (annotation.start > cursor) {
				segments.push({
					type: 'plain',
					text: text.slice(cursor, annotation.start)
				});
			}

			const annotatedText = text.slice(annotation.start, annotation.end);
			const annotatedLines = annotatedText.split(/(\n+)/);

			for (const annotatedLine of annotatedLines) {
				if (!annotatedLine) {
					continue;
				}

				if (/^\n+$/.test(annotatedLine)) {
					segments.push({
						type: 'plain',
						text: annotatedLine
					});
					continue;
				}

				segments.push({
					type: 'annotation',
					annotation,
					text: annotatedLine
				});
			}

			cursor = annotation.end;
		}

		if (cursor < text.length) {
			segments.push({
				type: 'plain',
				text: text.slice(cursor)
			});
		}

		return segments;
	}

	let {
		document,
		theme = 'light'
	}: {
		document: AnnotatedTextDocument;
		theme?: AnnotatedTextTheme;
	} = $props();

	let activeAnnotationId = $state<string | null>(null);

	const palette = $derived(palettes[theme]);
	const sortedAnnotations = $derived(
		[...document.annotations].sort((left, right) => left.start - right.start)
	);
	const segments = $derived(buildSegments(document.text, sortedAnnotations));
	const activeAnnotation = $derived.by(() => {
		if (!activeAnnotationId) {
			return null;
		}

		for (const annotation of document.annotations) {
			if (annotation.id === activeAnnotationId) {
				return annotation;
			}
		}

		return null;
	});
	const activeTypeMeta = $derived(
		activeAnnotation ? (document.annotationTypes[activeAnnotation.type] ?? null) : null
	);

	function toggleAnnotation(annotationId: string): void {
		activeAnnotationId = activeAnnotationId === annotationId ? null : annotationId;
	}

	function handleHighlightKeydown(event: KeyboardEvent, annotationId: string): void {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		toggleAnnotation(annotationId);
	}
</script>

<div class={`annotated-text ${theme === 'dark' ? 'is-dark' : 'is-light'}`}>
	<div class="annotated-text__copy">
		<h2 class="annotated-text__heading">{document.heading}</h2>
		<p class="annotated-text__description">{document.description}</p>
	</div>

	<div
		class="annotated-text__surface"
		style={`background:${palette.surface}; border-color:${palette.border}; color:${palette.text};`}
	>
		{#each segments as segment, index (`segment-${index}`)}
			{#if segment.type === 'plain'}
				<span>{segment.text}</span>
			{:else}
				{@const meta = document.annotationTypes[segment.annotation.type]}
				{@const colors = getTypeColors(meta, theme)}
				{@const isActive = activeAnnotationId === segment.annotation.id}

				<span
					role="button"
					tabindex="0"
					class="annotated-text__highlight"
					aria-pressed={isActive}
					onclick={() => {
						toggleAnnotation(segment.annotation.id);
					}}
					onkeydown={(event) => {
						handleHighlightKeydown(event, segment.annotation.id);
					}}
					style={[
						`background:${isActive ? colors.background : colors.inactiveBackground}`,
						`border-bottom-color:${colors.color}`,
						`color:${palette.text}`
					].join('; ')}
				>
					{segment.text}
				</span>
			{/if}
		{/each}
	</div>

	{#if activeAnnotation && activeTypeMeta}
		{@const colors = getTypeColors(activeTypeMeta, theme)}
		<div
			class="annotated-text__note"
			style={[
				`background:${colors.background}`,
				`border-color:${colors.borderColor}`,
				`color:${palette.popupText}`
			].join('; ')}
		>
			<div class="annotated-text__note-header">
				<span
					class="annotated-text__badge"
					style={[
						`color:${colors.color}`,
						`background:${rgbaFromHex(colors.color, theme === 'dark' ? 0.18 : 0.14)}`
					].join('; ')}
				>
					{activeAnnotation.label}
				</span>
				<button
					type="button"
					class="annotated-text__close"
					aria-label="Close annotation"
					onclick={() => {
						activeAnnotationId = null;
					}}
				>
					✕
				</button>
			</div>
			<p class="annotated-text__note-body">{activeAnnotation.comment}</p>
		</div>
	{/if}

	<div class="annotated-text__legend">
		{#each Object.entries(document.annotationTypes) as [type, meta] (`legend-${type}`)}
			{@const colors = getTypeColors(meta, theme)}
			<div class="annotated-text__legend-item">
				<span
					class="annotated-text__legend-chip"
					style={`background:${colors.color};`}
					aria-hidden="true"
				></span>
				<span>{meta.label ?? prettifyLabel(type)}</span>
			</div>
		{/each}
		<span class="annotated-text__legend-note">click highlighted text to view comment</span>
	</div>
</div>

<style>
	.annotated-text {
		font-family: Georgia, 'Times New Roman', serif;
	}

	.annotated-text__copy {
		margin-bottom: 14px;
	}

	.annotated-text__heading {
		margin: 0 0 6px;
		font-size: 14px;
		font-weight: 700;
	}

	.annotated-text__description {
		margin: 0;
		font-size: 13px;
		font-style: italic;
		line-height: 1.7;
	}

	.annotated-text.is-light .annotated-text__heading {
		color: #1a1a1a;
	}

	.annotated-text.is-light .annotated-text__description {
		color: #555555;
	}

	.annotated-text.is-dark .annotated-text__heading {
		color: #e4dff5;
	}

	.annotated-text.is-dark .annotated-text__description {
		color: #a89ec4;
	}

	.annotated-text__surface {
		margin-bottom: 16px;
		padding: 18px 20px;
		border: 1.5px solid #e0e0e0;
		border-radius: 8px;
		font-size: 13px;
		line-height: 2.1;
		white-space: pre-wrap;
	}

	.annotated-text__highlight {
		display: inline;
		border: 0;
		border-bottom: 2px solid transparent;
		border-radius: 2px 2px 0 0;
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
		padding: 1px 2px;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.annotated-text__highlight:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	.annotated-text__note {
		margin-bottom: 12px;
		border: 1.5px solid #e0e0e0;
		border-radius: 8px;
		padding: 14px 18px;
	}

	.annotated-text__note-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.annotated-text__badge {
		display: inline-flex;
		align-items: center;
		border-radius: 4px;
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.annotated-text__close {
		margin-left: auto;
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 14px;
		cursor: pointer;
	}

	.annotated-text__note-body {
		margin: 0;
		font-size: 13px;
		line-height: 1.7;
	}

	.annotated-text__legend {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		font-size: 11px;
	}

	.annotated-text.is-light .annotated-text__legend {
		color: #555555;
	}

	.annotated-text.is-dark .annotated-text__legend {
		color: #a89ec4;
	}

	.annotated-text__legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.annotated-text__legend-chip {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}

	.annotated-text__legend-note {
		font-style: italic;
	}

	.annotated-text.is-light .annotated-text__legend-note {
		color: #aaaaaa;
	}

	.annotated-text.is-dark .annotated-text__legend-note {
		color: #6b5f8a;
	}
</style>
