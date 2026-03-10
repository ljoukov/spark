<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import { getContext } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import { z } from 'zod';
	import {
		collection,
		doc,
		getFirestore,
		limit,
		onSnapshot,
		orderBy,
		query,
		type Unsubscribe
	} from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { Button } from '$lib/components/ui/button/index.js';
	import { renderMarkdown } from '$lib/markdown';
	import { formatRelativeAge } from '$lib/utils/relativeAge';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import {
		SparkAgentRunLogSchema,
		SparkAgentStateSchema,
		SparkAgentWorkspaceFileSchema,
		type SparkAgentRunLog,
		type SparkAgentRunStats,
		type SparkAgentState,
		type SparkAgentWorkspaceFile
	} from '@spark/schemas';

	type AgentLoadState = 'idle' | 'loading' | 'loaded' | 'missing' | 'invalid';
	type ClientUser = { uid: string } | null;
	type RunLogLineView = {
		key: string;
		timestampLabel: string;
		line: string;
	};
	type WorkspaceStorageLink = {
		storagePath: string;
		contentType: string;
	};
	const cloudLogEntrySchema = z.object({
		insertId: z.string().nullable(),
		timestamp: z.string(),
		severity: z.string(),
		source: z.string(),
		logName: z.string(),
		message: z.string(),
		requestUrl: z.string().nullable(),
		httpStatus: z.number().nullable(),
		userId: z.string().nullable(),
		agentId: z.string().nullable(),
		workspaceId: z.string().nullable()
	});
	const cloudLogsResponseSchema = z.object({
		agentId: z.string(),
		workspaceId: z.string(),
		logs: z.array(cloudLogEntrySchema)
	});
	type CloudLogEntry = z.infer<typeof cloudLogEntrySchema>;

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? null);
	const userId = $derived(user?.uid ?? null);
	const runId = $derived($page.params.runId ?? null);

	let agent = $state<SparkAgentState | null>(null);
	let agentLoadState = $state<AgentLoadState>('idle');
	let files = $state<SparkAgentWorkspaceFile[]>([]);
	let runLog = $state<SparkAgentRunLog | null>(null);
	let selectedFilePath = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let copySuccess = $state(false);
	let stopSubmitting = $state(false);
	let stopError = $state<string | null>(null);
	let stopSuccess = $state<string | null>(null);
	let retrySubmitting = $state(false);
	let retryError = $state<string | null>(null);
	let retrySuccess = $state<string | null>(null);
	let downloadSubmitting = $state(false);
	let downloadError = $state<string | null>(null);
	let fileDialogOpen = $state(false);
	let authReady = $state(false);
	let runLogFollow = $state(true);
	let runLogLines = $state<RunLogLineView[]>([]);
	let cloudLogs = $state<CloudLogEntry[]>([]);
	let cloudLogsLoading = $state(false);
	let cloudLogsError = $state<string | null>(null);
	let cloudLogsLoadedAt = $state<Date | null>(null);
	let cloudLogsRequestSeq = 0;
	let expandedCloudLogRows = $state<Record<string, boolean>>({});

	let runLogScrollEl = $state<HTMLDivElement | null>(null);
	let runLogScrollFrame: number | null = null;

	const selectedFile = $derived(
		selectedFilePath ? (files.find((file) => file.path === selectedFilePath) ?? null) : null
	);
	const selectedFileStorageLink = $derived.by(() => {
		if (!selectedFile || selectedFile.type !== 'storage_link') {
			return null;
		}
		return {
			storagePath: selectedFile.storagePath,
			contentType: selectedFile.contentType
		} satisfies WorkspaceStorageLink;
	});
	const selectedFileIsMarkdown = $derived.by(() => {
		const path = selectedFile?.path?.toLowerCase() ?? '';
		return path.endsWith('.md') || path.endsWith('.markdown');
	});
	const selectedFileImageSrc = $derived.by(() => {
		if (!selectedFile) {
			return null;
		}
		if (
			selectedFileStorageLink &&
			selectedFileStorageLink.contentType.toLowerCase().startsWith('image/') &&
			agent?.workspaceId
		) {
			const params = new URLSearchParams({
				workspaceId: agent.workspaceId,
				path: selectedFile.path
			});
			return `/api/spark/agents/workspace-link?${params.toString()}`;
		}
		return null;
	});
	const selectedFileHtml = $derived(
		selectedFileIsMarkdown &&
			selectedFile &&
			selectedFile.type !== 'storage_link' &&
			selectedFile.content
			? renderMarkdown(selectedFile.content)
			: ''
	);
	const promptHtml = $derived.by(() => {
		if (!agent) {
			return '';
		}
		return renderMarkdown(agent.prompt);
	});
	const resultSummaryHtml = $derived.by(() => {
		if (!agent?.resultSummary) {
			return '';
		}
		return renderMarkdown(agent.resultSummary);
	});
	const runStats = $derived<SparkAgentRunStats | null>(runLog?.stats ?? null);
	const runDurationLabel = $derived.by(() => {
		if (!agent) {
			return null;
		}
		return formatDuration(agent.createdAt, agent.updatedAt);
	});
	const showStopButton = $derived.by(() => {
		if (!runId || !agent) {
			return false;
		}
		if (agent.stop_requested) {
			return false;
		}
		return agent.status === 'created' || agent.status === 'executing';
	});
	const showStopRequestedBadge = $derived.by(() => {
		if (!runId || !agent) {
			return false;
		}
		if (agent.status !== 'created' && agent.status !== 'executing') {
			return false;
		}
		return agent.stop_requested === true;
	});
	const canRequestStop = $derived.by(() => showStopButton && !stopSubmitting);
	const showRetryButton = $derived.by(() => {
		if (!runId || !agent) {
			return false;
		}
		return agent.status === 'failed';
	});
	const canRetry = $derived.by(() => showRetryButton && !retrySubmitting);
	const cloudLogsNewestFirst = $derived.by(() =>
		[...cloudLogs].sort((left, right) => right.timestamp.localeCompare(left.timestamp))
	);

	function formatUsd(value: number | undefined): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '—';
		}
		return `$${value.toFixed(4)}`;
	}

	function formatInt(value: number | undefined): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '—';
		}
		return Intl.NumberFormat('en-US').format(Math.floor(value));
	}

	function formatTimestamp(value: Date | undefined): string {
		if (!value) {
			return '—';
		}
		return value.toLocaleString('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function formatDuration(start: Date | undefined, end: Date | undefined): string | null {
		if (!start || !end) {
			return null;
		}
		const durationMs = Math.max(0, end.getTime() - start.getTime());
		const totalSeconds = Math.round(durationMs / 1000);
		if (totalSeconds < 60) {
			return `${totalSeconds}s`;
		}
		if (totalSeconds < 60 * 60) {
			const minutes = Math.floor(totalSeconds / 60);
			const seconds = totalSeconds % 60;
			return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
		}
		if (totalSeconds < 60 * 60 * 24) {
			const hours = Math.floor(totalSeconds / (60 * 60));
			const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
			return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
		}
		const days = Math.floor(totalSeconds / (60 * 60 * 24));
		const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
		return `${days}d ${hours}h`;
	}

	function formatSize(bytes?: number): string {
		if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
			return '—';
		}
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const kb = bytes / 1024;
		if (kb < 1024) {
			return `${kb.toFixed(1)} KB`;
		}
		const mb = kb / 1024;
		return `${mb.toFixed(1)} MB`;
	}

	function formatIsoTimestamp(value: string | null): string {
		if (!value) {
			return '—';
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return formatTimestamp(date);
	}

	function compactLogText(message: string, requestUrl: string | null): string {
		const messageText = message.replace(/\s+/g, ' ').trim();
		if (requestUrl && !messageText.includes(requestUrl)) {
			return `${messageText} ${requestUrl}`.trim();
		}
		return messageText;
	}

	function expandedLogText(message: string, requestUrl: string | null): string {
		const messageText = message.replace(/\r\n/g, '\n').trimEnd();
		if (requestUrl && !messageText.includes(requestUrl)) {
			return messageText.length > 0 ? `${messageText}\n${requestUrl}` : requestUrl;
		}
		return messageText;
	}

	function getCloudLogRowKey(entry: CloudLogEntry, index: number): string {
		return `${entry.insertId ?? entry.timestamp}-${index}`;
	}

	function isMessageExpandable(text: string): boolean {
		return text.length > 100;
	}

	function truncateMessage(text: string): string {
		if (!isMessageExpandable(text)) {
			return text;
		}
		return `${text.slice(0, 100)}…`;
	}

	function toggleCloudLogRow(key: string): void {
		expandedCloudLogRows = {
			...expandedCloudLogRows,
			[key]: !expandedCloudLogRows[key]
		};
	}

	function decodeFileId(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	function toRunLogLineView(
		prev: RunLogLineView[],
		next: SparkAgentRunLog['lines'],
		stream?: SparkAgentRunLog['stream']
	): RunLogLineView[] {
		void stream;
		const expectedLength = next.length;
		if (next.length === 0) {
			return [];
		}

		if (prev.length === expectedLength) {
			let isSame = true;
			for (let idx = 0; idx < next.length; idx += 1) {
				const prevEntry = prev[idx];
				const nextEntry = next[idx];
				if (!prevEntry || prevEntry.key !== nextEntry.key || prevEntry.line !== nextEntry.line) {
					isSame = false;
					break;
				}
			}
			if (isSame) {
				return prev;
			}
		}

		const prevByKey = new Map<string, RunLogLineView>();
		for (const entry of prev) {
			prevByKey.set(entry.key, entry);
		}

		const nextView: RunLogLineView[] = [];
		for (const entry of next) {
			const existing = prevByKey.get(entry.key);
			if (existing && existing.line === entry.line) {
				nextView.push(existing);
				continue;
			}
			nextView.push({
				key: entry.key,
				timestampLabel: formatTimestamp(entry.timestamp),
				line: entry.line
			});
		}
		return nextView;
	}

	function isNearLogBottom(el: HTMLDivElement): boolean {
		const thresholdPx = 24;
		return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
	}

	function handleRunLogScroll(): void {
		const el = runLogScrollEl;
		if (!el) {
			return;
		}
		runLogFollow = isNearLogBottom(el);
	}

	function scheduleScrollRunLogToBottom(): void {
		if (!browser) {
			return;
		}
		const el = runLogScrollEl;
		if (!el) {
			return;
		}
		if (runLogScrollFrame !== null) {
			cancelAnimationFrame(runLogScrollFrame);
		}
		runLogScrollFrame = requestAnimationFrame(() => {
			runLogScrollFrame = null;
			el.scrollTop = el.scrollHeight;
		});
	}

	function parseLogTimestamp(key: string): Date | null {
		const match = /^t(\d{13})_\d+$/.exec(key);
		if (!match) {
			return null;
		}
		const ms = Number.parseInt(match[1] ?? '', 10);
		if (!Number.isFinite(ms)) {
			return null;
		}
		return new Date(ms);
	}

	function parseRunLogDoc(data: Record<string, unknown>): SparkAgentRunLog | null {
		const rawLines = data.lines && typeof data.lines === 'object' ? data.lines : null;
		const entries: Array<{ key: string; timestamp: Date; line: string }> = [];
		if (rawLines && !Array.isArray(rawLines)) {
			for (const [key, value] of Object.entries(rawLines as Record<string, unknown>)) {
				if (typeof value !== 'string') {
					continue;
				}
				const timestamp = parseLogTimestamp(key) ?? null;
				if (!timestamp) {
					continue;
				}
				entries.push({ key, timestamp, line: value });
			}
		}
		entries.sort((a, b) => {
			const diff = a.timestamp.getTime() - b.timestamp.getTime();
			if (diff !== 0) {
				return diff;
			}
			if (a.key < b.key) {
				return -1;
			}
			if (a.key > b.key) {
				return 1;
			}
			return 0;
		});
		const limitedEntries = entries.slice(-2000);
		const payload: Record<string, unknown> = {
			lines: limitedEntries
		};
		if (data.updatedAt !== undefined) {
			payload.updatedAt = data.updatedAt;
		}
		if (data.stats && typeof data.stats === 'object') {
			payload.stats = data.stats;
		}
		if (data.stream && typeof data.stream === 'object') {
			payload.stream = data.stream;
		}
		const parsed = SparkAgentRunLogSchema.safeParse(payload);
		if (!parsed.success) {
			return null;
		}
		return parsed.data;
	}

	async function copyPrompt(text: string): Promise<void> {
		if (!browser) {
			return;
		}
		copySuccess = false;
		try {
			await navigator.clipboard.writeText(text);
			copySuccess = true;
			window.setTimeout(() => {
				copySuccess = false;
			}, 2000);
		} catch (copyError) {
			console.warn('Failed to copy prompt', copyError);
		}
	}

	async function openFileRaw(file: SparkAgentWorkspaceFile): Promise<void> {
		if (!browser) {
			return;
		}
		if (file.type === 'storage_link' && agent?.workspaceId) {
			const params = new URLSearchParams({
				workspaceId: agent.workspaceId,
				path: file.path
			});
			const openedStorageLink = window.open(
				`/api/spark/agents/workspace-link?${params.toString()}`,
				'_blank',
				'noopener,noreferrer'
			);
			if (!openedStorageLink) {
				throw new Error('Popup blocked');
			}
			return;
		}
		if (selectedFileImageSrc && selectedFile?.path === file.path) {
			const openedImage = window.open(selectedFileImageSrc, '_blank', 'noopener,noreferrer');
			if (!openedImage) {
				throw new Error('Popup blocked');
			}
			return;
		}
		const content =
			file.type === 'storage_link' ? '' : typeof file.content === 'string' ? file.content : '';
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const opened = window.open(url, '_blank', 'noopener,noreferrer');
		if (!opened) {
			URL.revokeObjectURL(url);
			throw new Error('Popup blocked');
		}
		window.setTimeout(() => {
			URL.revokeObjectURL(url);
		}, 60_000);
	}

	async function downloadRunZip(): Promise<void> {
		if (!browser || !runId || downloadSubmitting) {
			return;
		}
		downloadSubmitting = true;
		downloadError = null;
		try {
			const response = await fetch(`/api/spark/agents/${encodeURIComponent(runId)}/download`, {
				method: 'GET'
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.error ?? payload?.message ?? 'download_failed');
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `spark-agent-${runId}.zip`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => {
				URL.revokeObjectURL(url);
			}, 60_000);
		} catch (downloadFailure) {
			downloadError =
				downloadFailure instanceof Error
					? downloadFailure.message
					: 'Unable to download zip right now.';
		} finally {
			downloadSubmitting = false;
		}
	}

	async function requestStop(): Promise<void> {
		if (!runId || !canRequestStop) {
			return;
		}
		stopError = null;
		stopSuccess = null;
		stopSubmitting = true;
		try {
			const response = await fetch(`/api/spark/agents/${encodeURIComponent(runId)}/stop`, {
				method: 'POST'
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.error ?? payload?.message ?? 'stop_failed');
			}
			stopSuccess = 'Stop requested.';
			window.setTimeout(() => {
				stopSuccess = null;
			}, 2500);
		} catch (stopFailure) {
			stopError =
				stopFailure instanceof Error ? stopFailure.message : 'Unable to stop this agent right now.';
		} finally {
			stopSubmitting = false;
		}
	}

	async function retryAgent(): Promise<void> {
		if (!runId || !canRetry) {
			return;
		}
		retryError = null;
		retrySuccess = null;
		retrySubmitting = true;
		try {
			const response = await fetch(`/api/spark/agents/${encodeURIComponent(runId)}/retry`, {
				method: 'POST'
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.error ?? payload?.message ?? 'retry_failed');
			}
			const payload = await response.json().catch(() => null);
			if (payload && typeof payload.agentId === 'string' && payload.agentId.trim().length > 0) {
				await goto(`/spark/agents/${encodeURIComponent(payload.agentId)}`);
				return;
			}
			retrySuccess = 'Retry started.';
			window.setTimeout(() => {
				retrySuccess = null;
			}, 2500);
		} catch (retryFailure) {
			retryError =
				retryFailure instanceof Error
					? retryFailure.message
					: 'Unable to retry this agent right now.';
		} finally {
			retrySubmitting = false;
		}
	}

	async function refreshCloudLogs(options: { silent?: boolean } = {}): Promise<void> {
		if (!browser || !runId || !userId || !authReady) {
			return;
		}

		const requestSeq = ++cloudLogsRequestSeq;
		if (!options.silent) {
			cloudLogsLoading = true;
		}
		cloudLogsError = null;

		try {
			const params = new URLSearchParams({
				limit: '120',
				lookbackHours: '48'
			});
			const response = await fetch(
				`/api/spark/agents/${encodeURIComponent(runId)}/cloud-logs?${params.toString()}`,
				{
					method: 'GET'
				}
			);
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.error ?? payload?.message ?? 'cloud_logs_failed');
			}
			const parsed = cloudLogsResponseSchema.parse(await response.json());
			if (requestSeq !== cloudLogsRequestSeq) {
				return;
			}
			cloudLogs = parsed.logs;
			cloudLogsLoadedAt = new Date();
		} catch (cloudLogsFailure) {
			if (requestSeq !== cloudLogsRequestSeq) {
				return;
			}
			cloudLogsError =
				cloudLogsFailure instanceof Error
					? cloudLogsFailure.message
					: 'Unable to load Cloud logs right now.';
		} finally {
			if (requestSeq === cloudLogsRequestSeq) {
				cloudLogsLoading = false;
			}
		}
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		try {
			const auth = getAuth(getFirebaseApp());
			if (auth.currentUser) {
				authReady = true;
				return;
			}
			const stopAuth = onIdTokenChanged(auth, (firebaseUser) => {
				if (!firebaseUser) {
					return;
				}
				authReady = true;
				stopAuth();
			});
		} catch (authError) {
			console.warn('Failed to initialize Spark Agents auth guard', authError);
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !runId || !authReady) {
			agent = null;
			agentLoadState = runId ? 'loading' : 'idle';
			loadError = null;
			return;
		}

		agent = null;
		agentLoadState = 'loading';
		loadError = null;

		let stop: (() => void) | null = null;
		let cancelled = false;
		void import('firebase/firestore')
			.then(({ doc, getFirestore, onSnapshot }) => {
				if (cancelled) {
					return;
				}
				const db = getFirestore(getFirebaseApp());
				const agentRef = doc(db, 'users', userId, 'agents', runId);
				stop = onSnapshot(
					agentRef,
					(snapshot) => {
						if (!snapshot.exists()) {
							agent = null;
							agentLoadState = 'missing';
							loadError = null;
							return;
						}
						const parsed = SparkAgentStateSchema.safeParse({
							id: snapshot.id,
							...snapshot.data()
						});
						if (!parsed.success) {
							console.warn('Invalid Spark Agent payload', parsed.error.flatten());
							agent = null;
							agentLoadState = 'invalid';
							loadError = 'Spark returned an invalid agent payload.';
							return;
						}
						agent = parsed.data;
						agentLoadState = 'loaded';
						loadError = null;
					},
					(snapshotError) => {
						console.warn('Firestore subscription failed', snapshotError);
						agent = null;
						agentLoadState = 'invalid';
						loadError = 'Unable to load Spark Agent details right now.';
					}
				);
			})
			.catch((snapshotError) => {
				if (cancelled) {
					return;
				}
				console.warn('Firestore subscription failed', snapshotError);
				agent = null;
				agentLoadState = 'invalid';
				loadError = 'Unable to load Spark Agent details right now.';
			});
		return () => {
			cancelled = true;
			stop?.();
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !runId || !authReady) {
			cloudLogs = [];
			cloudLogsLoading = false;
			cloudLogsError = null;
			cloudLogsLoadedAt = null;
			return;
		}

		void refreshCloudLogs();
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !runId || !authReady) {
			return;
		}
		if (agent?.status !== 'created' && agent?.status !== 'executing') {
			return;
		}

		const intervalId = window.setInterval(() => {
			void refreshCloudLogs({ silent: true });
		}, 10_000);
		return () => {
			window.clearInterval(intervalId);
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		const workspaceId = agent?.workspaceId ?? null;
		if (!userId || !workspaceId || !authReady) {
			files = [];
			return;
		}
		let stop: (() => void) | null = null;
		let cancelled = false;
		void import('firebase/firestore')
			.then(({ collection, getFirestore, limit, onSnapshot, orderBy, query }) => {
				if (cancelled) {
					return;
				}
				const db = getFirestore(getFirebaseApp());
				const filesRef = collection(db, 'users', userId, 'workspace', workspaceId, 'files');
				const filesQuery = query(filesRef, orderBy('path', 'asc'), limit(200));
				stop = onSnapshot(
					filesQuery,
					(snapshot) => {
						const nextFiles: SparkAgentWorkspaceFile[] = [];
						for (const document of snapshot.docs) {
							const data = document.data();
							const payload = {
								...data,
								path:
									typeof data.path === 'string' && data.path.trim().length > 0
										? data.path.trim()
										: decodeFileId(document.id)
							};
							const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
							if (!parsed.success) {
								continue;
							}
							nextFiles.push(parsed.data);
						}
						files = nextFiles;
					},
					(snapshotError) => {
						console.warn('Firestore subscription failed', snapshotError);
						loadError = 'Unable to load Spark Agent workspace right now.';
					}
				);
			})
			.catch((snapshotError) => {
				if (cancelled) {
					return;
				}
				console.warn('Firestore subscription failed', snapshotError);
				loadError = 'Unable to load Spark Agent workspace right now.';
			});
		return () => {
			cancelled = true;
			stop?.();
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !runId || !authReady) {
			runLog = null;
			runLogLines = [];
			runLogFollow = true;
			return;
		}
		let stop: (() => void) | null = null;
		let cancelled = false;
		void import('firebase/firestore')
			.then(({ doc, getFirestore, onSnapshot }) => {
				if (cancelled) {
					return;
				}
				const db = getFirestore(getFirebaseApp());
				const ref = doc(db, 'users', userId, 'agents', runId, 'logs', 'log');
				stop = onSnapshot(
					ref,
					(snapshot) => {
						if (!snapshot.exists()) {
							runLog = null;
							runLogLines = [];
							return;
						}
						const data = (snapshot.data() ?? {}) as Record<string, unknown>;
						const parsed = parseRunLogDoc(data);
						runLog = parsed;
						runLogLines = toRunLogLineView(runLogLines, parsed?.lines ?? [], parsed?.stream);
					},
					(snapshotError) => {
						console.warn('Firestore subscription failed', snapshotError);
						loadError = 'Unable to load Spark Agent logs right now.';
					}
				);
			})
			.catch((snapshotError) => {
				if (cancelled) {
					return;
				}
				console.warn('Firestore subscription failed', snapshotError);
				loadError = 'Unable to load Spark Agent logs right now.';
			});
		return () => {
			cancelled = true;
			stop?.();
		};
	});

	$effect(() => {
		runId;
		selectedFilePath = null;
		fileDialogOpen = false;
		stopError = null;
		stopSuccess = null;
		retryError = null;
		retrySuccess = null;
		downloadError = null;
		runLog = null;
		runLogLines = [];
		runLogFollow = true;
		cloudLogs = [];
		cloudLogsLoading = false;
		cloudLogsError = null;
		cloudLogsLoadedAt = null;
		expandedCloudLogRows = {};
		files = [];
	});

	let lastRunLogLineCount = 0;
	let lastRunLogFollow = true;
	$effect(() => {
		if (!browser) {
			return;
		}
		const lineCount = runLogLines.length;
		const follow = runLogFollow;
		const shouldScroll =
			follow && (follow !== lastRunLogFollow || lineCount !== lastRunLogLineCount);
		lastRunLogLineCount = lineCount;
		lastRunLogFollow = follow;

		if (!shouldScroll || lineCount === 0) {
			return;
		}

		void tick().then(() => {
			scheduleScrollRunLogToBottom();
		});
	});

	$effect(() => {
		if (selectedFilePath && files.some((file) => file.path === selectedFilePath)) {
			return;
		}
		if (!selectedFilePath || files.length === 0) {
			selectedFilePath = null;
			fileDialogOpen = false;
		}
	});
