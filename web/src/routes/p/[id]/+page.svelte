<script lang="ts">
	import { onMount } from 'svelte';
	import { marked } from 'marked';
	import type { editor as MonacoEditorNS } from 'monaco-editor';
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { loadMonaco } from '$lib/monaco/index.js';

	marked.setOptions({ breaks: true });

	let { data }: { data: PageData } = $props();

	let problem = $state(data.problem);
	let markdownHtml = $state('');
	let code = $state('');
	let editorContainer: HTMLDivElement | null = null;
	type CodeEditor = MonacoEditorNS.IStandaloneCodeEditor;
	let monacoEditor: CodeEditor | null = null;
	let workspaceContainer: HTMLDivElement | null = null;
	const MIN_SPLIT = 30;
	const MAX_SPLIT = 70;
	let splitPercent = $state(54);
	let isDragging = $state(false);

	function clampSplit(next: number) {
		return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, next));
	}

	function updateSplitFromPosition(clientX: number) {
		if (!workspaceContainer) {
			return;
		}
		const rect = workspaceContainer.getBoundingClientRect();
		if (rect.width === 0) {
			return;
		}
		const relative = ((clientX - rect.left) / rect.width) * 100;
		splitPercent = clampSplit(relative);
	}

	function handleSplitterPointerDown(event: PointerEvent) {
		if (!workspaceContainer) {
			return;
		}
		event.preventDefault();
		isDragging = true;
		updateSplitFromPosition(event.clientX);
		const handlePointerMove = (moveEvent: PointerEvent) => {
			moveEvent.preventDefault();
			updateSplitFromPosition(moveEvent.clientX);
		};
		const handlePointerUp = () => {
			isDragging = false;
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('pointercancel', handlePointerUp);
		};
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerUp);
	}

	function handleSplitterKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
			return;
		}
		event.preventDefault();
		const delta = event.key === 'ArrowRight' ? 3 : -3;
		splitPercent = clampSplit(splitPercent + delta);
	}

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

	onMount(() => {
		let disposeEditor = () => {};
		let observer: MutationObserver | null = null;
		let mediaQuery: MediaQueryList | null = null;

		void (async () => {
			const monaco = await loadMonaco();
			if (!monaco || !editorContainer) {
				return;
			}

			const applyTheme = () => {
				monaco.editor.setTheme(resolveMonacoTheme());
			};

			applyTheme();

			monacoEditor = monaco.editor.create(editorContainer, {
				value: problem.starterCode,
				language: 'python',
				automaticLayout: true,
				minimap: { enabled: false },
				fontSize: 15,
				fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace',
				smoothScrolling: true,
				tabSize: 4,
				insertSpaces: true,
				wordWrap: 'off',
				scrollbar: { alwaysConsumeMouseWheel: false },
				quickSuggestions: false,
				suggestOnTriggerCharacters: false,
				wordBasedSuggestions: 'off',
				parameterHints: { enabled: false },
				lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
				codeLens: false,
				inlineSuggest: { enabled: false },
				matchBrackets: 'always',
				autoClosingBrackets: 'never',
				bracketPairColorization: { enabled: true },
				renderLineHighlight: 'gutter',
				renderWhitespace: 'selection',
				fixedOverflowWidgets: true
			});

			const model = monacoEditor.getModel();
			if (model) {
				monaco.editor.setModelLanguage(model, 'python');
			}

			const subscription = monacoEditor.onDidChangeModelContent(() => {
				code = monacoEditor?.getValue() ?? '';
			});

			mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			const handleMediaChange = () => {
				applyTheme();
			};
			mediaQuery.addEventListener('change', handleMediaChange);

			observer = new MutationObserver(applyTheme);
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

			disposeEditor = () => {
				subscription.dispose();
				observer?.disconnect();
				mediaQuery?.removeEventListener('change', handleMediaChange);
				monacoEditor?.dispose();
				monacoEditor = null;
			};
		})();

		return () => {
			disposeEditor();
		};
	});

	$effect(() => {
		if (problem !== data.problem) {
			problem = data.problem;
		}
	});

	$effect(() => {
		const parsed = marked.parse(problem.markdown ?? '');
		markdownHtml = typeof parsed === 'string' ? parsed : '';
	});

	function handleResetEditor(): void {
		const nextValue = problem.starterCode;
		code = nextValue;
		monacoEditor?.setValue(nextValue);
	}

	$effect(() => {
		if (!monacoEditor) {
			code = problem.starterCode;
			return;
		}
		const nextStarter = problem.starterCode;
		if (monacoEditor.getValue() !== nextStarter) {
			monacoEditor.setValue(nextStarter);
		}
		code = nextStarter;
	});
</script>

<svelte:head>
	<title>{problem.title} · Spark Code</title>
</svelte:head>

