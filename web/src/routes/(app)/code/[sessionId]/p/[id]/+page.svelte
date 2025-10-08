<script lang="ts">
	import { browser } from '$app/environment';
	import { goto, beforeNavigate } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { loadMonaco } from '$lib/monaco/index.js';
	import type { Monaco } from '$lib/monaco/index.js';
	import { mergeProps } from 'bits-ui';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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
	import { createSessionStateStore, type SessionUpdateResult } from '$lib/client/sessionState';
	import { DEFAULT_CODE_SOURCE } from '$lib/code/constants';
	import type { PlanItemCodeState, PlanItemState } from '@spark/schemas';

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
	type PersistCodeOptions = {
		keepalive?: boolean;
		force?: boolean;
		runStatus?: PlanItemCodeState['lastRunStatus'] | null;
		runAt?: Date | null;
		markCompleted?: boolean;
	};
	type LocalDraft = {
		source: string;
		savedAt: number;
	};

	const DEFAULT_LAYOUT = [50, 50] as const;
	const CODE_PANE_DEFAULT_LAYOUT = [60, 40] as const;
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
			'flex items-center gap-2 min-w-0 sm:min-w-20',
			isBusy ? 'cursor-wait opacity-60' : ''
		);
	const submitButtonClasses = cn(buttonVariants({ size: 'sm' }), buttonShapeClass);
	const formatTooltipLabel = 'Format code';
	const RUN_TOOLTIP_LABEL = 'Run code';
	const STOP_TOOLTIP_LABEL = 'Stop code execution';
	const LOADING_TOOLTIP_LABEL = 'Python runtime is loading';
	const submitTooltipLabel = 'Submit code';
	const AUTOSAVE_INTERVAL_MS = 10_000;
	const LOCAL_SAVE_INTERVAL_MS = 1_000;
	const LOCAL_STORAGE_PREFIX = 'spark-code:editor';
	const LOCAL_TIMESTAMP_TOLERANCE_MS = 500;
	const SAVE_ERROR_MESSAGE =
		'We could not save your latest code. Check your connection and try again.';
	const SUBMIT_REQUIREMENT_MESSAGE =
		'All tests must pass before submitting. Fix your code and try again.';
	const SUBMIT_GENERIC_ERROR_MESSAGE =
		'We could not submit your solution. Check your connection and try again.';

	function buildLocalStorageKey(userId: string, sessionId: string, planItemId: string): string {
		return `${LOCAL_STORAGE_PREFIX}:${userId}:${sessionId}:${planItemId}`;
	}

	function readLocalDraftFromStorage(key: string): LocalDraft | null {
		if (!browser) {
			return null;
		}
		try {
			const raw = localStorage.getItem(key);
			if (!raw) {
				return null;
			}
			const parsed = JSON.parse(raw) as Partial<LocalDraft>;
			if (typeof parsed.source !== 'string' || typeof parsed.savedAt !== 'number') {
				return null;
			}
			return {
				source: parsed.source,
				savedAt: parsed.savedAt
			};
		} catch (error) {
			console.warn('Failed to read local draft from storage', error);
			return null;
		}
	}

	function writeLocalDraftToStorage(key: string, draft: LocalDraft): void {
		if (!browser) {
			return;
		}
		try {
			localStorage.setItem(key, JSON.stringify(draft));
		} catch (error) {
			console.warn('Failed to write local draft to storage', error);
		}
	}

export let data: PageData;

	let problem = data.problem;
	const sessionStateStore = createSessionStateStore(data.sessionId, data.sessionState);
	let planItemState: PlanItemState | null = data.sessionState.items[data.planItem.id] ?? null;
let hasMarkedStart = false;
let completionRecorded = planItemState?.status === 'completed';
const CODE_LANGUAGE: PlanItemCodeState['language'] = 'python';
const DEFAULT_CODE = DEFAULT_CODE_SOURCE;
const localStorageKey = browser
	? buildLocalStorageKey(data.userId, data.sessionId, data.planItem.id)
	: null;
const initialCodeState: PlanItemCodeState | null = planItemState?.code ?? null;
let rightText = initialCodeState?.source ?? DEFAULT_CODE;
let lastSavedSource = rightText;
let lastSavedAt: Date | null = initialCodeState?.savedAt ?? null;
let lastRunStatus: PlanItemCodeState['lastRunStatus'] | null =
	initialCodeState?.lastRunStatus ?? null;
let lastRunAt: Date | null = initialCodeState?.lastRunAt ?? null;
let hasPendingChanges = false;
let isPersistingCode = false;
let pendingSavePromise: Promise<void> | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let localSaveTimer: ReturnType<typeof setTimeout> | null = null;
let saveError: string | null = null;
let isApplyingRemoteSource = false;
let submitError: string | null = null;
let isSubmitting = false;
let celebrationOpen = false;
let celebrationXpAwarded = 0;
let celebrationStats: SessionUpdateResult['stats'] = null;
let celebrationAlreadyCompleted = false;
let celebrationClosingViaHandler = false;
let celebrationEmoji = '🎉';
let celebrationTitle = 'Brilliant job!';
let celebrationMessage = 'Progress saved - head back to the dashboard for the next challenge.';
let lastLocalSavedAt = 0;
let shouldSyncLocalDraft = false;
let isCodeReadOnly = Boolean(
	planItemState?.status === 'completed' && planItemState.code?.lastRunStatus === 'passed'
);

