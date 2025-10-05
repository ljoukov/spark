<script lang="ts">
	import { onMount } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { loadMonaco } from '$lib/monaco/index.js';
	import type { Monaco } from '$lib/monaco/index.js';
	import { mergeProps } from 'bits-ui';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { editor as MonacoEditorNS, IDisposable } from 'monaco-editor';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Minimize2 from '@lucide/svelte/icons/minimize-2';
	import Play from '@lucide/svelte/icons/play';
	import Send from '@lucide/svelte/icons/send';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import type { PageData } from './$types';

	type HashAlgorithm = 'sha256' | 'sha512';

	type FormatResponse = {
		formatted: string;
		unchanged: boolean;
		hashes: {
			algorithm: HashAlgorithm;
			original: string;
			formatted: string;
		};
	};

	type PaneSide = 'left' | 'right';

	const DEFAULT_LAYOUT = [50, 50] as const;
	const CODE_PANE_DEFAULT_LAYOUT = [90, 10] as const;
	const LEFT_MAX_LAYOUT = [100, 0] as const;
	const RIGHT_MAX_LAYOUT = [0, 100] as const;

	const buttonShapeClass = 'rounded-md cursor-pointer';
	const iconButtonClasses = cn(buttonVariants({ variant: 'outline', size: 'icon' }), buttonShapeClass);
	const formatButtonClasses = (failed: boolean) =>
		cn(buttonVariants({ variant: failed ? 'destructive' : 'outline', size: 'sm' }), buttonShapeClass);
	const runButtonClasses = cn(buttonVariants({ variant: 'outline', size: 'sm' }), buttonShapeClass);
	const submitButtonClasses = cn(buttonVariants({ size: 'sm' }), buttonShapeClass);
	const formatTooltipLabel = 'Format code';
	const runTooltipLabel = 'Run code';
	const submitTooltipLabel = 'Submit code';

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
	let isFormatting = false;
	let formatFailed = false;

	const FORMAT_ENDPOINT = '/api/format';
	const FORMAT_HASH_ALGORITHM: HashAlgorithm = 'sha256';

	async function computeHashHex(algorithm: HashAlgorithm, content: string): Promise<string> {
		if (typeof crypto === 'undefined' || !crypto.subtle) {
			throw new Error('Secure hashing is unavailable in this environment');
		}
		const subtleAlgorithm = algorithm === 'sha256' ? 'SHA-256' : 'SHA-512';
		const digest = await crypto.subtle.digest(subtleAlgorithm, new TextEncoder().encode(content));
		return Array.from(new Uint8Array(digest))
			.map((value) => value.toString(16).padStart(2, '0'))
			.join('');
	}

	async function handleFormatClick() {
		if (isFormatting) {
			return;
		}
		isFormatting = true;

		const currentSource = monacoEditor?.getValue() ?? rightText ?? '';

		try {
			const hash = await computeHashHex(FORMAT_HASH_ALGORITHM, currentSource);
			const response = await fetch(FORMAT_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					content: currentSource,
					hash,
					algorithm: FORMAT_HASH_ALGORITHM
				})
			});

			if (!response.ok) {
				let message = 'Unable to format code';
				try {
					const errorPayload = (await response.json()) as { message?: string };
					if (errorPayload?.message) {
						message = errorPayload.message;
					}
				} catch (error) {
					console.error('Failed to parse format error response', error);
				}
				throw new Error(message);
			}

			const payload = (await response.json()) as FormatResponse;
			if (payload.hashes.algorithm !== FORMAT_HASH_ALGORITHM) {
				throw new Error('Formatter returned unexpected hash algorithm');
			}
			const formattedHash = await computeHashHex(FORMAT_HASH_ALGORITHM, payload.formatted);
			if (formattedHash !== payload.hashes.formatted) {
				throw new Error('Formatter response failed integrity check');
			}
			if (monacoEditor && monacoEditor.getValue() !== payload.formatted) {
				const model = monacoEditor.getModel();
				if (model) {
					const fullRange = model.getFullModelRange();
					const currentSelections = monacoEditor.getSelections();
					monacoEditor.pushUndoStop();
					monacoEditor.executeEdits('format', [
						{
							range: fullRange,
							text: payload.formatted,
							forceMoveMarkers: true
						}
					], currentSelections ?? undefined);
					monacoEditor.pushUndoStop();
				} else {
					monacoEditor.setValue(payload.formatted);
				}
			}
			formatFailed = false;
			rightText = payload.formatted;
		} catch (error) {
			formatFailed = true;
			console.error('Format request failed', error);
		} finally {
			isFormatting = false;
		}
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
		let keybindingDisposables: IDisposable[] = [];

		const subscribeUndoRedoShortcuts = (monaco: Monaco, editor: CodeEditor | null) => {
			if (!editor) {
				return;
			}

			keybindingDisposables.forEach((disposable) => {
				disposable.dispose();
			});
			keybindingDisposables = [];

			const handleKeyDown = editor.onKeyDown((event) => {
				const usesModifier = event.metaKey || event.ctrlKey;
				if (!usesModifier) {
					return;
				}

				const isUndo = event.keyCode === monaco.KeyCode.KeyZ && !event.shiftKey;
				const isRedoWithZ = event.keyCode === monaco.KeyCode.KeyZ && event.shiftKey;
				const isRedoWithY = event.keyCode === monaco.KeyCode.KeyY && !event.shiftKey;

				if (!isUndo && !isRedoWithZ && !isRedoWithY) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();

				const model = editor.getModel();
				if (!model) {
					return;
				}

				if (isUndo) {
					model.undo();
					return;
				}

				model.redo();
			});

			keybindingDisposables.push(handleKeyDown);
		};

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

			subscribeUndoRedoShortcuts(monaco, monacoEditor);

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
				keybindingDisposables.forEach((disposable) => {
					disposable.dispose();
				});
				keybindingDisposables = [];
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

	$: leftPaneControlLabel =
		maximizedPane === 'left'
			? 'Return problem statement pane to normal size'
			: 'Maximize problem statement pane';

	$: rightPaneControlLabel =
		maximizedPane === 'right'
			? 'Return code editor pane to normal size'
			: 'Maximize code editor pane';
