import { clearInterval, setInterval } from 'node:timers';

const SPEED_WINDOW_MS = 10_000;
const ANSI_RESET = '\u001b[0m';
const ANSI_GRAY = '\u001b[90m';
const ANSI_RED = '\u001b[31m';

export type StatusMode = 'interactive' | 'plain' | 'off';

export type ModelCallHandle = symbol;

export type ModelUsageDelta = {
	readonly promptTokensDelta: number;
	readonly inferenceTokensDelta: number;
	readonly timestamp: number;
};

export type JobProgressReporter = {
	reportChars(delta: number): void;
	log(message: string): void;
	startModelCall(details: { modelId: string; uploadBytes: number }): ModelCallHandle;
	recordModelUsage(handle: ModelCallHandle, delta: ModelUsageDelta): void;
	finishModelCall(handle: ModelCallHandle): void;
};

export type JobContext = {
	readonly index: number;
	readonly progress: JobProgressReporter;
};

export type JobRunnerOptions<I, O> = {
	readonly items: readonly I[];
	readonly concurrency: number;
	readonly getId: (item: I, index: number) => string;
	readonly handler: (item: I, context: JobContext) => Promise<O>;
	readonly updateIntervalMs?: number;
	readonly label?: string;
	readonly statusMode?: StatusMode;
	readonly output?: NodeJS.WriteStream;
};

type PerModelMetrics = {
	promptTokens: number;
	inferenceTokens: number;
};

type MetricsSnapshot = {
	readonly totalChars: number;
	readonly totalUploadBytes: number;
	readonly activeCalls: number;
	readonly totalPromptTokens: number;
	readonly totalInferenceTokens: number;
	readonly promptTokensPerSecond: number;
	readonly inferenceTokensPerSecond: number;
	readonly perModel: Array<{
		readonly modelId: string;
		readonly promptTokens: number;
		readonly inferenceTokens: number;
	}>;
};

class MetricsTracker {
	private totalChars = 0;
	private totalUploadBytes = 0;
	private activeCalls = 0;
	private totalPromptTokens = 0;
	private totalInferenceTokens = 0;
	private readonly perModel = new Map<string, PerModelMetrics>();
	private readonly callInfo = new Map<ModelCallHandle, { readonly modelId: string }>();
	private readonly usageWindow: Array<{
		timestamp: number;
		promptTokens: number;
		inferenceTokens: number;
	}> = [];

	reportChars(delta: number): void {
		if (delta <= 0) {
			return;
		}
		this.totalChars += delta;
	}

	startCall(modelId: string, uploadBytes: number): ModelCallHandle {
		const handle: ModelCallHandle = Symbol('model-call');
		this.callInfo.set(handle, { modelId });
		this.activeCalls += 1;
		if (uploadBytes > 0) {
			this.totalUploadBytes += uploadBytes;
		}
		return handle;
	}

	recordUsage(handle: ModelCallHandle, delta: ModelUsageDelta): void {
		const info = this.callInfo.get(handle);
		if (!info) {
			return;
		}
		let promptDelta = 0;
		let inferenceDelta = 0;
		if (delta.promptTokensDelta > 0) {
			this.totalPromptTokens += delta.promptTokensDelta;
			const metrics = this.perModel.get(info.modelId) ?? {
				promptTokens: 0,
				inferenceTokens: 0
			};
			metrics.promptTokens += delta.promptTokensDelta;
			this.perModel.set(info.modelId, metrics);
			promptDelta = delta.promptTokensDelta;
		}
		if (delta.inferenceTokensDelta > 0) {
			this.totalInferenceTokens += delta.inferenceTokensDelta;
			const metrics = this.perModel.get(info.modelId) ?? {
				promptTokens: 0,
				inferenceTokens: 0
			};
			metrics.inferenceTokens += delta.inferenceTokensDelta;
			this.perModel.set(info.modelId, metrics);
			inferenceDelta = delta.inferenceTokensDelta;
		}
		if (promptDelta > 0 || inferenceDelta > 0) {
			this.usageWindow.push({
				timestamp: delta.timestamp,
				promptTokens: promptDelta,
				inferenceTokens: inferenceDelta
			});
		}
	}