<div class="code-page">
	<div
		class="workspace"
		bind:this={workspaceContainer}
		class:dragging={isDragging}
		style:--split={`${splitPercent}%`}
	>
		<section class="panel problem-panel">
			<header class="panel-header">
				<p class="panel-eyebrow">Problem {problem.id}</p>
				<h1>{problem.title}</h1>
				<div class="panel-meta">
					<span class="chip difficulty" data-difficulty={problem.difficulty.toLowerCase()}>
						{problem.difficulty}
					</span>
					<span class="chip category">{problem.category}</span>
					{#each problem.tags as tag}
						<span class="chip tag">{tag}</span>
					{/each}
					<span class="chip time">{problem.estimatedTime}</span>
				</div>
			</header>
			<div class="panel-body" aria-label="Problem description">
				<div class="markdown">{@html markdownHtml}</div>
			</div>
			<section class="panel-hints" aria-label="Hints">
				<h2>Hints</h2>
				<ul>
					{#each problem.hints as hint}
						<li>{hint}</li>
					{/each}
				</ul>
			</section>
		</section>

		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="splitter"
			role="separator"
			tabindex="0"
			onpointerdown={handleSplitterPointerDown}
			onkeydown={handleSplitterKeydown}
			aria-orientation="vertical"
			aria-valuemin={MIN_SPLIT}
			aria-valuemax={MAX_SPLIT}
			aria-valuenow={Math.round(splitPercent)}
			aria-label="Resize workspace"
		>
			<span class="grab-handle" aria-hidden="true"></span>
		</div>

		<section class="panel editor-panel">
			<header class="editor-toolbar">
				<Button variant="secondary" onclick={handleResetEditor}>
					Reset editor
				</Button>
			</header>
			<div class="editor-shell" data-code-length={code.length}>
				<div class="editor-container" bind:this={editorContainer} role="presentation" aria-label="Python editor"></div>
			</div>
			<footer class="editor-footer">
				<span>{code.split('\n').length} lines</span>
			</footer>
		</section>
	</div>
</div>

<style>
	.code-page {
		display: flex;
		flex-direction: column;
		gap: clamp(0.2rem, 0.4vw, 0.32rem);
		padding: clamp(0.2rem, 0.45vw, 0.4rem);
		min-height: 100vh;
		background: transparent;
		color: var(--text-primary, var(--foreground));
	}

	.workspace {
		--divider-width: clamp(0.9rem, 1.5vw, 1.25rem);
		display: grid;
		grid-template-columns:
			minmax(18rem, calc(var(--split) - (var(--divider-width) / 2)))
			var(--divider-width)
			minmax(18rem, calc(100% - var(--split) - (var(--divider-width) / 2)));
		column-gap: 0;
		align-items: stretch;
		flex: 1;
		min-height: 0;
		height: 100%;
		transition: grid-template-columns 0.15s ease;
	}

	.workspace.dragging {
		user-select: none;
		cursor: col-resize;
	}

	.panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-radius: 0.75rem;
		border: 1px solid var(--surface-border, var(--border));
		background: var(--surface-color, var(--card));
		box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: clamp(1.1rem, 1.9vw, 1.6rem) clamp(1.1rem, 1.9vw, 1.6rem) clamp(0.85rem, 1.45vw, 1.2rem);
	}

	.panel-eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--text-secondary, rgba(15, 23, 42, 0.65));
		font-weight: 600;
	}

	.panel-header h1 {
		margin: 0;
		font-weight: 600;
		line-height: 1.1;
		color: inherit;
		font-size: clamp(1.55rem, 2.5vw, 2.05rem);
	}

	.panel-header p {
		margin: 0;
		color: var(--text-secondary, rgba(15, 23, 42, 0.68));
		font-size: 0.95rem;
		line-height: 1.45;
	}

	.panel-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		font-size: 0.76rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		background: rgba(148, 163, 184, 0.12);
		color: var(--text-secondary, rgba(15, 23, 42, 0.72));
		border: 1px solid rgba(148, 163, 184, 0.22);
	}

	.chip.difficulty[data-difficulty='easy'] {
		background: rgba(34, 197, 94, 0.12);
		border-color: rgba(34, 197, 94, 0.3);
		color: rgba(22, 101, 52, 0.9);
	}

	.chip.difficulty[data-difficulty='medium'] {
		background: rgba(251, 191, 36, 0.14);
		border-color: rgba(251, 191, 36, 0.42);
		color: rgba(133, 77, 14, 0.9);
	}

	.chip.difficulty[data-difficulty='hard'] {
		background: rgba(239, 68, 68, 0.14);
		border-color: rgba(239, 68, 68, 0.35);
		color: rgba(153, 27, 27, 0.9);
	}

	.panel-body {
		flex: 1;
		min-height: 0;
		padding: 0 clamp(1.1rem, 1.9vw, 1.6rem);
		padding-bottom: clamp(1rem, 1.6vw, 1.4rem);
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.problem-panel .panel-body {
		border-top: 1px solid rgba(148, 163, 184, 0.18);
	}

	.markdown {
		font-size: 0.97rem;
		line-height: 1.65;
		color: inherit;
	}

	:global(.markdown h2),
	:global(.markdown h3) {
		margin-top: 1.1rem;
		margin-bottom: 0.45rem;
		font-size: 1.08rem;
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
		font-size: 0.84rem;
		padding: 0.1rem 0.28rem;
		border-radius: 0.3rem;
		background: rgba(15, 23, 42, 0.08);
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	:global(.markdown pre) {
		margin: 1.25rem 0;
		padding: 1.15rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(15, 23, 42, 0.08);
		background: color-mix(in srgb, currentColor 14%, transparent);
	}

	:global(.markdown pre code) {
		display: block;
		padding: 0;
		background: transparent;
	}

	.panel-hints {
		padding: 1rem clamp(1.1rem, 1.9vw, 1.6rem) 1.25rem;
		border-top: 1px solid rgba(148, 163, 184, 0.18);
		background: rgba(148, 163, 184, 0.08);
	}

	.panel-hints h2 {
		margin: 0 0 0.75rem;
		font-size: 0.98rem;
		font-weight: 600;
	}

	.panel-hints ul {
		margin: 0;
		padding-left: 1.25rem;
		display: grid;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary, rgba(15, 23, 42, 0.78));
	}

	.editor-panel {
		min-height: 0;
	}

	.editor-toolbar {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.4rem;
		padding: 0.75rem clamp(1rem, 1.8vw, 1.4rem);
		border-bottom: 1px solid rgba(148, 163, 184, 0.18);
		background: rgba(148, 163, 184, 0.08);
	}

	.editor-toolbar :global(button) {
		border-radius: 9999px;
		padding-inline: 1.1rem;
	}

	.editor-shell {
		flex: 1;
		min-height: 0;
		display: flex;
		padding: clamp(1rem, 1.8vw, 1.4rem);
	}

	.editor-container {
		flex: 1;
		border-radius: 0.6rem;
		overflow: hidden;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background: rgba(15, 23, 42, 0.1);
	}

	.editor-footer {
		display: flex;
		justify-content: flex-end;
		padding: 0 clamp(1rem, 1.8vw, 1.4rem) clamp(1rem, 1.8vw, 1.4rem);
		font-size: 0.82rem;
		color: var(--text-secondary, rgba(15, 23, 42, 0.7));
	}

	.splitter {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		appearance: none;
		border: none;
		margin: 0;
		padding: 0;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.22);
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.32);
		cursor: col-resize;
		transition: background-color 0.15s ease, box-shadow 0.15s ease;
		touch-action: none;
		padding-inline: clamp(0.35rem, 0.6vw, 0.55rem);
		line-height: 0;
	}

	.splitter:focus {
		outline: none;
	}

	.splitter:hover,
	.workspace.dragging .splitter,
	.splitter:focus-visible {
		background: rgba(99, 102, 241, 0.22);
		box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.4);
	}

	.splitter:focus-visible {
		outline: 2px solid rgba(99, 102, 241, 0.55);
		outline-offset: 2px;
	}

	.grab-handle {
		position: relative;
		width: 4px;
		height: 30px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.25);
	}

	:global([data-theme='dark']) .code-page {
		color: rgba(226, 232, 240, 0.94);
	}

	:global([data-theme='dark']) .panel {
		background: rgba(15, 23, 42, 0.78);
		border-color: rgba(148, 163, 184, 0.24);
		box-shadow: 0 10px 28px rgba(2, 6, 23, 0.28);
	}

	:global([data-theme='dark']) .panel-hints {
		background: rgba(148, 163, 184, 0.12);
	}

	:global([data-theme='dark']) .editor-toolbar {
		background: rgba(148, 163, 184, 0.12);
		border-color: rgba(148, 163, 184, 0.2);
	}

	:global([data-theme='dark']) .editor-container {
		border-color: rgba(148, 163, 184, 0.28);
		background: rgba(30, 41, 59, 0.65);
	}

	:global([data-theme='dark']) .splitter {
		background: rgba(148, 163, 184, 0.28);
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.4);
	}

	:global([data-theme='dark']) .splitter:hover,
	:global([data-theme='dark']) .workspace.dragging .splitter,
	:global([data-theme='dark']) .splitter:focus-visible {
		background: rgba(99, 102, 241, 0.28);
		box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.45);
	}

	@media (max-width: 960px) {
		.workspace {
			grid-template-columns: 1fr;
		}

		.splitter {
			display: none;
		}

		.editor-panel {
			margin-top: clamp(0.85rem, 1.8vw, 1.4rem);
		}
	}
</style>
