import { clearInterval, setInterval } from 'node:timers';

const SPEED_WINDOW_MS = 10_000;

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
	readonly speedTokensPerSecond: number;
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
	private readonly usageWindow: Array<{ timestamp: number; tokens: number }> = [];

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
		if (delta.promptTokensDelta > 0) {
			this.totalPromptTokens += delta.promptTokensDelta;
			const metrics = this.perModel.get(info.modelId) ?? {
				promptTokens: 0,
				inferenceTokens: 0
			};
			metrics.promptTokens += delta.promptTokensDelta;
			this.perModel.set(info.modelId, metrics);
		}
		if (delta.inferenceTokensDelta > 0) {
			this.totalInferenceTokens += delta.inferenceTokensDelta;
			const metrics = this.perModel.get(info.modelId) ?? {
				promptTokens: 0,
				inferenceTokens: 0
			};
			metrics.inferenceTokens += delta.inferenceTokensDelta;
			this.perModel.set(info.modelId, metrics);
			this.usageWindow.push({ timestamp: delta.timestamp, tokens: delta.inferenceTokensDelta });
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
		const windowTokens = this.usageWindow.reduce((sum, entry) => sum + entry.tokens, 0);
		const windowStart = this.usageWindow.length > 0 ? this.usageWindow[0].timestamp : now;
		const elapsedSeconds = Math.max((now - windowStart) / 1000, 1);
		const speed = windowTokens / elapsedSeconds;
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
			speedTokensPerSecond: speed,
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

	constructor(totalJobs: number, label: string, updateIntervalMs: number) {
		this.totalJobs = totalJobs;
		this.label = label;
		this.updateIntervalMs = updateIntervalMs;
	}

	start(): void {
		if (this.totalJobs === 0) {
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
		this.render(true);
		if (this.totalJobs > 0) {
			process.stdout.write('\n');
		}
	}

	jobStarted(): void {
		this.runningJobs += 1;
		this.dirty = true;
		this.render(true);
	}

	jobCompleted(): void {
		if (this.runningJobs > 0) {
			this.runningJobs -= 1;
		}
		this.completedJobs += 1;
		this.dirty = true;
		this.render(true);
	}

	reportChars(delta: number): void {
		this.metrics.reportChars(delta);
		this.dirty = true;
	}

	startModelCall(modelId: string, uploadBytes: number): ModelCallHandle {
		this.dirty = true;
		return this.metrics.startCall(modelId, uploadBytes);
	}

	recordModelUsage(handle: ModelCallHandle, delta: ModelUsageDelta): void {
		this.metrics.recordUsage(handle, delta);
		this.dirty = true;
	}

	finishModelCall(handle: ModelCallHandle): void {
		this.metrics.finishCall(handle);
		this.dirty = true;
	}

	log(message: string): void {
		this.clearLine();
		console.log(message);
		this.dirty = true;
		this.render(true);
	}

	createReporter(): JobProgressReporter {
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
		if (!force && !this.dirty) {
			return;
		}
		this.dirty = false;
		if (this.totalJobs === 0) {
			return;
		}
		const percent =
			this.completedJobs >= this.totalJobs ? 100 : (this.completedJobs / this.totalJobs) * 100;
		const waitingJobs = Math.max(this.totalJobs - this.completedJobs - this.runningJobs, 0);
		const metrics = this.metrics.getSnapshot();
		const line =
			`${this.label} ${percent.toFixed(1).padStart(5, ' ')}% | jobs ${this.completedJobs}/${this.totalJobs}` +
			` | waiting ${waitingJobs}` +
			` | up ${formatBytes(metrics.totalUploadBytes)}` +
			` | tok ${formatNumber(metrics.totalInferenceTokens)}` +
			` | speed ${formatNumber(Math.round(metrics.speedTokensPerSecond))}/s` +
			` | models ${formatPerModel(metrics.perModel)}`;
		this.writeLine(line);
	}

	private writeLine(line: string): void {
		const padded = line.padEnd(this.lastRenderedLength, ' ');
		process.stdout.write(`\r${padded}`);
		this.lastRenderedLength = Math.max(this.lastRenderedLength, line.length);
	}

	private clearLine(): void {
		if (this.lastRenderedLength === 0) {
			return;
		}
		process.stdout.write(`\r${' '.repeat(this.lastRenderedLength)}\r`);
		this.lastRenderedLength = 0;
	}
}

export async function runJobsWithConcurrency<I, O>({
	items,
	concurrency,
	getId,
	handler,
	updateIntervalMs = 1000,
	label = 'Progress'
}: JobRunnerOptions<I, O>): Promise<O[]> {
	const total = items.length;
	if (total === 0) {
		return [];
	}
	const effectiveConcurrency = Math.max(1, Math.min(concurrency, total));
	const results: O[] = new Array(total);
	const progressDisplay = new ProgressDisplay(total, label, updateIntervalMs);
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
		return '—';
	}
	return perModel
		.map((entry) => {
			const prompt = formatNumber(entry.promptTokens);
			const inference = formatNumber(entry.inferenceTokens);
			return `${entry.modelId.replace('gemini-', '')} P:${prompt} I:${inference}`;
		})
		.join(' · ');
}