	finishCall(handle: ModelCallHandle): void {
		if (this.callInfo.delete(handle)) {
			this.activeCalls = Math.max(0, this.activeCalls - 1);
		}
	}

	getSnapshot(): MetricsSnapshot {
		const now = Date.now();
		while (this.usageWindow.length > 0 && this.usageWindow[0].timestamp <= now - SPEED_WINDOW_MS) {
			this.usageWindow.shift();
		}
		let promptWindowTokens = 0;
		let inferenceWindowTokens = 0;
		for (const entry of this.usageWindow) {
			promptWindowTokens += entry.promptTokens;
			inferenceWindowTokens += entry.inferenceTokens;
		}
		const windowStart = this.usageWindow.length > 0 ? this.usageWindow[0].timestamp : now;
		const elapsedSeconds = Math.max((now - windowStart) / 1000, 1);
		const promptSpeed = promptWindowTokens / elapsedSeconds;
		const inferenceSpeed = inferenceWindowTokens / elapsedSeconds;
		const perModel = Array.from(this.perModel.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([modelId, metrics]) => ({
				modelId,
				promptTokens: metrics.promptTokens,
				inferenceTokens: metrics.inferenceTokens
			}));
		return {
			totalChars: this.totalChars,
			totalUploadBytes: this.totalUploadBytes,
			activeCalls: this.activeCalls,
			totalPromptTokens: this.totalPromptTokens,
			totalInferenceTokens: this.totalInferenceTokens,
			promptTokensPerSecond: promptSpeed,
			inferenceTokensPerSecond: inferenceSpeed,
			perModel
		};
	}
}

class ProgressDisplay {
	private readonly totalJobs: number;
	private readonly label: string;
	private readonly updateIntervalMs: number;
	private readonly metrics = new MetricsTracker();
	private lastRenderedLength = 0;
	private completedJobs = 0;
	private runningJobs = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private dirty = false;
	private readonly mode: StatusMode;
	private readonly output: NodeJS.WriteStream;
	private readonly useColor: boolean;
	private readonly labelDisplay: string;
	private lastRenderTime = 0;

	constructor(
		totalJobs: number,
		label: string,
		updateIntervalMs: number,
		{ mode, output }: { mode: StatusMode; output: NodeJS.WriteStream }
	) {
		this.totalJobs = totalJobs;
		this.label = label;
		this.updateIntervalMs = updateIntervalMs;
		this.mode = mode;
		this.output = output;
		this.useColor = Boolean(output.isTTY) && mode === 'interactive';
		this.labelDisplay = this.useColor ? `\u001b[36m${label}\u001b[0m` : label;
	}

