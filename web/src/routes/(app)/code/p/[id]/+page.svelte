<script lang="ts">
	import { onMount } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { loadMonaco } from '$lib/monaco/index.js';
	import type { editor as MonacoEditorNS, IDisposable } from 'monaco-editor';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Minimize2 from '@lucide/svelte/icons/minimize-2';
	import type { PageData } from './$types';

	type PaneSide = 'left' | 'right';

	const DEFAULT_LAYOUT = [50, 50] as const;
	const LEFT_MAX_LAYOUT = [100, 0] as const;
	const RIGHT_MAX_LAYOUT = [0, 100] as const;

	const iconButtonClasses = cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'rounded-md');

	export let data: PageData;

	let problem = data.problem;
	let markdownHtml = data.problem.markdownHtml;
	const DEFAULT_CODE = 'print("hello world :)")';
	let rightText = DEFAULT_CODE;
	let maximizedPane: PaneSide | null = null;
	let paneGroup: { setLayout: (layout: number[]) => void; getLayout: () => number[] } | null = null;
	let currentProblemId = problem.id;
	let editorContainer: HTMLDivElement | null = null;
	type CodeEditor = MonacoEditorNS.IStandaloneCodeEditor;
	let monacoEditor: CodeEditor | null = null;
	let disposeEditor: (() => void) | null = null;

	function resolveMonacoTheme(): 'vs-dark' | 'vs' {
		if (typeof document === 'undefined') {
			return 'vs-dark';
		}
		const themeAttr = document.documentElement.dataset.theme;
		if (themeAttr === 'light') {
			return 'vs';
		}
		if (themeAttr === 'dark') {
			return 'vs-dark';
		}
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs';
	}

	$: if (problem !== data.problem) {
		problem = data.problem;
	}

	$: if (markdownHtml !== problem.markdownHtml) {
		markdownHtml = problem.markdownHtml;
	}

	$: if (problem.id !== currentProblemId) {
		currentProblemId = problem.id;
		rightText = DEFAULT_CODE;
		if (monacoEditor && monacoEditor.getValue() !== rightText) {
			monacoEditor.setValue(rightText);
		}
	}

	onMount(() => {
		let subscription: IDisposable | null = null;
		let themeObserver: MutationObserver | null = null;
		let mediaQuery: MediaQueryList | null = null;
		let applyTheme: (() => void) | null = null;

		void (async () => {
			const monaco = await loadMonaco();
			if (!monaco || !editorContainer) {
				return;
			}

			applyTheme = () => {
				monaco.editor.setTheme(resolveMonacoTheme());
			};

			monacoEditor = monaco.editor.create(editorContainer, {
				value: rightText,
				language: 'python',
				automaticLayout: true,
				minimap: { enabled: false },
				fontSize: 15,
				fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace',
				tabSize: 2,
				insertSpaces: true,
				detectIndentation: false,
				wordWrap: 'off',
				scrollbar: {
					vertical: 'visible',
					horizontal: 'auto',
					useShadows: false
				}
			});

			applyTheme();

			mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			mediaQuery.addEventListener('change', applyTheme);

			themeObserver = new MutationObserver(() => applyTheme?.());
			themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme']
			});

			subscription = monacoEditor.onDidChangeModelContent(() => {
				rightText = monacoEditor?.getValue() ?? '';
			});
		})();

		disposeEditor = () => {
			subscription?.dispose();
			themeObserver?.disconnect();
			if (mediaQuery && applyTheme) {
				mediaQuery.removeEventListener('change', applyTheme);
			}
			monacoEditor?.dispose();
			monacoEditor = null;
			subscription = null;
			themeObserver = null;
			mediaQuery = null;
			applyTheme = null;
		};

		return () => {
			disposeEditor?.();
			disposeEditor = null;
		};
	});

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