</script>

<svelte:head>
	<title>Spark · Agent run</title>
</svelte:head>

<section class="agent-run-page">
	<header class="agent-run-header">
		<div>
			<p class="eyebrow">Spark AI Agent</p>
			<h1>{agent ? `Run ${agent.id}` : 'Agent run'}</h1>
			<p class="subtitle">
				Inspect a single autonomous run, including logs, workspace files, and execution state.
			</p>
		</div>
		<div class="run-links">
			<a class="back-link" href="/spark/agents">All runs</a>
			<a class="back-link" href="/spark">Chat</a>
		</div>
	</header>

	{#if loadError}
		<div class="agents-load-error" role="alert">{loadError}</div>
	{/if}

	{#if !runId}
		<div class="state-card">
			<h2>No run selected</h2>
			<p>Choose a run from `/spark/agents` to inspect its workspace and logs.</p>
		</div>
	{:else if !browser || !authReady || !userId || agentLoadState === 'loading' || agentLoadState === 'idle'}
		<div class="state-card">
			<h2>Loading agent run...</h2>
			<p>Pulling the latest run state, logs, and workspace files from Firestore.</p>
		</div>
	{:else if agentLoadState === 'missing'}
		<div class="state-card">
			<h2>Agent run not found</h2>
			<p>This run may have been deleted or belongs to a different account.</p>
		</div>
	{:else if !agent}
		<div class="state-card">
			<h2>Agent run unavailable</h2>
			<p>Spark could not render this run payload.</p>
		</div>
	{:else}
		<div class="agent-run-shell">
			<section class="agents-detail__card">
				<div class="agents-detail__header">
					<div class="agents-detail__header-top">
						<p class="agents-detail__eyebrow">Prompt</p>
						<div class="agents-detail__header-actions">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => {
									const prompt = agent?.prompt;
									if (!prompt) {
										return;
									}
									void copyPrompt(prompt);
								}}
							>
								{copySuccess ? 'Copied' : 'Copy prompt'}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={downloadSubmitting}
								onclick={() => {
									void downloadRunZip();
								}}
							>
								{downloadSubmitting ? 'Downloading…' : 'Download zip'}
							</Button>
							<span class={`status-pill status-pill--${agent.status}`}>
								{agent.status}
							</span>
						</div>
					</div>
					<div class="agents-detail__prompt markdown">
						{@html promptHtml}
					</div>
					{#if showStopButton || showRetryButton || showStopRequestedBadge}
						<div class="agents-detail__header-secondary-actions">
							{#if showStopButton}
								<Button
									variant="destructive"
									size="sm"
									disabled={stopSubmitting}
									onclick={() => {
										void requestStop();
									}}
								>
									{stopSubmitting ? 'Stopping…' : 'Stop'}
								</Button>
							{/if}
							{#if showRetryButton}
								<Button
									variant="secondary"
									size="sm"
									disabled={retrySubmitting}
									onclick={() => {
										void retryAgent();
									}}
								>
									{retrySubmitting ? 'Retrying…' : 'Retry'}
								</Button>
							{/if}
							{#if showStopRequestedBadge}
								<span class="status-pill status-pill--stopped">stop requested</span>
							{/if}
						</div>
					{/if}
				</div>

				<div class="agents-detail__meta">
					<div>
						<span>Agent ID</span>
						<p>{agent.id}</p>
					</div>
					<div>
						<span>Workspace</span>
						<p>{agent.workspaceId}</p>
					</div>
					<div>
						<span>Created</span>
						<p>{formatTimestamp(agent.createdAt)}</p>
					</div>
					<div>
						<span>Updated</span>
						<p>{formatTimestamp(agent.updatedAt)}</p>
					</div>
					<div>
						<span>Duration</span>
						<p>{runDurationLabel ?? '—'}</p>
					</div>
				</div>

				{#if agent.resultSummary}
					<div class="agents-detail__summary">
						<p class="agents-detail__eyebrow">Summary</p>
						<div class="agents-detail__summary-body markdown">
							{@html resultSummaryHtml}
						</div>
					</div>
				{/if}
				{#if agent.error}
					<div class="agents-detail__error">
						<p class="agents-detail__eyebrow">Error</p>
						<p>{agent.error}</p>
					</div>
				{/if}
				{#if stopError}
					<div class="agents-detail__error">
						<p class="agents-detail__eyebrow">Stop request</p>
						<p>{stopError}</p>
					</div>
				{/if}
				{#if stopSuccess}
					<div class="agents-detail__summary">
						<p class="agents-detail__eyebrow">Stop request</p>
						<p>{stopSuccess}</p>
					</div>
				{/if}
				{#if retryError}
					<div class="agents-detail__error">
						<p class="agents-detail__eyebrow">Retry</p>
						<p>{retryError}</p>
					</div>
				{/if}
				{#if retrySuccess}
					<div class="agents-detail__summary">
						<p class="agents-detail__eyebrow">Retry</p>
						<p>{retrySuccess}</p>
					</div>
				{/if}
				{#if downloadError}
					<div class="agents-detail__error">
						<p class="agents-detail__eyebrow">Download</p>
						<p>{downloadError}</p>
					</div>
				{/if}

				<div class="agents-detail__timeline">
					<p class="agents-detail__eyebrow">Timeline</p>
					<ul>
						{#each agent.statesTimeline as entry}
							<li>
								<span class={`status-dot status-dot--${entry.state}`}></span>
								<span>{entry.state}</span>
								<span class="agents-detail__timestamp">{formatTimestamp(entry.timestamp)}</span>
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<div class="agent-run-grid">
				<section class="agents-workspace">
					<div class="agents-workspace__files">
						<h3>Workspace files</h3>
						{#if files.length === 0}
							<p class="agents-empty">No files synced yet.</p>
						{:else}
							<ul>
								{#each files as file}
									<li>
										<button
											class={`file-item ${file.path === selectedFilePath ? 'is-active' : ''}`}
											onclick={() => {
												selectedFilePath = file.path;
												fileDialogOpen = true;
											}}
										>
											<span class="file-item__path">{file.path}</span>
											<span class="file-item__meta">
												<span>{formatSize(file.sizeBytes)}</span>
												<span>{formatRelativeAge(file.updatedAt)}</span>
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</section>

				<section class="agents-run">
					<h3>Run stats</h3>
					{#if runStats}
						<div class="agents-run__stats">
							<div>
								<span class="agents-run__label">Model cost</span>
								<p class="agents-run__value">{formatUsd(runStats.modelCostUsd)}</p>
							</div>
							<div>
								<span class="agents-run__label">Tools cost</span>
								<p class="agents-run__value">{formatUsd(runStats.toolCostUsd)}</p>
							</div>
							<div>
								<span class="agents-run__label">Total cost</span>
								<p class="agents-run__value">{formatUsd(runStats.totalCostUsd)}</p>
							</div>
							<div>
								<span class="agents-run__label">Model calls</span>
								<p class="agents-run__value">{formatInt(runStats.modelCalls)}</p>
							</div>
							<div class="agents-run__wide">
								<span class="agents-run__label">Models</span>
								<p class="agents-run__value">{runStats.modelsUsed.join(', ')}</p>
							</div>
							<div>
								<span class="agents-run__label">Tool calls</span>
								<p class="agents-run__value">{formatInt(runStats.toolCalls)}</p>
							</div>
							<div>
								<span class="agents-run__label">Total tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.totalTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Prompt tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.promptTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Thinking tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.thinkingTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Output tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.responseTokens)}</p>
							</div>
							<div>
								<span class="agents-run__label">Cached tokens</span>
								<p class="agents-run__value">{formatInt(runStats.tokens.cachedTokens)}</p>
							</div>
						</div>
					{:else}
						<p class="agents-empty">Stats will appear once the agent starts running.</p>
					{/if}

					<h3>Run log</h3>
					{#if runLog && runLogLines.length > 0}
						<div
							class="agents-run__log"
							aria-label="Agent run log"
							bind:this={runLogScrollEl}
							onscroll={handleRunLogScroll}
						>
							{#each runLogLines as entry (entry.key)}
								<div class="agents-run__log-line">
									<span class="agents-run__log-ts">{entry.timestampLabel}</span>
									<pre class="agents-run__log-msg">{entry.line}</pre>
								</div>
							{/each}
						</div>
					{:else}
						<p class="agents-empty">No logs yet.</p>
					{/if}

					<div class="agents-run__section-header">
						<h3>Cloud logs</h3>
						<Button
							variant="ghost"
							size="sm"
							disabled={cloudLogsLoading}
							onclick={() => {
								void refreshCloudLogs();
							}}
						>
							{cloudLogsLoading ? 'Refreshing…' : 'Refresh'}
						</Button>
					</div>
					{#if cloudLogsError}
						<div class="agents-detail__error">
							<p class="agents-detail__eyebrow">Cloud logs</p>
							<p>{cloudLogsError}</p>
						</div>
					{:else if cloudLogsNewestFirst.length > 0}
						<div class="agents-run__log" aria-label="Cloud logs">
							<table class="min-w-full w-max border-collapse text-[11px]">
								<thead class="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
									<tr>
										<th class="px-2 py-2 font-medium whitespace-nowrap"></th>
										<th class="px-3 py-2 font-medium whitespace-nowrap">Time</th>
										<th class="px-3 py-2 font-medium whitespace-nowrap">Source</th>
										<th class="px-3 py-2 font-medium whitespace-nowrap">Level</th>
										<th class="px-3 py-2 font-medium">Message</th>
									</tr>
								</thead>
								<tbody>
									{#each cloudLogsNewestFirst as entry, index (getCloudLogRowKey(entry, index))}
										{@const rowKey = getCloudLogRowKey(entry, index)}
										{@const compactMessage = compactLogText(entry.message, entry.requestUrl)}
										{@const fullMessage = expandedLogText(entry.message, entry.requestUrl)}
										{@const expanded = expandedCloudLogRows[rowKey] === true}
										<tr class="border-t border-border/50 align-top">
											<td class="px-2 py-2 whitespace-nowrap text-center">
												<button
													type="button"
													class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
													aria-label={expanded ? 'Collapse log row' : 'Expand log row'}
													aria-expanded={expanded}
													onclick={() => {
														toggleCloudLogRow(rowKey);
													}}
												>
													{#if expanded}
														<ChevronDownIcon class="size-4" />
													{:else}
														<ChevronRightIcon class="size-4" />
													{/if}
												</button>
											</td>
											<td class="px-3 py-2 whitespace-nowrap text-muted-foreground">
												{formatIsoTimestamp(entry.timestamp)}
											</td>
											<td class="px-3 py-2 whitespace-nowrap text-muted-foreground">
												{entry.source}
											</td>
											<td class="px-3 py-2 whitespace-nowrap text-muted-foreground">
												{entry.httpStatus !== null ? `${entry.severity} ${entry.httpStatus}` : entry.severity}
											</td>
											<td class="px-3 py-2 font-mono">
												{#if !expanded}
													<span class="whitespace-nowrap">{truncateMessage(compactMessage)}</span>
												{/if}
											</td>
										</tr>
										{#if expanded}
											<tr class="border-t border-border/30 bg-muted/10 align-top">
												<td class="px-2 py-2"></td>
												<td colspan="4" class="px-3 py-2">
													<pre class="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{fullMessage}</pre>
												</td>
											</tr>
										{/if}
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<p class="agents-empty">No Cloud logs yet.</p>
					{/if}
					{#if cloudLogsLoadedAt}
						<p class="agents-run__caption">Last refreshed {formatTimestamp(cloudLogsLoadedAt)}</p>
					{/if}
				</section>
			</div>
		</div>
	{/if}
</section>

{#if fileDialogOpen && selectedFile}
	<button
		class="file-dialog__backdrop"
		type="button"
		aria-label="Close file dialog"
		onclick={() => {
			fileDialogOpen = false;
		}}
	></button>
	<div class="file-dialog" role="dialog" aria-modal="true">
		<header class="file-dialog__header">
			<div>
				<p class="file-dialog__label">Workspace file</p>
				<h3>{selectedFile.path}</h3>
			</div>
			<div class="file-dialog__actions">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						void openFileRaw(selectedFile);
					}}
				>
					Raw
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						fileDialogOpen = false;
					}}
				>
					×
				</Button>
			</div>
		</header>
		<div class="file-dialog__body">
			{#if selectedFileIsMarkdown}
				<div class="markdown-preview">{@html selectedFileHtml}</div>
			{:else if selectedFileImageSrc}
				<div class="file-image-preview">
					<img src={selectedFileImageSrc} alt={selectedFile.path} loading="lazy" />
				</div>
			{:else if selectedFile.type === 'storage_link'}
				<div class="file-storage-link-preview">
					<p>Binary file stored in Firebase Storage (`storage_link`).</p>
					<p class="file-storage-link-preview__path">{selectedFile.storagePath}</p>
				</div>
			{:else}
				<pre class="file-preview"><code>{selectedFile.content}</code></pre>
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
	.agent-run-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(78rem, 92vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.3rem, 3vw, 2rem);
	}

	.agent-run-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		font-weight: 600;
		color: rgba(59, 130, 246, 0.85);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.45rem, 3vw, 2rem);
	}

	.subtitle {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.run-links {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		padding: 0.42rem 0.7rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		text-decoration: none;
		color: inherit;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		font-weight: 600;
	}

	.state-card,
	.agents-detail__card,
	.agents-workspace,
	.agents-run {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
	}

	.state-card {
		padding: 1rem;
	}

	.state-card h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.state-card p {
		margin: 0.45rem 0 0;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
	}

	.agents-load-error {
		border-radius: 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid rgba(248, 113, 113, 0.35);
		background: rgba(248, 113, 113, 0.12);
		color: rgba(185, 28, 28, 0.92);
		font-size: 0.9rem;
	}

	:global([data-theme='dark'] .agents-load-error),
	:global(:root:not([data-theme='light']) .agents-load-error) {
		background: rgba(248, 113, 113, 0.18);
		color: rgba(254, 226, 226, 0.9);
	}

	.agent-run-shell {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.agent-run-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr);
		gap: 1rem;
	}

	.agents-detail__card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.2rem;
	}

	.agents-workspace,
	.agents-run {
		padding: 1.2rem;
	}

	.agents-detail__header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.agents-detail__header-top {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.agents-detail__header-top .agents-detail__eyebrow {
		margin-right: auto;
	}

	.agents-detail__header-actions {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.agents-detail__header-secondary-actions {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.agents-detail__prompt {
		margin: 0;
		font-size: 1rem;
		line-height: 1.55;
		word-break: break-word;
	}

	.agents-detail__meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.8rem;
		font-size: 0.85rem;
		color: rgba(100, 116, 139, 0.9);
	}

	.agents-detail__meta p {
		margin: 0.15rem 0 0;
		color: inherit;
		font-weight: 600;
		word-break: break-word;
	}

	.agents-detail__eyebrow {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgba(100, 116, 139, 0.7);
	}

	.agents-detail__summary,
	.agents-detail__error,
	.agents-detail__timeline {
		padding: 0.75rem;
		border-radius: 0.9rem;
		background: rgba(148, 163, 184, 0.08);
	}

	.agents-detail__error {
		background: rgba(248, 113, 113, 0.12);
		color: rgba(185, 28, 28, 0.9);
	}

	.agents-detail__summary-body {
		margin-top: 0.45rem;
	}

	.agents-detail__prompt :global(:first-child),
	.agents-detail__summary-body :global(:first-child) {
		margin-top: 0;
	}

	.agents-detail__prompt :global(:last-child),
	.agents-detail__summary-body :global(:last-child) {
		margin-bottom: 0;
	}

	.agents-detail__prompt :global(p),
	.agents-detail__summary-body :global(p) {
		margin: 0 0 0.55rem;
	}

	.agents-detail__prompt :global(ul),
	.agents-detail__prompt :global(ol),
	.agents-detail__summary-body :global(ul),
	.agents-detail__summary-body :global(ol) {
		margin: 0.45rem 0 0.75rem 1.25rem;
		padding: 0;
	}

	.agents-detail__prompt :global(li + li),
	.agents-detail__summary-body :global(li + li) {
		margin-top: 0.3rem;
	}

	.agents-detail__prompt :global(:not(pre) > code),
	.agents-detail__summary-body :global(:not(pre) > code) {
		padding: 0.08rem 0.3rem;
		border-radius: 0.35rem;
		background: rgba(148, 163, 184, 0.18);
		font-size: 0.92em;
	}

	.agents-detail__prompt :global(pre),
	.agents-detail__summary-body :global(pre) {
		margin: 0.55rem 0 0.75rem;
		padding: 0.75rem 0.85rem;
		border-radius: 0.8rem;
		background: rgba(15, 23, 42, 0.92);
		color: rgba(226, 232, 240, 0.96);
		overflow-x: auto;
	}

	.agents-detail__prompt :global(pre code),
	.agents-detail__summary-body :global(pre code) {
		padding: 0;
		background: transparent;
	}

	.agents-detail__timeline ul {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.agents-detail__timeline li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.agents-detail__timestamp {
		margin-left: auto;
		color: rgba(100, 116, 139, 0.7);
		font-size: 0.78rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.status-pill--created {
		background: rgba(148, 163, 184, 0.2);
		color: rgba(71, 85, 105, 0.8);
	}

	.status-pill--executing {
		background: rgba(56, 189, 248, 0.2);
		color: rgba(14, 116, 144, 0.9);
	}

	.status-pill--done {
		background: rgba(34, 197, 94, 0.2);
		color: rgba(21, 128, 61, 0.9);
	}

	.status-pill--stopped {
		background: rgba(245, 158, 11, 0.2);
		color: rgba(180, 83, 9, 0.95);
	}

	.status-pill--failed {
		background: rgba(248, 113, 113, 0.2);
		color: rgba(185, 28, 28, 0.9);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.7);
	}

	.status-dot--executing {
		background: rgba(56, 189, 248, 0.9);
	}

	.status-dot--done {
		background: rgba(34, 197, 94, 0.9);
	}

	.status-dot--stopped {
		background: rgba(245, 158, 11, 0.9);
	}

	.status-dot--failed {
		background: rgba(248, 113, 113, 0.9);
	}

	.agents-workspace__files h3,
	.agents-run h3 {
		margin: 0 0 0.8rem;
		font-size: 1rem;
	}

	.agents-run__section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.agents-run__section-header h3 {
		margin-bottom: 0;
	}

	.agents-workspace__files ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.file-item {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.7rem;
		border-radius: 0.7rem;
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid transparent;
		cursor: pointer;
		font-size: 0.82rem;
		align-items: center;
		text-align: left;
	}

	.file-item__path {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-item__meta {
		display: inline-flex;
		gap: 0.6rem;
		color: rgba(100, 116, 139, 0.8);
		font-size: 0.75rem;
	}

	:global([data-theme='dark'] .file-item__meta),
	:global(:root:not([data-theme='light']) .file-item__meta) {
		color: rgba(226, 232, 240, 0.7);
	}

	.file-item.is-active {
		border-color: rgba(56, 189, 248, 0.6);
		background: rgba(56, 189, 248, 0.12);
	}

	.file-preview {
		white-space: pre-wrap;
		font-family:
			'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.85rem;
	}

	.file-image-preview {
		display: flex;
		justify-content: center;
		align-items: flex-start;
	}

	.file-image-preview img {
		display: block;
		max-width: 100%;
		max-height: min(70vh, 48rem);
		border-radius: 0.6rem;
		border: 1px solid rgba(148, 163, 184, 0.35);
		background: rgba(15, 23, 42, 0.04);
	}

	.file-storage-link-preview {
		display: grid;
		gap: 0.55rem;
		padding: 0.9rem;
		border-radius: 0.75rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		background: rgba(148, 163, 184, 0.08);
	}

	.file-storage-link-preview p {
		margin: 0;
	}

	.file-storage-link-preview__path {
		font-family:
			'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	.markdown-preview :global(p) {
		margin: 0 0 0.85rem;
	}

	.agents-empty {
		margin: 0;
		color: rgba(100, 116, 139, 0.8);
		font-size: 0.9rem;
	}

	.agents-run {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.agents-run__stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.8rem;
		padding: 0.85rem;
		border-radius: 1rem;
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid rgba(148, 163, 184, 0.18);
	}

	.agents-run__label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(100, 116, 139, 0.7);
	}

	.agents-run__value {
		margin: 0.3rem 0 0;
		font-weight: 650;
	}

	.agents-run__wide {
		grid-column: 1 / -1;
	}

	.agents-run__log {
		padding: 0.85rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: rgba(15, 23, 42, 0.04);
		max-height: 28rem;
		overflow: auto;
		font-family:
			'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.82rem;
		line-height: 1.4;
	}

	:global([data-theme='dark'] .agents-run__log),
	:global(:root:not([data-theme='light']) .agents-run__log) {
		background: rgba(15, 23, 42, 0.6);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.agents-run__log-line {
		display: grid;
		grid-template-columns: 10.5rem 1fr;
		gap: 0.75rem;
		padding: 0.15rem 0;
	}

	.agents-run__log-ts {
		color: rgba(100, 116, 139, 0.7);
		font-size: 0.72rem;
	}

	.agents-run__log-msg {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.agents-run__caption {
		margin: 0;
		font-size: 0.75rem;
		color: rgba(100, 116, 139, 0.85);
		word-break: break-word;
	}

	.agents-run__cloud-table {
		display: grid;
		grid-template-columns: minmax(10rem, 10rem) minmax(8rem, 8rem) minmax(9rem, 9rem) minmax(0, 1fr);
		font-size: 0.74rem;
		line-height: 1.25;
	}

	.agents-run__cloud-header,
	.agents-run__cloud-row {
		display: contents;
	}

	.agents-run__cloud-header > span {
		padding: 0 0 0.45rem;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(100, 116, 139, 0.8);
	}

	.agents-run__cloud-row > span {
		padding: 0.35rem 0;
		border-top: 1px solid rgba(148, 163, 184, 0.12);
	}

	.agents-run__cloud-time,
	.agents-run__cloud-level,
	.agents-run__cloud-source {
		padding-right: 0.75rem;
		color: rgba(100, 116, 139, 0.86);
	}

	.agents-run__cloud-source,
	.agents-run__cloud-level {
		text-transform: uppercase;
	}

	.agents-run__cloud-message {
		font-family:
			'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-dialog__backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.6);
		z-index: 50;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.file-dialog {
		position: fixed;
		inset: clamp(1rem, 4vw, 2.5rem);
		background: var(--app-panel-bg, rgba(255, 255, 255, 0.96));
		border-radius: 1.4rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		box-shadow: 0 30px 90px -50px rgba(15, 23, 42, 0.7);
		z-index: 60;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	:global([data-theme='dark'] .file-dialog),
	:global(:root:not([data-theme='light']) .file-dialog) {
		background: rgba(15, 23, 42, 0.95);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.file-dialog__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.2rem;
		border-bottom: 1px solid rgba(148, 163, 184, 0.2);
		gap: 1rem;
	}

	.file-dialog__header h3 {
		margin: 0.2rem 0 0;
		font-size: 1.1rem;
	}

	.file-dialog__label {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(100, 116, 139, 0.7);
	}

	.file-dialog__body {
		padding: 1.2rem;
		overflow: auto;
	}

	.file-dialog__actions {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	@media (max-width: 900px) {
		.agent-run-header {
			flex-direction: column;
		}

		.agent-run-grid {
			grid-template-columns: 1fr;
		}

		.agents-run__log-line {
			grid-template-columns: 1fr;
			gap: 0.15rem;
		}

		.agents-run__cloud-table {
			grid-template-columns: minmax(8.5rem, 8.5rem) minmax(6.5rem, 6.5rem) minmax(7rem, 7rem) minmax(0, 1fr);
			font-size: 0.7rem;
		}
	}
</style>