	start(): void {
		if (this.mode === 'off' || this.totalJobs === 0) {
			return;
		}
		this.render(true);
		this.timer = setInterval(() => {
			this.render();
		}, this.updateIntervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (this.mode === 'off') {
			return;
		}
		this.render(true);
		if (this.totalJobs > 0 && this.mode === 'interactive') {
			this.output.write('\n');
		}
	}

	jobStarted(): void {
		if (this.mode === 'off') {
			return;
		}
		this.runningJobs += 1;
		this.dirty = true;
		this.render(this.mode === 'interactive');
	}

	jobCompleted(): void {
		if (this.mode === 'off') {
			return;
		}
		if (this.runningJobs > 0) {
			this.runningJobs -= 1;
		}
		this.completedJobs += 1;
		this.dirty = true;
		this.render(this.mode === 'interactive');
	}

	reportChars(delta: number): void {
		if (this.mode === 'off') {
			return;
		}
		this.metrics.reportChars(delta);
		this.dirty = true;
	}

	startModelCall(modelId: string, uploadBytes: number): ModelCallHandle {
		if (this.mode === 'off') {
			return Symbol('model-call');
		}
		this.dirty = true;
		return this.metrics.startCall(modelId, uploadBytes);
	}

	recordModelUsage(handle: ModelCallHandle, delta: ModelUsageDelta): void {
		if (this.mode === 'off') {
			return;
		}
		this.metrics.recordUsage(handle, delta);
		this.dirty = true;
	}

	finishModelCall(handle: ModelCallHandle): void {
		if (this.mode === 'off') {
			return;
		}
		this.metrics.finishCall(handle);
		this.dirty = true;
	}

	log(message: string): void {
		if (this.mode === 'off') {
			console.log(message);
			return;
		}
		const formattedLines = this.formatLogLines(message);
		if (formattedLines.length === 0) {
			return;
		}
		if (this.mode === 'interactive') {
			this.clearLine();
			for (const line of formattedLines) {
				this.output.write(`${line}\n`);
			}
			this.dirty = true;
			this.render(true);
			return;
		}
		for (const line of formattedLines) {
			this.output.write(`${line}\n`);
		}
		this.dirty = true;
	}

	createReporter(): JobProgressReporter {
		if (this.mode === 'off') {
			return {
				reportChars: () => {},
				log: (message) => {
					console.log(message);
				},
				startModelCall: () => Symbol('model-call'),
				recordModelUsage: () => {},
				finishModelCall: () => {}
			};
		}
		return {
			reportChars: (delta) => {
				this.reportChars(delta);
			},
			log: (message) => {
				this.log(message);
			},
			startModelCall: ({ modelId, uploadBytes }) => this.startModelCall(modelId, uploadBytes),
			recordModelUsage: (handle, delta) => {
				this.recordModelUsage(handle, delta);
			},
			finishModelCall: (handle) => {
				this.finishModelCall(handle);
			}
		};
	}

	private render(force = false): void {
		if (this.mode === 'off') {
			return;
		}
		if (!force && !this.dirty) {
			return;
		}
		this.dirty = false;
		if (this.totalJobs === 0) {
			return;
		}
		const now = Date.now();
		if (this.mode === 'plain' && !force && now - this.lastRenderTime < this.updateIntervalMs) {
			return;
		}
		const rawPercent = (this.completedJobs / this.totalJobs) * 100;
		const percent = this.completedJobs >= this.totalJobs ? 100 : Math.round(rawPercent);
		const waitingJobs = Math.max(this.totalJobs - this.completedJobs - this.runningJobs, 0);
		const metrics = this.metrics.getSnapshot();
		const promptSpeedDisplay = formatNumber(Math.round(metrics.promptTokensPerSecond));
		const inferenceSpeedDisplay = formatNumber(Math.round(metrics.inferenceTokensPerSecond));
		const line =
			`${this.labelDisplay} ${percent}% | ${this.completedJobs} / ${this.totalJobs}` +
			` | ${waitingJobs} waiting` +
			` | up ${formatBytes(metrics.totalUploadBytes)}` +
			` | speed P ${promptSpeedDisplay}/s I ${inferenceSpeedDisplay}/s` +
			` | ${formatPerModel(metrics.perModel)}`;
		this.writeLine(line);
		this.lastRenderTime = now;
	}

	private formatLogLines(message: string): string[] {
		const lines = message.replace(/\r\n?/g, '\n').split('\n');
		if (lines.length === 0) {
			return [];
		}
		const timestamp = this.formatTimestamp(new Date());
		const [firstLine, ...rest] = lines;
		const formatted: string[] = [];
		formatted.push(this.formatPrimaryLogLine(firstLine ?? '', timestamp));
		for (const line of rest) {
			formatted.push(this.formatContinuationLine(line ?? '', timestamp));
		}
		return formatted;
	}

	private formatPrimaryLogLine(line: string, timestamp: string): string {
		const errorMarker = 'ERROR ';
		const markerIndex = line.indexOf(errorMarker);
		const hasError =
			markerIndex >= 0 &&
			(markerIndex === 0 || line[markerIndex - 1] === ' ' || line[markerIndex - 1] === ']');
		const basePrefix = this.useColor ? `${ANSI_GRAY}[${timestamp}]${ANSI_RESET}` : `[${timestamp}]`;
		if (hasError) {
			const context = line.slice(0, markerIndex).trim();
			const errorText = line.slice(markerIndex + errorMarker.length).trimStart();
			const contextDisplay = context.length > 0 ? `${context} ` : '';
			const errorLabel = this.useColor ? `${ANSI_RED}Error:${ANSI_RESET}` : 'Error:';
			return `${basePrefix} ${errorLabel} ${contextDisplay}${errorText}`;
		}
		return `${basePrefix} ${line}`;
	}

	private formatContinuationLine(line: string, timestamp: string): string {
		const basePrefix = this.useColor ? `${ANSI_GRAY}[${timestamp}]${ANSI_RESET}` : `[${timestamp}]`;
		const continuation = line.length > 0 ? line : '';
		return `${basePrefix}   ${continuation}`;
	}

	private formatTimestamp(date: Date): string {
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		return `${hours}:${minutes}`;
	}

	private writeLine(line: string): void {
		if (this.mode === 'interactive') {
			const padded = line.padEnd(this.lastRenderedLength, ' ');
			this.output.write(`\r${padded}`);
			this.lastRenderedLength = Math.max(this.lastRenderedLength, line.length);
			return;
		}
		this.output.write(`${line}\n`);
		this.lastRenderedLength = 0;
	}

	private clearLine(): void {
		if (this.mode !== 'interactive' || this.lastRenderedLength === 0) {
			return;
		}
		this.output.write(`\r${' '.repeat(this.lastRenderedLength)}\r`);
		this.lastRenderedLength = 0;
	}
}

export async function runJobsWithConcurrency<I, O>({
	items,
	concurrency,
	getId,
	handler,
	updateIntervalMs,
	label = 'Progress',
	statusMode = 'interactive',
	output = process.stderr
}: JobRunnerOptions<I, O>): Promise<O[]> {
	const total = items.length;
	if (total === 0) {
		return [];
	}
	const effectiveConcurrency = Math.max(1, Math.min(concurrency, total));
	const results: O[] = new Array(total);
	const stream = output ?? process.stderr;
	const effectiveStatusMode: StatusMode = stream.isTTY
		? statusMode
		: statusMode === 'interactive'
		? 'plain'
		: statusMode;
	const effectiveUpdateInterval =
		updateIntervalMs ?? (effectiveStatusMode === 'plain' ? 10_000 : 1_000);
	const progressDisplay = new ProgressDisplay(total, label, effectiveUpdateInterval, {
		mode: effectiveStatusMode,
		output: stream
	});
	progressDisplay.start();
	let nextIndex = 0;

	const runWorker = async (): Promise<void> => {
		while (true) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= total) {
				return;
			}
			const item = items[currentIndex];
			const id = getId(item, currentIndex);
			const reporter = progressDisplay.createReporter();
			progressDisplay.jobStarted();
			try {
				const result = await handler(item, {
					index: currentIndex,
					progress: {
						reportChars: reporter.reportChars,
						log: (message: string) => {
							reporter.log(`[${id}] ${message}`);
						},
						startModelCall: reporter.startModelCall,
						recordModelUsage: reporter.recordModelUsage,
						finishModelCall: reporter.finishModelCall
					}
				});
				results[currentIndex] = result;
			} finally {
				progressDisplay.jobCompleted();
			}
		}
	};

	try {
		await Promise.all(Array.from({ length: effectiveConcurrency }, () => runWorker()));
	} finally {
		progressDisplay.stop();
	}

	return results;
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
	return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
		Math.max(0, Math.floor(value))
	);
}

function formatPerModel(perModel: MetricsSnapshot['perModel']): string {
	if (perModel.length === 0) {
		return 'models: n/a';
	}
	const entries = perModel.map((entry) => {
		const prompt = formatNumber(entry.promptTokens);
		const inference = formatNumber(entry.inferenceTokens);
		return `${entry.modelId.replace('gemini-', '')}: P ${prompt} / I ${inference}`;
	});
	return `models: ${entries.join(', ')}`;
}