<section class="workspace-page flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
	<header class="flex-shrink-0 space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Split Text Workspace</h1>
		<p class="text-muted-foreground text-sm">
			Compare or edit text side by side with a draggable divider.
		</p>
	</header>

	<div class="workspace flex min-h-0 flex-1 overflow-hidden">
		<Resizable.PaneGroup
			direction="horizontal"
			class="workspace-pane-group bg-card flex min-h-0 w-full flex-1 overflow-hidden rounded-lg border shadow"
			bind:this={paneGroup}
			onLayoutChange={handleLayoutChange}
		>
			<Resizable.Pane class="min-h-0" defaultSize={DEFAULT_LAYOUT[0]} minSize={0}>
				<div class="pane-column flex h-full min-h-0 w-full flex-1 flex-col gap-2 p-2">
					<div class="flex items-center justify-between gap-2">
						<div class="flex flex-col">
							<span class="text-muted-foreground text-xs font-medium uppercase tracking-wide"
								>Problem</span
							>
							<h2 class="text-sm font-semibold leading-tight">{problem.title}</h2>
						</div>
						<button
							type="button"
							class={iconButtonClasses}
							on:click={() => toggleMaximize('left')}
							aria-label={maximizedPane === 'left'
								? 'Return left pane to normal size'
								: 'Maximize left pane'}
						>
							{#if maximizedPane === 'left'}
								<Minimize2 class="size-4" />
							{:else}
								<Maximize2 class="size-4" />
							{/if}
						</button>
					</div>
					<div
						class="markdown-scroll border-input bg-background min-h-0 flex-1 overflow-y-auto rounded-md border p-3 text-sm shadow-sm"
						aria-label="Problem description"
					>
						<div class="markdown space-y-4">{@html markdownHtml}</div>
					</div>
				</div>
			</Resizable.Pane>
			<Resizable.Handle withHandle class="bg-border" />
			<Resizable.Pane class="min-h-0" defaultSize={DEFAULT_LAYOUT[1]} minSize={0}>
				<div class="pane-column flex h-full min-h-0 w-full flex-1 flex-col gap-2 p-2">
					<div class="flex items-center justify-between gap-2">
						<div class="flex flex-col">
							<span class="text-muted-foreground text-xs font-medium uppercase tracking-wide"
								>Editor</span
							>
							<h2 class="text-sm font-semibold leading-tight">Python workspace</h2>
						</div>
						<button
							type="button"
							class={iconButtonClasses}
							on:click={() => toggleMaximize('right')}
							aria-label={maximizedPane === 'right'
								? 'Return right pane to normal size'
								: 'Maximize right pane'}
						>
							{#if maximizedPane === 'right'}
								<Minimize2 class="size-4" />
							{:else}
								<Maximize2 class="size-4" />
							{/if}
						</button>
					</div>
					<div class="editor-shell" data-code-length={rightText.length}>
						<div
							class="editor-container"
							bind:this={editorContainer}
							role="presentation"
							aria-label="Python editor"
						></div>
					</div>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</div>
</section>

<style lang="postcss">
    /*
     * Scrolling behavior note:
     * The layout already applies a conditional scroll lock via
     * `.app-main:has(.workspace) { overflow-y: hidden; }`.
     * We intentionally avoid any global `.app-main` overrides here,
     * because those can linger across client navigations and disable
     * scrolling on other pages.
     */

    :global(.app-content) {
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
    }

	.workspace-page {
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
	}

	.workspace {
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
	}

	.workspace-pane-group {
		height: 100%;
		min-height: 0;
		flex: 1 1 auto;
	}

	.pane-column {
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
	}
	.markdown {
		font-size: 0.95rem;
		line-height: 1.6;
	}

	:global(.markdown h2),
	:global(.markdown h3) {
		margin-top: 1rem;
		margin-bottom: 0.5rem;
		font-size: 1.05rem;
		font-weight: 600;
	}

	:global(.markdown h2:first-child),
	:global(.markdown h3:first-child) {
		margin-top: 0;
	}

	:global(.markdown p) {
		margin-block: 0.85rem;
	}

	:global(.markdown code) {
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85rem;
		padding: 0.1rem 0.28rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	:global(.markdown pre) {
		margin: 1.25rem 0;
		padding: 1.15rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: color-mix(in srgb, currentColor 14%, transparent);
		overflow-x: auto;
	}

	:global(.markdown pre code) {
		display: block;
		padding: 0;
		background: transparent;
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85rem;
	}

	.markdown-scroll {
		scrollbar-gutter: stable both-edges;
		overscroll-behavior: contain;
		flex: 1 1 auto;
		min-height: 0;
	}

	.editor-shell {
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		overscroll-behavior: contain;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.6rem;
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
		background: transparent;
	}

	.editor-container {
		height: 100%;
		width: 100%;
	}

</style>