if (browser && localStorageKey) {
	const remoteSavedAtMs = lastSavedAt ? lastSavedAt.getTime() : 0;
	const localDraft = readLocalDraftFromStorage(localStorageKey);
	if (localDraft) {
		lastLocalSavedAt = localDraft.savedAt;
		const hasLocalSource = localDraft.source.trim().length > 0;
		const localIsNewer =
			localDraft.savedAt > remoteSavedAtMs + LOCAL_TIMESTAMP_TOLERANCE_MS && hasLocalSource;
		if (localIsNewer && localDraft.source !== rightText) {
			rightText = localDraft.source;
			hasPendingChanges = true;
			shouldSyncLocalDraft = true;
		} else if (remoteSavedAtMs > 0) {
			writeLocalDraftToStorage(localStorageKey, {
				source: rightText,
				savedAt: remoteSavedAtMs
			});
			lastLocalSavedAt = remoteSavedAtMs;
		}
	} else {
		const fallbackTimestamp = remoteSavedAtMs || Date.now();
		writeLocalDraftToStorage(localStorageKey, {
			source: rightText,
			savedAt: fallbackTimestamp
		});
		lastLocalSavedAt = fallbackTimestamp;
	}
}

if (isCodeReadOnly) {
	hasPendingChanges = false;
	shouldSyncLocalDraft = false;
}

if (browser && shouldSyncLocalDraft) {
	queueMicrotask(() => {
		void persistCode('local-newer', { force: true }).catch(() => {});
	});
	shouldSyncLocalDraft = false;
}

