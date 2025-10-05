<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, onMount } from 'svelte';
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
	import Square from '@lucide/svelte/icons/square';
	import Send from '@lucide/svelte/icons/send';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import type {
		PythonRunnerRequest,
		PythonRunnerWorkerMessage
	} from '$lib/workers/python-runner.types';
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
	const iconButtonClasses = cn(
		buttonVariants({ variant: 'outline', size: 'icon' }),
		buttonShapeClass
	);
	const formatButtonClasses = (failed: boolean) =>
		cn(
			buttonVariants({ variant: failed ? 'destructive' : 'outline', size: 'sm' }),
			buttonShapeClass
		);
	const runButtonClasses = (isStop = false, isBusy = false) =>
		cn(
			buttonVariants({ variant: isStop ? 'destructive' : 'outline', size: 'sm' }),
			buttonShapeClass,
			'min-w-20 flex items-center gap-2',
			isBusy ? 'cursor-wait opacity-60' : ''
		);
	const submitButtonClasses = cn(buttonVariants({ size: 'sm' }), buttonShapeClass);
	const formatTooltipLabel = 'Format code';
	const RUN_TOOLTIP_LABEL = 'Run code';
	const STOP_TOOLTIP_LABEL = 'Stop code execution';
	const LOADING_TOOLTIP_LABEL = 'Python runtime is loading';
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

	const PRESET_STDIN_LINES = ['3', '5'];
	let isPyodideLoading = false;
	let isPyodideReady = false;
	let preloadWorker: Worker | null = null;
	let preloadRequestId: string | null = null;
	let isRunning = false;
	let runStatus: 'idle' | 'running' | 'completed' | 'error' | 'stopped' = 'idle';
	let stdoutChunks: string[] = [];
	let stderrChunks: string[] = [];
	let stdoutText = '';
	let stderrText = '';
	let runtimeMs: number | null = null;
	let activeWorker: Worker | null = null;
	let activeRunId: string | null = null;
	let runStartedAt = 0;
	let runTooltipLabel = RUN_TOOLTIP_LABEL;

	$: stdoutText = stdoutChunks.join('');
	$: stderrText = stderrChunks.join('');
	$: runTooltipLabel = isRunning
		? STOP_TOOLTIP_LABEL
		: isPyodideLoading
			? LOADING_TOOLTIP_LABEL
			: RUN_TOOLTIP_LABEL;
	$: runtimeLabel = formatRuntime(runtimeMs);
	$: runStatusLabel = (() => {
		switch (runStatus) {
			case 'running':
				return 'Running';
			case 'completed':
				return 'Completed';
			case 'error':
				return 'Error';
			case 'stopped':
				return 'Stopped';
			default:
				return 'Idle';
		}
	})();

	function formatRuntime(value: number | null): string {
		if (typeof value !== 'number') {
			return isRunning ? 'Running…' : '—';
		}
		if (value < 1000) {
			return `${value.toFixed(0)} ms`;
		}
		return `${(value / 1000).toFixed(2)} s`;
	}

	const PRESET_STDIN_TEXT = PRESET_STDIN_LINES.join('\n');

	function normalizeOutputChunk(text: string): string {
		return text.replace(/\r\n?/g, '\n');
	}

	function generateWorkerRequestId(): string {
		return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	}

	function createPythonWorker(): Worker {
		return new Worker(new URL('$lib/workers/python-runner.worker.ts', import.meta.url), {
			type: 'module'
		});
	}

	function cleanupPreloadWorker() {
		preloadWorker?.terminate();
		preloadWorker = null;
		preloadRequestId = null;
	}

	function startPyodidePreload() {
		if (!browser || preloadWorker || isPyodideReady) {
			return;
		}

		let worker: Worker;
		const requestId = generateWorkerRequestId();

		try {
			worker = createPythonWorker();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			isPyodideLoading = false;
			isPyodideReady = false;
			console.error('Failed to create Python worker for preload', message);
			return;
		}

		preloadWorker = worker;
		preloadRequestId = requestId;
		isPyodideLoading = true;

		worker.onmessage = (event: MessageEvent<PythonRunnerWorkerMessage>) => {
			const data = event.data;
			if (!data || data.requestId !== preloadRequestId) {
				return;
			}

			switch (data.type) {
				case 'status':
					if (data.status === 'running') {
						isPyodideReady = true;
					}
					break;
				case 'ready':
					isPyodideReady = true;
					isPyodideLoading = false;
					cleanupPreloadWorker();
					break;
				case 'error':
					isPyodideLoading = false;
					isPyodideReady = false;
					console.error('Python runtime preload failed', data.error);
					cleanupPreloadWorker();
					break;
				default:
					break;
			}
		};

		worker.onerror = (event) => {
			isPyodideLoading = false;
			isPyodideReady = false;
			console.error('Python worker failed while preloading.', event?.message);
			cleanupPreloadWorker();
		};

		const message: PythonRunnerRequest = { type: 'preload', requestId };
		worker.postMessage(message);
	}

	function getCurrentSource(): string {
		return monacoEditor?.getValue() ?? rightText ?? '';
	}

	function resetOutputState() {
		stdoutChunks = [];
		stderrChunks = [];
		runtimeMs = null;
	}

	function handleRunClick() {
		if (isRunning) {
			return;
		}
		if (!browser) {
			console.warn('Code execution is only available in the browser runtime.');
			return;
		}
		const source = getCurrentSource();
		resetOutputState();
		if (preloadWorker) {
			cleanupPreloadWorker();
			isPyodideLoading = false;
		}
		runStatus = 'running';
		isRunning = true;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		runStartedAt = now;
		const runId = generateWorkerRequestId();

		let worker: Worker;
		try {
			worker = createPythonWorker();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			stderrChunks = [...stderrChunks, `${message}\n`];
			isRunning = false;
			runStatus = 'error';
			isPyodideLoading = false;
			return;
		}

		activeWorker = worker;
		activeRunId = runId;

		worker.onmessage = (event: MessageEvent<PythonRunnerWorkerMessage>) => {
			if (!event?.data) {
				return;
			}
			handleWorkerMessage(event.data);
		};

		worker.onerror = (event) => {
			const message = event?.message ?? 'Python worker failed with an unknown error.';
			stderrChunks = [...stderrChunks, `${message}\n`];
			finalizeRun('error');
		};

		const message: PythonRunnerRequest = {
			type: 'run',
			requestId: runId,
			code: source,
			stdin: PRESET_STDIN_LINES
		};

		worker.postMessage(message);
	}

	function handleStopClick() {
		if (!isRunning) {
			return;
		}
		if (activeWorker) {
			activeWorker.terminate();
			activeWorker = null;
		}
		isRunning = false;
		runStatus = 'stopped';
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (runStartedAt) {
			runtimeMs = now - runStartedAt;
		}
		runStartedAt = 0;
		activeRunId = null;
		stderrChunks = [...stderrChunks, 'Execution stopped by user.\n'];
	}

	function handleWorkerMessage(message: PythonRunnerWorkerMessage) {
		if (!activeRunId || message.requestId !== activeRunId) {
			return;
		}
		switch (message.type) {
			case 'stdout':
				stdoutChunks = [...stdoutChunks, normalizeOutputChunk(message.text)];
				break;
			case 'stderr':
				stderrChunks = [...stderrChunks, normalizeOutputChunk(message.text)];
				break;
			case 'error': {
				const normalizedError = normalizeOutputChunk(message.error);
				const errorText = normalizedError.endsWith('\n') ? normalizedError : `${normalizedError}\n`;
				stderrChunks = [...stderrChunks, errorText];
				finalizeRun('error');
				break;
			}
			case 'done':
				finalizeRun('completed');
				break;
			case 'status':
				if (message.status === 'running') {
					isPyodideReady = true;
					isPyodideLoading = false;
				}
				break;
			case 'ready':
				isPyodideReady = true;
				isPyodideLoading = false;
				break;
			default:
				break;
		}
	}

	function finalizeRun(outcome: 'completed' | 'error') {
		if (activeWorker) {
			activeWorker.terminate();
			activeWorker = null;
		}
		isRunning = false;
		isPyodideLoading = false;
		if (runStartedAt) {
			const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
			runtimeMs = now - runStartedAt;
		}
		runStartedAt = 0;
		activeRunId = null;
		runStatus = outcome;
	}

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
					monacoEditor.executeEdits(
						'format',
						[
							{
								range: fullRange,
								text: payload.formatted,
								forceMoveMarkers: true
							}
						],
						currentSelections ?? undefined
					);
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
		if (activeWorker) {
			activeWorker.terminate();
			activeWorker = null;
		}
		isRunning = false;
		runStatus = 'idle';
		stdoutChunks = [];
		stderrChunks = [];
		runtimeMs = null;
		activeRunId = null;
		runStartedAt = 0;
	}

	onMount(() => {
		let subscription: IDisposable | null = null;
		let themeObserver: MutationObserver | null = null;
		let mediaQuery: MediaQueryList | null = null;
		let applyTheme: (() => void) | null = null;
		let keybindingDisposables: IDisposable[] = [];

		startPyodidePreload();

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

	onDestroy(() => {
		if (activeWorker) {
			activeWorker.terminate();
			activeWorker = null;
		}
		if (preloadWorker) {
			cleanupPreloadWorker();
		}
		isPyodideLoading = false;
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
													isFormatting || isRunning ? 'pointer-events-none opacity-60' : ''
												),
												disabled: isFormatting || isRunning,
												'aria-disabled': isFormatting || isRunning ? true : undefined,
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
												{@const runButtonDisabled = isPyodideLoading && !isRunning}
												{@const runButtonVisualBusy = isPyodideLoading && !isRunning}
												{@const mergedProps = mergeProps(props ?? {}, {
													type: 'button' as const,
													class: runButtonClasses(isRunning, runButtonVisualBusy),
													'aria-label': runTooltipLabel,
													onclick: isRunning ? handleStopClick : handleRunClick,
													disabled: runButtonDisabled,
													'aria-disabled': runButtonDisabled ? true : undefined,
													'aria-busy': isPyodideLoading ? true : undefined,
													'aria-pressed': isRunning ? true : undefined
												})}
												<button {...mergedProps}>
													<span
														class={cn(
															'flex-1 items-center text-left',
															isPyodideLoading ? 'flex' : 'hidden sm:flex'
														)}>{isPyodideLoading ? 'Loading…' : isRunning ? 'Stop' : 'Run'}</span
													>
													{#if !isPyodideLoading}
														<span class="inline-flex shrink-0 items-center text-muted-foreground">
															{#if isRunning}
																<Square class="size-4" />
															{:else}
																<Play class="size-4" />
															{/if}
														</span>
													{/if}
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
													'aria-label': submitTooltipLabel,
													disabled: isRunning,
													'aria-disabled': isRunning ? true : undefined
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
									<div
										class="editor-shell"
										class:formatting={isFormatting}
										data-code-length={rightText.length}
									>
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
									<div
										class="code-output-shell"
										aria-label="Output panel"
										data-empty={runStatus === 'idle'}
									>
										<div class="output-sections">
											<div class="flex gap-2 pl-2">
												<span class="uppercase">Status:</span>
												<span class="font-mono not-italic">{runStatusLabel}</span>
												<span class="ml-2 uppercase">Runtime:</span>
												<span class="font-mono not-italic">{runtimeLabel}</span>
											</div>
											<div class="output-section">
												<span class="output-section-label">STDIN</span>
												<pre class="output-section-body">{PRESET_STDIN_TEXT}</pre>
											</div>
											<div class="output-section">
												<span class="output-section-label">STDOUT</span>
												<pre class="output-section-body">{stdoutText || '—'}</pre>
											</div>
											<div class="output-section">
												<span class="output-section-label">STDERR</span>
												<pre class="output-section-body">{stderrText || '—'}</pre>
											</div>
										</div>
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
		flex-direction: column;
		gap: 1rem;
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
		padding: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.6rem;
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.85rem;
		color: inherit;
		align-items: stretch;
		overflow: auto;
	}

	.code-output-shell[data-empty] {
		align-items: center;
		justify-content: center;
		overflow: hidden;
		color: hsl(var(--muted-foreground));
		text-align: center;
		font-style: italic;
	}

	.code-output-shell[data-empty] span {
		opacity: 0.8;
	}

	.output-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		font-size: 0.78rem;
		color: hsl(var(--muted-foreground));
		justify-content: flex-start;
		align-items: center;
		text-align: left;
		padding-inline-start: 0.5rem;
	}

	.output-meta-item {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		text-align: left;
	}

	.output-meta-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: hsl(var(--muted-foreground));
	}

	.output-sections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
	}

	.output-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 100%;
	}

	.output-meta-item span {
		display: inline-flex;
		text-align: left;
		justify-content: flex-start;
	}

	.output-section-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: hsl(var(--muted-foreground));
		align-self: flex-start;
		text-align: left;
		padding-inline-start: 0.5rem;
	}

	.output-section-body {
		background: color-mix(in srgb, currentColor 8%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.5rem;
		padding: 0.65rem 0.85rem;
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.82rem;
		line-height: 1.45;
		white-space: pre;
		overflow-x: auto;
		overflow-y: auto;
		max-height: 12rem;
		scrollbar-gutter: stable both-edges;
		width: 100%;
		min-width: 100%;
		text-align: left;
	}

	.code-output-pane {
		display: flex;
		flex: 1 1 auto;
		height: 100%;
		min-height: 0;
	}
</style>