</script>

<Tooltip.Provider>
	<section class="workspace-page overflow-hidden p-2">
	<div class="workspace flex min-h-0 flex-1 overflow-hidden">
		<Resizable.PaneGroup
			direction="horizontal"
			class="workspace-pane-group flex min-h-0 w-full flex-1 overflow-hidden rounded-lg border bg-card shadow"
			bind:this={paneGroup}
			onLayoutChange={handleLayoutChange}
		>
			<Resizable.Pane class="min-h-0" defaultSize={DEFAULT_LAYOUT[0]} minSize={0}>
				<div class="pane-column flex h-full min-h-0 w-full flex-1 flex-col gap-2 p-2">
					<div class="flex items-center justify-between gap-2">
						<div class="flex flex-col">
							<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
								>Problem</span
							>
							<h2 class="text-sm leading-tight font-semibold">{problem.title}</h2>
						</div>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								{@const mergedProps = mergeProps(props ?? {}, {
									type: 'button' as const,
									class: iconButtonClasses,
									'aria-label': leftPaneControlLabel,
									onclick: () => toggleMaximize('left')
								})}
								<button {...mergedProps}>
									{#if maximizedPane === 'left'}
										<Minimize2 class="size-4" />
									{:else}
										<Maximize2 class="size-4" />
									{/if}
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>{leftPaneControlLabel}</Tooltip.Content>
					</Tooltip.Root>
					</div>
					<div
						class="markdown-scroll min-h-0 flex-1 overflow-y-auto rounded-md border border-input bg-background p-3 text-sm shadow-sm"
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
						<div class="flex items-center pl-2">
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										{@const mergedProps = mergeProps(props ?? {}, {
											type: 'button' as const,
											class: cn(
												formatButtonClasses(formatFailed),
												isFormatting ? 'pointer-events-none opacity-60' : ''
											),
											disabled: isFormatting,
											'aria-disabled': isFormatting ? true : undefined,
											'aria-busy': isFormatting ? true : undefined,
											'aria-invalid': formatFailed ? true : undefined,
											'aria-label': formatTooltipLabel,
											onclick: handleFormatClick
										})}
										<button {...mergedProps}>
											<TextAlignStart class="size-4" />
											<span class="hidden sm:inline">Format Code</span>
										</button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>{formatTooltipLabel}</Tooltip.Content>
							</Tooltip.Root>
						<div class="ml-4 flex items-center gap-2">
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											{@const mergedProps = mergeProps(props ?? {}, {
												type: 'button' as const,
												class: runButtonClasses,
												'aria-label': runTooltipLabel
											})}
											<button {...mergedProps}>
												<span class="hidden sm:inline">Run</span>
												<Play class="size-4" />
											</button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>{runTooltipLabel}</Tooltip.Content>
								</Tooltip.Root>
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											{@const mergedProps = mergeProps(props ?? {}, {
												type: 'button' as const,
												class: submitButtonClasses,
												'aria-label': submitTooltipLabel
											})}
											<button {...mergedProps}>
												<span class="hidden sm:inline">Submit</span>
												<Send class="size-4" />
											</button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>{submitTooltipLabel}</Tooltip.Content>
								</Tooltip.Root>
							</div>
						</div>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								{@const mergedProps = mergeProps(props ?? {}, {
									type: 'button' as const,
									class: iconButtonClasses,
									'aria-label': rightPaneControlLabel,
									onclick: () => toggleMaximize('right')
								})}
								<button {...mergedProps}>
									{#if maximizedPane === 'right'}
										<Minimize2 class="size-4" />
									{:else}
										<Maximize2 class="size-4" />
									{/if}
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>{rightPaneControlLabel}</Tooltip.Content>
					</Tooltip.Root>
					</div>
					<Resizable.PaneGroup direction="vertical" class="code-pane-group min-h-0 flex-1">
						<Resizable.Pane class="min-h-0" defaultSize={CODE_PANE_DEFAULT_LAYOUT[0]} minSize={0}>
							<div class="code-editor-pane pb-2">
								<div class="editor-shell" class:formatting={isFormatting} data-code-length={rightText.length}>
									<div
										class="editor-container"
										bind:this={editorContainer}
										role="presentation"
										aria-label="Python editor"
									></div>
								</div>
							</div>
						</Resizable.Pane>
						<Resizable.Handle withHandle class="code-pane-handle" />
						<Resizable.Pane class="min-h-0" defaultSize={CODE_PANE_DEFAULT_LAYOUT[1]} minSize={0}>
							<div class="code-output-pane pt-2">
								<div class="code-output-shell" aria-label="Output panel" data-empty>
									<span>Output panel</span>
								</div>
							</div>
						</Resizable.Pane>
					</Resizable.PaneGroup>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</div>
</section>
</Tooltip.Provider>

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

	:global(.workspace-pane-group) {
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
		height: 100%;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		overscroll-behavior: contain;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.6rem;
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
		background: transparent;
	}

	.editor-shell.formatting {
		opacity: 0.6;
		transition: opacity 0.15s ease;
	}

	.editor-container {
		height: 100%;
		width: 100%;
	}

	.code-editor-pane {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	:global(.code-pane-group) {
		flex: 1 1 auto;
		min-height: 0;
	}

	:global(.code-pane-handle) {
		position: relative;
	}

	.code-output-shell {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.6rem;
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
		background: color-mix(in srgb, currentColor 6%, transparent);
		padding: 0.75rem;
		font-size: 0.8rem;
		color: hsl(var(--muted-foreground));
		text-align: center;
	}

	.code-output-shell[data-empty] span {
		font-style: italic;
		opacity: 0.8;
	}

	.code-output-pane {
		display: flex;
		flex: 1 1 auto;
		height: 100%;
		min-height: 0;
	}
</style>