const stopSessionState = sessionStateStore.subscribe((value) => {
		const nextState = (value.items[data.planItem.id] as PlanItemState | undefined) ?? null;
		planItemState = nextState ?? null;

	if (planItemState?.status === 'completed') {
		completionRecorded = true;
	}

	const nextCode = planItemState?.code ?? null;
	if (!nextCode) {
		return;
	}

	isCodeReadOnly = Boolean(
		planItemState?.status === 'completed' && nextCode.lastRunStatus === 'passed'
	);

	const savedAt = nextCode.savedAt ?? null;
	const sourceChanged = nextCode.source !== lastSavedSource;
		const isNewer =
			!!savedAt && (!lastSavedAt || savedAt.getTime() > lastSavedAt.getTime() + 5);
		const shouldApplyRemote = !hasPendingChanges && sourceChanged && (isNewer || !savedAt);

	if (shouldApplyRemote) {
		lastSavedSource = nextCode.source;
		lastSavedAt = savedAt;
		if (monacoEditor) {
			isApplyingRemoteSource = true;
			monacoEditor.setValue(nextCode.source);
			isApplyingRemoteSource = false;
		}
		rightText = nextCode.source;
		hasPendingChanges = false;
	} else if (isNewer) {
		lastSavedSource = nextCode.source;
		lastSavedAt = savedAt;
	}

	if (isNewer || shouldApplyRemote) {
		saveError = null;

		if (browser && localStorageKey) {
			const savedAtMs = savedAt ? savedAt.getTime() : Date.now();
			writeLocalDraftToStorage(localStorageKey, {
				source: nextCode.source,
				savedAt: savedAtMs
			});
			lastLocalSavedAt = savedAtMs;
		}
	}

	if (nextCode.lastRunStatus) {
		lastRunStatus = nextCode.lastRunStatus;
	}
	if (nextCode.lastRunAt) {
		lastRunAt = nextCode.lastRunAt;
	}
});
	let maximizedPane: PaneSide | null = null;
	let paneGroup: { setLayout: (layout: number[]) => void; getLayout: () => number[] } | null = null;
	let currentProblemId = problem.id;
	let revealedHintCount = 0;
	const difficultyLabels: Record<string, string> = {
		warmup: 'Warm-up',
		intro: 'Intro',
		easy: 'Easy',
		medium: 'Medium',
		hard: 'Hard'
	};
	let editorContainer: HTMLDivElement | null = null;
	type CodeEditor = MonacoEditorNS.IStandaloneCodeEditor;
	let monacoEditor: CodeEditor | null = null;
	let disposeEditor: (() => void) | null = null;
	let isFormatting = false;
	let formatFailed = false;

	let isPyodideLoading = false;
	let isPyodideReady = false;
	let preloadWorker: Worker | null = null;
	let preloadRequestId: string | null = null;
	let isRunning = false;
	let runStatus: 'idle' | 'running' | 'completed' | 'error' | 'stopped' = 'idle';
	let runtimeMs: number | null = null;
	let activeWorker: Worker | null = null;
	let runStartedAt = 0;
	let runTooltipLabel = RUN_TOOLTIP_LABEL;
	type TestRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
	type TestRunResult = {
		index: number;
		label: string;
		input: string;
		expectedOutput: string;
		explanationHtml: string | null;
		status: TestRunStatus;
		stdout: string;
		stderr: string;
		normalizedStdout: string;
		normalizedExpected: string;
		errorMessage: string | null;
		runtimeMs: number | null;
	};
	let testResults: TestRunResult[] = [];
	let selectedTestIndex: number | null = null;
	let selectedResult: TestRunResult | null = null;
	let runErrorMessage: string | null = null;
	$: celebrationEmoji = celebrationAlreadyCompleted ? '🌟' : '🎉';
	$: celebrationTitle = celebrationAlreadyCompleted ? 'Welcome back!' : 'Brilliant job!';
	$: celebrationMessage = celebrationAlreadyCompleted
	? 'Your solution was already synced - hop back to the dashboard for the next challenge.'
	: celebrationXpAwarded > 0
		? `You earned ${celebrationXpAwarded} XP for solving this problem.`
		: 'Progress saved - head back to pick the next challenge.';

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

	function clearAutosaveTimer() {
		if (autosaveTimer) {
			clearTimeout(autosaveTimer);
			autosaveTimer = null;
		}
	}

	function clearLocalSaveTimer() {
		if (localSaveTimer) {
			clearTimeout(localSaveTimer);
			localSaveTimer = null;
		}
	}

	function scheduleLocalSave(source: string) {
		if (!browser || !localStorageKey || isCodeReadOnly) {
			return;
		}
		clearLocalSaveTimer();
		localSaveTimer = setTimeout(() => {
			localSaveTimer = null;
			const savedAtMs = Date.now();
			writeLocalDraftToStorage(localStorageKey, {
				source,
				savedAt: savedAtMs
			});
			lastLocalSavedAt = savedAtMs;
		}, LOCAL_SAVE_INTERVAL_MS);
	}

	function flushLocalDraftImmediate(source?: string) {
		if (!browser || !localStorageKey) {
			return;
		}
		clearLocalSaveTimer();
		const currentSource = source ?? monacoEditor?.getValue() ?? rightText ?? '';
		const savedAtMs = Date.now();
		writeLocalDraftToStorage(localStorageKey, {
			source: currentSource,
			savedAt: savedAtMs
		});
		lastLocalSavedAt = savedAtMs;
	}

	function scheduleAutosave(reason = 'autosave') {
		if (!browser || isCodeReadOnly) {
			return;
		}
		clearAutosaveTimer();
		autosaveTimer = setTimeout(() => {
			autosaveTimer = null;
			void persistCode(reason).catch(() => {});
		}, AUTOSAVE_INTERVAL_MS);
	}

	async function persistCode(reason: string, options?: PersistCodeOptions): Promise<void> {
		if (!browser) {
			return;
		}

		if (isPersistingCode && pendingSavePromise) {
			try {
				await pendingSavePromise;
			} catch {
				// ignore previous failure; continue with new attempt
			}
		}

	const source = monacoEditor?.getValue() ?? rightText ?? '';
	const desiredRunStatus = options?.runStatus ?? null;
	const runStatusChanged =
		desiredRunStatus !== null && desiredRunStatus !== undefined && desiredRunStatus !== lastRunStatus;
	const shouldSkip =
			!options?.force &&
			!hasPendingChanges &&
			source === lastSavedSource &&
			(!runStatusChanged || desiredRunStatus === null || desiredRunStatus === undefined);
	if (shouldSkip) {
		return;
	}

	const now = new Date();
	const runAt = options?.runAt ?? (runStatusChanged ? now : null);
	isPersistingCode = true;
	clearAutosaveTimer();
	if (options?.force) {
		flushLocalDraftImmediate(source);
	}

	const updatePromise = sessionStateStore
		.updateItem(
			data.planItem.id,
				(current) => {
					const nextStatus =
						current.status === 'not_started' && !options?.markCompleted
							? 'in_progress'
							: options?.markCompleted
								? 'completed'
								: current.status;

					let nextCode: PlanItemCodeState = {
						language: current.code?.language ?? CODE_LANGUAGE,
						source,
						savedAt: now
					};

					if (runStatusChanged) {
						nextCode = {
							...nextCode,
							lastRunStatus: desiredRunStatus ?? undefined,
							lastRunAt: runAt ?? now
						};
					} else if (runAt) {
						nextCode = {
							...nextCode,
							lastRunAt: runAt
						};
					}

					const next: PlanItemState = {
						...current,
						status: nextStatus,
						code: nextCode
					};

					if (current.quiz) {
						next.quiz = current.quiz;
					}

					if (!current.startedAt) {
						next.startedAt = now;
					} else if (current.startedAt) {
						next.startedAt = current.startedAt;
					}

					if (options?.markCompleted) {
						next.completedAt = current.completedAt ?? now;
					} else if (current.completedAt) {
						next.completedAt = current.completedAt;
					}

					return next;
				},
				{ keepalive: options?.keepalive }
			)
			.then((result) => {
				lastSavedSource = source;
				lastSavedAt = now;
			hasPendingChanges = false;
			saveError = null;
			if (runStatusChanged) {
				lastRunStatus = desiredRunStatus;
				lastRunAt = runAt ?? now;
			} else if (runAt) {
				lastRunAt = runAt;
			}
			if (options?.markCompleted) {
				completionRecorded = true;
			}
			if (!options?.force) {
				clearLocalSaveTimer();
			}
			flushLocalDraftImmediate(source);
			return result;
		})
			.catch((error) => {
				console.error('Failed to persist code', { reason, error });
				saveError = SAVE_ERROR_MESSAGE;
				throw error;
			})
			.finally(() => {
				isPersistingCode = false;
			});

		const trackedPromise = updatePromise
			.then(() => {})
			.catch(() => {})
			.finally(() => {
				if (pendingSavePromise === trackedPromise) {
					pendingSavePromise = null;
				}
			});
		pendingSavePromise = trackedPromise;

		await updatePromise;
	}

	function handleLocalCodeChange(value: string) {
		if (isCodeReadOnly) {
			return;
		}
		rightText = value;
		if (isApplyingRemoteSource) {
			return;
		}
		const changed = value !== lastSavedSource;
		hasPendingChanges = changed;
		if (changed) {
			scheduleAutosave('edit');
			scheduleLocalSave(value);
		} else {
			clearAutosaveTimer();
			clearLocalSaveTimer();
		}
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
						isPyodideLoading = false;
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

	function splitInputLines(raw: string): string[] {
		if (!raw) {
			return [];
		}
		return raw.split('\n');
	}

	function initializeTestResults(): TestRunResult[] {
		return problem.tests.map((test, index) => ({
			index,
			label: `Test ${index + 1}`,
			input: test.input,
			expectedOutput: test.output,
			explanationHtml: test.explanationHtml ?? null,
			status: 'pending',
			stdout: '',
			stderr: '',
			normalizedStdout: '',
			normalizedExpected: normalizeOutputChunk(test.output).trimEnd(),
			errorMessage: null,
			runtimeMs: null
		}));
	}

	function deriveRunOutcome(results: TestRunResult[]): PlanItemCodeState['lastRunStatus'] | null {
		if (!results || results.length === 0) {
			return null;
		}
		if (results.some((result) => result.status === 'error')) {
			return 'error';
		}
		if (results.some((result) => result.status === 'failed')) {
			return 'failed';
		}
		if (results.every((result) => result.status === 'passed')) {
			return 'passed';
		}
		return null;
	}

	type RunExecutionResult = {
		stdout: string;
		stderr: string;
		errorMessage: string | null;
	};

	type WorkerRunContext = {
		id: string;
		stdoutChunks: string[];
		stderrChunks: string[];
		resolve: (value: RunExecutionResult) => void;
		reject: (reason?: unknown) => void;
	};

	let currentWorkerRun: WorkerRunContext | null = null;
	let stopRequested = false;

	function attachWorker(worker: Worker) {
		worker.onmessage = (event: MessageEvent<PythonRunnerWorkerMessage>) => {
			const data = event.data;
			if (!data) {
				return;
			}

			if (data.type === 'status') {
				if (data.status === 'initializing') {
					isPyodideLoading = true;
				} else if (data.status === 'running') {
					isPyodideLoading = false;
					isPyodideReady = true;
				}
				return;
			}

			if (data.type === 'ready') {
				isPyodideReady = true;
				isPyodideLoading = false;
				return;
			}

			if (!currentWorkerRun || data.requestId !== currentWorkerRun.id) {
				return;
			}

			switch (data.type) {
				case 'stdout':
					currentWorkerRun.stdoutChunks.push(normalizeOutputChunk(data.text));
					break;
				case 'stderr':
					currentWorkerRun.stderrChunks.push(normalizeOutputChunk(data.text));
					break;
				case 'done':
					currentWorkerRun.resolve({
						stdout: currentWorkerRun.stdoutChunks.join(''),
						stderr: currentWorkerRun.stderrChunks.join(''),
						errorMessage: null
					});
					currentWorkerRun = null;
					break;
				case 'error':
					currentWorkerRun.resolve({
						stdout: currentWorkerRun.stdoutChunks.join(''),
						stderr: currentWorkerRun.stderrChunks.join(''),
						errorMessage: data.error ?? 'Execution failed'
					});
					currentWorkerRun = null;
					break;
				default:
					break;
			}
		};

		worker.onerror = (event) => {
			const message = event?.message ?? 'Python worker crashed.';
			if (currentWorkerRun) {
				currentWorkerRun.reject(new Error(message));
				currentWorkerRun = null;
			}
			isPyodideLoading = false;
			isPyodideReady = false;
		};
	}

	function runSingleTest(
		worker: Worker,
		source: string,
		stdinInput: string
	): Promise<RunExecutionResult> {
		return new Promise<RunExecutionResult>((resolve, reject) => {
			if (currentWorkerRun) {
				reject(new Error('A Python run is already in progress.'));
				return;
			}

			const requestId = generateWorkerRequestId();
			currentWorkerRun = {
				id: requestId,
				stdoutChunks: [],
				stderrChunks: [],
				resolve,
				reject
			};

			const message: PythonRunnerRequest = {
				type: 'run',
				requestId,
				code: source,
				stdin: splitInputLines(stdinInput)
			};

			worker.postMessage(message);
		});
	}

	function getStatusLabel(result: TestRunResult): string {
		switch (result.status) {
			case 'passed':
				return 'Passed';
			case 'failed':
				return 'Failed';
			case 'error':
				return 'Error';
			case 'running':
				return 'Running';
			default:
				return 'Pending';
		}
	}

	function getActualOutputDisplay(result: TestRunResult): string {
		if (result.status === 'pending') {
			return '—';
		}
		if (result.status === 'running') {
			return 'Running…';
		}
		if (result.stdout.length === 0) {
			return result.errorMessage ? '' : '∅ (empty)';
		}
		return result.stdout;
	}

	function getChipClasses(result: TestRunResult, isSelected: boolean): string {
		const base = 'rounded-full border px-3 py-1 text-xs font-semibold transition-colors';
		const selected = isSelected ? 'ring-1 ring-primary/100' : '';
		const tone = (() => {
			switch (result.status) {
				case 'passed':
					return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600';
				case 'failed':
					return 'border-destructive/40 bg-destructive/10 text-destructive';
				case 'error':
					return 'border-destructive/60 bg-destructive/15 text-destructive';
				case 'running':
					return 'border-primary/50 bg-primary/10 text-primary';
				default:
					return 'border-muted-foreground/30 bg-muted text-muted-foreground';
			}
		})();
		return cn(base, tone, selected);
	}

	function handleSelectTest(index: number): void {
		selectedTestIndex = index;
	}
	async function runAllTests(source: string): Promise<void> {
		let worker: Worker | null = null;
		stopRequested = false;
		try {
			worker = createPythonWorker();
		} catch (error) {
			runStatus = 'error';
			runErrorMessage = error instanceof Error ? error.message : String(error);
			return;
		}

		activeWorker = worker;
		attachWorker(worker);

		for (const [index, test] of problem.tests.entries()) {
			if (stopRequested) {
				break;
			}

			testResults = testResults.map((result, i) =>
				i === index
					? {
							...result,
							status: 'running',
							stdout: '',
							stderr: '',
							normalizedStdout: '',
							errorMessage: null,
							runtimeMs: null
						}
					: result
			);

			const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

			try {
				const execution = await runSingleTest(worker, source, test.input);
				const duration =
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
				const normalizedStdout = normalizeOutputChunk(execution.stdout).trimEnd();
				const expected = testResults[index]?.normalizedExpected ?? '';
				let status: TestRunStatus;
				if (execution.errorMessage) {
					status = 'error';
				} else if (normalizedStdout === expected) {
					status = 'passed';
				} else {
					status = 'failed';
				}

				testResults = testResults.map((result, i) =>
					i === index
						? {
								...result,
								status,
								stdout: execution.stdout,
								stderr: execution.stderr,
								normalizedStdout,
								errorMessage: execution.errorMessage,
								runtimeMs: duration
							}
						: result
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				testResults = testResults.map((result, i) =>
					i === index
						? {
								...result,
								status: 'error',
								errorMessage: message
							}
						: result
				);
				if (stopRequested) {
					runStatus = 'stopped';
					runErrorMessage = message;
				} else {
					runStatus = 'error';
					runErrorMessage = message;
				}
				break;
			}
		}
		if (worker) {
			worker.terminate();
		}
		activeWorker = null;
		currentWorkerRun = null;
	}

	async function startRun(reason: 'run' | 'submit'): Promise<PlanItemCodeState['lastRunStatus'] | null> {
		if (!browser) {
			console.warn('Code execution is only available in the browser runtime.');
			return null;
		}
		if (isRunning || isCodeReadOnly) {
			return null;
		}

		try {
			await persistCode(`${reason}-pre-run`, { force: true });
		} catch (error) {
			console.warn('Failed to sync code before run', error);
		}

		runErrorMessage = null;
		testResults = initializeTestResults();
		selectedTestIndex = testResults.length > 0 ? 0 : null;

		const source = getCurrentSource();
		if (preloadWorker) {
			cleanupPreloadWorker();
			isPyodideLoading = false;
		}

		runStatus = 'running';
		isRunning = true;
		runStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		runtimeMs = null;

		let sawError = false;

		try {
			await runAllTests(source);
			const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			runtimeMs = finishedAt - runStartedAt;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runStatus = 'error';
			runErrorMessage = message;
			sawError = true;
		} finally {
			isRunning = false;
			isPyodideLoading = false;
		}

		const outcome = deriveRunOutcome(testResults);
		const sawRunError = sawError || outcome === 'error';
		if (!sawRunError) {
			runStatus = stopRequested ? 'stopped' : 'completed';
		} else {
			runStatus = 'error';
		}
		const outcomeStatus: PlanItemCodeState['lastRunStatus'] | null = sawRunError
			? 'error'
			: outcome;

		const runRecordedAt = new Date();
		void persistCode(`${reason}-complete`, {
			force: true,
			runStatus: outcomeStatus ?? undefined,
			runAt: runRecordedAt
		}).catch(() => {});

		return outcomeStatus;
	}

	function handleRunClick() {
		if (isRunning || isSubmitting || isCodeReadOnly) {
			return;
		}
		void startRun('run')
			.then((outcome) => {
				if (outcome === 'passed') {
					submitError = null;
				}
			})
			.catch((error) => {
				console.error('Run failed', error);
			});
	}

	function handleStopClick() {
		if (!isRunning) {
			return;
		}
		stopRequested = true;
		if (currentWorkerRun) {
			currentWorkerRun.reject(new Error('Execution stopped by user.'));
			currentWorkerRun = null;
		}
		if (activeWorker) {
			activeWorker.terminate();
			activeWorker = null;
		}
		testResults = testResults.map((result) =>
			result.status === 'running'
				? { ...result, status: 'error', errorMessage: 'Execution stopped by user.' }
				: result
		);
		isRunning = false;
		isPyodideLoading = false;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (runStartedAt) {
			runtimeMs = now - runStartedAt;
		}
		runStatus = 'stopped';
		runErrorMessage = 'Execution stopped by user.';
		runStartedAt = 0;
	}

	async function handleSubmitClick() {
		if (completionRecorded || isSubmitting || isRunning || isCodeReadOnly) {
			return;
		}

		isSubmitting = true;
		submitError = null;

		try {
			const outcome = await startRun('submit');
			if (outcome !== 'passed') {
				submitError = SUBMIT_REQUIREMENT_MESSAGE;
				return;
			}

			if (pendingSavePromise) {
				try {
					await pendingSavePromise;
				} catch {
					// Ignore autosave failure; submission will attempt again.
				}
			}

			clearAutosaveTimer();

			const submissionAt = new Date();
			const source = getCurrentSource();
			const result = await sessionStateStore.markStatus(
				data.planItem.id,
				'completed',
				{
					completedAt: submissionAt,
					code: {
						language: CODE_LANGUAGE,
						source,
						savedAt: submissionAt,
						lastRunStatus: 'passed',
						lastRunAt: submissionAt
					}
				}
			);

			lastSavedSource = source;
			lastSavedAt = submissionAt;
			lastRunStatus = 'passed';
			lastRunAt = submissionAt;
			hasPendingChanges = false;
			saveError = null;
			clearLocalSaveTimer();
			flushLocalDraftImmediate(source);
			completionRecorded = true;
			celebrationXpAwarded = result?.xpAwarded ?? 0;
			celebrationStats = result?.stats ?? null;
			celebrationAlreadyCompleted = result?.alreadyCompleted ?? false;
			celebrationOpen = true;
		} catch (error) {
			console.error('Submit failed', error);
			submitError = SUBMIT_GENERIC_ERROR_MESSAGE;
		} finally {
			isSubmitting = false;
		}
	}

	function handleCelebrationConfirm() {
		if (celebrationClosingViaHandler) {
			return;
		}
		celebrationClosingViaHandler = true;
		celebrationOpen = false;
		void goto(`/code/${data.sessionId}`).finally(() => {
			celebrationClosingViaHandler = false;
		});
	}

	function handleCelebrationOpenChange(open: boolean) {
		celebrationOpen = open;
		if (!open && !celebrationClosingViaHandler) {
			void goto(`/code/${data.sessionId}`);
		}
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
				credentials: 'same-origin',
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

	function revealNextHint() {
		if (revealedHintCount < problem.hints.length) {
			revealedHintCount += 1;
		}
	}

	$: if (problem !== data.problem) {
		problem = data.problem;
	}

	$: selectedResult = selectedTestIndex === null ? null : (testResults[selectedTestIndex] ?? null);
	$: if (
		selectedTestIndex !== null &&
		(selectedTestIndex < 0 || selectedTestIndex >= testResults.length)
	) {
		selectedTestIndex = testResults.length > 0 ? 0 : null;
		selectedResult = selectedTestIndex === null ? null : (testResults[selectedTestIndex] ?? null);
	}

	$: if (monacoEditor) {
		monacoEditor.updateOptions({ readOnly: isCodeReadOnly });
	}

	$: if (problem.id !== currentProblemId) {
		currentProblemId = problem.id;
		revealedHintCount = 0;
		const resetSource = planItemState?.code?.source ?? DEFAULT_CODE;
		const resetSavedAt = planItemState?.code?.savedAt ?? null;
		const resetRunStatus = planItemState?.code?.lastRunStatus ?? null;
		const resetRunAt = planItemState?.code?.lastRunAt ?? null;
		clearAutosaveTimer();
		clearLocalSaveTimer();
		isApplyingRemoteSource = true;
		rightText = resetSource;
		lastSavedSource = resetSource;
		lastSavedAt = resetSavedAt;
		lastRunStatus = resetRunStatus;
		lastRunAt = resetRunAt;
		hasPendingChanges = false;
		if (monacoEditor && monacoEditor.getValue() !== resetSource) {
			monacoEditor.setValue(resetSource);
		}
		isApplyingRemoteSource = false;
		if (activeWorker) {
			activeWorker.terminate();
			activeWorker = null;
		}
		currentWorkerRun = null;
		isRunning = false;
		isPyodideLoading = false;
		runStatus = 'idle';
		runErrorMessage = null;
		runtimeMs = null;
		runStartedAt = 0;
		stopRequested = false;
		testResults = [];
		selectedTestIndex = null;
		selectedResult = null;
		if (browser && localStorageKey) {
			const savedAtMs = resetSavedAt ? resetSavedAt.getTime() : Date.now();
			writeLocalDraftToStorage(localStorageKey, { source: resetSource, savedAt: savedAtMs });
			lastLocalSavedAt = savedAtMs;
		}
	}

	$: if (planItemState?.status === 'completed' && !completionRecorded) {
		completionRecorded = true;
	}

	onMount(() => {
		let subscription: IDisposable | null = null;
		let themeObserver: MutationObserver | null = null;
		let mediaQuery: MediaQueryList | null = null;
		let applyTheme: (() => void) | null = null;
		let keybindingDisposables: IDisposable[] = [];
		const handleBeforeUnload = () => {
			flushLocalDraftImmediate();
			if (!hasPendingChanges && !isPersistingCode) {
				return;
			}
			void persistCode('beforeunload', { keepalive: true, force: true }).catch(() => {});
		};

		window.addEventListener('beforeunload', handleBeforeUnload);
		beforeNavigate(() => {
			flushLocalDraftImmediate();
			void persistCode('navigate', { force: true }).catch(() => {});
		});

		startPyodidePreload();
		if (!hasMarkedStart) {
			const status = planItemState?.status ?? 'not_started';
			if (status === 'not_started') {
				hasMarkedStart = true;
				void sessionStateStore.markStatus(data.planItem.id, 'in_progress', {
					startedAt: new Date()
				});
			} else {
				hasMarkedStart = true;
			}
		}

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
				language: CODE_LANGUAGE,
				automaticLayout: true,
				readOnly: isCodeReadOnly,
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
				const value = monacoEditor?.getValue() ?? '';
				handleLocalCodeChange(value);
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
			window.removeEventListener('beforeunload', handleBeforeUnload);
			clearLocalSaveTimer();
			flushLocalDraftImmediate();
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
		clearAutosaveTimer();
		clearLocalSaveTimer();
		flushLocalDraftImmediate();
		if (hasPendingChanges || isPersistingCode) {
			void persistCode('destroy', { keepalive: true, force: true }).catch(() => {});
		}
		stopSessionState();
		sessionStateStore.stop();
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
							class="problem-scroll min-h-0 flex-1 overflow-y-auto rounded-md border border-input bg-background p-3 text-sm shadow-sm"
							aria-label="Problem description"
						>
							<div class="space-y-6">
								<section class="space-y-3">
									<div
										class="flex flex-wrap items-center gap-2 text-[0.7rem] font-medium tracking-wide uppercase"
									>
										<span class="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
											{difficultyLabels[problem.difficulty] ?? problem.difficulty}
										</span>
										{#each problem.topics as topic}
											<span class="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
												>{topic}</span
											>
										{/each}
									</div>
									<div class="markdown space-y-3 text-sm">{@html problem.descriptionHtml}</div>
								</section>
								<section class="space-y-2">
									<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Input Format
									</h3>
									<div class="markdown space-y-2 text-sm">{@html problem.inputFormatHtml}</div>
								</section>
								<section class="space-y-2">
									<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Constraints
									</h3>
									<ul class="list-disc space-y-1 pl-4 text-sm">
										{#each problem.constraints as constraint}
											<li>{constraint}</li>
										{/each}
									</ul>
								</section>
								<section class="space-y-3">
									<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										Examples
									</h3>
									<div class="space-y-3">
										{#each problem.examples as example}
											<div class="space-y-2 rounded-md border border-input bg-muted/100 p-3">
												<div class="text-sm font-semibold">{example.title}</div>
												<div>
													<div class="text-xs font-medium text-muted-foreground uppercase">
														Input
													</div>
													<pre
														class="rounded bg-background/80 p-2 font-mono text-xs leading-snug whitespace-pre-wrap">
{example.input}</pre>
												</div>
												<div>
													<div class="text-xs font-medium text-muted-foreground uppercase">
														Output
													</div>
													<pre
														class="rounded bg-background/80 p-2 font-mono text-xs leading-snug whitespace-pre-wrap">
{example.output}</pre>
												</div>
												<div class="markdown space-y-2 text-xs text-muted-foreground">
													{@html example.explanationHtml}
												</div>
											</div>
										{/each}
									</div>
								</section>
								<section class="space-y-3">
									<div class="flex items-center justify-between gap-2">
										<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
											Hints
										</h3>
										{#if revealedHintCount < problem.hints.length}
											<button
												type="button"
												class={cn(buttonVariants({ size: 'sm' }), buttonShapeClass)}
												onclick={revealNextHint}
											>
												Reveal hint {revealedHintCount + 1}
											</button>
										{/if}
									</div>
									<ol class="space-y-2 text-sm">
										{#each problem.hintsHtml as hintHtml, index}
											<li class="pl-1">
												{#if index < revealedHintCount}
													<div class="markdown space-y-2 text-sm">{@html hintHtml}</div>
												{:else}
													<span class="text-xs text-muted-foreground italic">Locked</span>
												{/if}
											</li>
										{/each}
									</ol>
								</section>
							</div>
						</div>
					</div>
				</Resizable.Pane>
				<Resizable.Handle withHandle class="bg-border" />
				<Resizable.Pane class="min-h-0" defaultSize={DEFAULT_LAYOUT[1]} minSize={0}>
					<div class="pane-column flex h-full min-h-0 w-full flex-1 flex-col gap-2 p-2">
						<div class="flex items-center justify-between gap-2 pl-2">
							<div
								class="flex min-w-0 flex-1 items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
							>
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											{@const mergedProps = mergeProps(props ?? {}, {
												type: 'button' as const,
												class: cn(
													formatButtonClasses(formatFailed),
													isFormatting || isRunning || isCodeReadOnly
														? 'pointer-events-none opacity-60'
														: ''
												),
												disabled: isFormatting || isRunning || isCodeReadOnly,
												'aria-disabled':
													isFormatting || isRunning || isCodeReadOnly ? true : undefined,
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
								<div class="ml-2 flex items-center gap-2 sm:ml-4">
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												{@const runButtonDisabled =
													(isPyodideLoading && !isRunning) || isSubmitting || isCodeReadOnly}
												{@const runButtonVisualBusy = isPyodideLoading && !isRunning}
												{@const mergedProps = mergeProps(props ?? {}, {
													type: 'button' as const,
													class: runButtonClasses(isRunning, runButtonVisualBusy),
													'aria-label': runTooltipLabel,
													onclick: isRunning ? handleStopClick : handleRunClick,
													disabled: runButtonDisabled,
													'aria-disabled': runButtonDisabled ? true : undefined,
													'aria-busy': isPyodideLoading || isRunning ? true : undefined,
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
													'aria-label': isSubmitting ? 'Submitting code' : submitTooltipLabel,
													disabled:
														isRunning || completionRecorded || isSubmitting || isCodeReadOnly,
													'aria-disabled':
														isRunning || completionRecorded || isSubmitting || isCodeReadOnly
															? true
															: undefined,
													onclick: handleSubmitClick,
													'aria-busy': isSubmitting ? true : undefined,
													'aria-pressed': completionRecorded ? true : undefined
												})}
												<button {...mergedProps}>
													<span class={isSubmitting ? 'inline' : 'hidden sm:inline'}>
														{isSubmitting ? 'Submitting…' : 'Submit'}
													</span>
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
									<div class="code-output-shell" aria-label="Output panel">
										<div class="output-sections space-y-3">
											<div
												class="flex flex-wrap items-center gap-2 pl-2 text-xs text-muted-foreground uppercase"
											>
												<span>Status:</span>
												<span class="font-mono text-base text-foreground normal-case"
													>{runStatusLabel}</span
												>
												<span class="ml-3">Runtime:</span>
												<span class="font-mono text-base text-foreground normal-case"
													>{runtimeLabel}</span
												>
											</div>
											{#if runErrorMessage && runStatus === 'error'}
												<div
													class="ml-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
												>
													{runErrorMessage}
												</div>
											{/if}
											{#if saveError}
												<div
													class="ml-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
												>
													{saveError}
												</div>
											{/if}
											{#if submitError}
												<div
													class="ml-2 rounded-md border border-amber-300/50 bg-amber-200/30 px-3 py-2 text-xs text-amber-900 dark:border-amber-200/40 dark:bg-amber-500/20 dark:text-amber-100"
												>
													{submitError}
												</div>
											{/if}
											<div class="ml-2 flex flex-wrap gap-2">
												{#if testResults.length === 0}
													<span class="text-xs text-muted-foreground"
														>Run your code to see each test result.</span
													>
												{:else}
													{#each testResults as result, idx}
														<button
															type="button"
															class={getChipClasses(result, selectedTestIndex === idx)}
															onclick={() => handleSelectTest(idx)}
														>
															{result.label}{result.status === 'error' ? ' 💥' : ''}
														</button>
													{/each}
												{/if}
											</div>
											{#if selectedResult}
												<div
													class="ml-2 space-y-3 rounded-md border border-input bg-background/80 p-3 text-sm"
												>
													<div
														class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground uppercase"
													>
														<span
															>Status: <span
																class="ml-1 font-mono text-base text-foreground normal-case"
																>{getStatusLabel(selectedResult)}</span
															></span
														>
														<span
															>Runtime: <span
																class="ml-1 font-mono text-base text-foreground normal-case"
																>{formatRuntime(selectedResult.runtimeMs)}</span
															></span
														>
													</div>
													<div>
														<h4 class="text-xs font-semibold text-muted-foreground uppercase">
															Input
														</h4>
														<pre
															class="mt-1 rounded bg-muted/30 p-2 font-mono text-xs leading-snug whitespace-pre-wrap">{selectedResult.input ||
																'—'}</pre>
													</div>
													<div class="grid gap-3 md:grid-cols-2">
														<div>
															<h4 class="text-xs font-semibold text-muted-foreground uppercase">
																Expected Output
															</h4>
															<pre
																class="mt-1 rounded bg-muted/100 p-2 font-mono text-xs leading-snug whitespace-pre-wrap">{selectedResult.expectedOutput ||
																	'—'}</pre>
														</div>
														<div>
															<h4 class="text-xs font-semibold text-muted-foreground uppercase">
																Actual Output
															</h4>
															<pre
																class={cn(
																	'mt-1 rounded p-2 font-mono text-xs leading-snug whitespace-pre-wrap',
																	selectedResult.status === 'passed'
																		? 'bg-emerald-500/10 text-emerald-600'
																		: selectedResult.status === 'failed'
																			? 'bg-destructive/10 text-destructive'
																			: 'bg-muted/30 text-foreground'
																)}>{getActualOutputDisplay(selectedResult)}</pre>
														</div>
													</div>
													{#if selectedResult.stderr}
														<div>
															<h4 class="text-xs font-semibold text-muted-foreground uppercase">
																Stderr
															</h4>
															<pre
																class="mt-1 rounded bg-destructive/10 p-2 font-mono text-xs leading-snug whitespace-pre-wrap text-destructive">
{selectedResult.stderr}</pre>
														</div>
													{:else if selectedResult.errorMessage}
														<div class="rounded bg-destructive/10 p-2 text-xs text-destructive">
															{selectedResult.errorMessage}
														</div>
													{/if}
													{#if selectedResult.explanationHtml}
														<div class="markdown space-y-2 text-xs text-muted-foreground">
															{@html selectedResult.explanationHtml}
														</div>
													{/if}
												</div>
											{:else if testResults.length === 0}
												<div
													class="ml-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/10 p-4 text-xs text-muted-foreground"
												>
													Run your code to evaluate all tests.
												</div>
											{/if}
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

<Dialog.Root open={celebrationOpen} onOpenChange={handleCelebrationOpenChange}>
	<Dialog.Content
		class="celebration-dialog max-w-md rounded-3xl border border-border/70 bg-background/95 p-8 text-center shadow-[0_30px_60px_rgba(15,23,42,0.25)] dark:border-border/40 dark:bg-background/98 dark:shadow-[0_30px_60px_rgba(2,6,23,0.55)]"
		hideClose
	>
		<div class="celebration-body space-y-5">
			<div class="celebration-emoji text-5xl" aria-hidden="true">{celebrationEmoji}</div>
			<h2 class="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
				{celebrationTitle}
			</h2>
			<p class="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground md:text-base">
				{celebrationMessage}
			</p>
			<div class="flex flex-col items-center gap-2 font-medium text-muted-foreground">
				{#if celebrationXpAwarded > 0}
					<span class="celebration-xp-pill">
						+{celebrationXpAwarded.toLocaleString()} XP
					</span>
				{:else}
					<span class="celebration-xp-pill celebration-xp-pill--muted">Progress saved</span>
				{/if}
				{#if celebrationStats}
					<span class="text-xs text-muted-foreground/70">
						Total XP: {celebrationStats.xp.toLocaleString()}
					</span>
				{/if}
			</div>
			<Button class="celebration-ok w-full sm:w-auto" onclick={handleCelebrationConfirm}>
				OK
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

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
		min-height: 0;
		width: 100%;
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

	.celebration-body {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.celebration-emoji {
		filter: drop-shadow(0 18px 28px rgba(250, 204, 21, 0.35));
	}

	.celebration-xp-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.45rem 1.2rem;
		border-radius: 9999px;
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.08));
		color: #047857;
		font-size: 0.85rem;
	}

	:global([data-theme='dark'] .celebration-xp-pill) {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.35), rgba(34, 197, 94, 0.18));
		color: #bbf7d0;
	}

	.celebration-xp-pill--muted {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(59, 130, 246, 0.08));
		color: #1d4ed8;
	}

	:global([data-theme='dark'] .celebration-xp-pill--muted) {
		background: linear-gradient(135deg, rgba(96, 165, 250, 0.3), rgba(59, 130, 246, 0.16));
		color: #bfdbfe;
	}

	:global(.celebration-ok) {
		min-width: 8rem;
		font-weight: 600;
	}
</style>
