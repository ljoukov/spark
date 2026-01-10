import { clearInterval, setInterval } from "node:timers";
const ANSI_RESET = "\u001b[0m";
const ANSI_GRAY = "\u001b[90m";
const ANSI_RED = "\u001b[31m";

export type StatusMode = "interactive" | "plain" | "off";

export type ModelCallHandle = symbol;
export type StageHandle = symbol;

export type LlmUsageTokenUpdate = {
  readonly promptTokens?: number;
  readonly cachedTokens?: number;
  readonly responseTokens?: number;
  readonly responseImageTokens?: number;
  readonly thinkingTokens?: number;
  readonly totalTokens?: number;
  readonly toolUsePromptTokens?: number;
};

export type LlmUsageChunk = {
  readonly modelVersion?: string;
  readonly prompt?: {
    readonly textChars?: number;
    readonly imageCount?: number;
    readonly imageBytes?: number;
  };
  readonly response?: {
    readonly textCharsDelta?: number;
    readonly imageCountDelta?: number;
    readonly imageBytesDelta?: number;
  };
  readonly thinking?: {
    readonly textCharsDelta?: number;
  };
  readonly tokens?: LlmUsageTokenUpdate;
};

export type JobProgressReporter = {
  log(message: string): void;
  startModelCall(details: {
    modelId: string;
    uploadBytes: number;
    imageSize?: string;
  }): ModelCallHandle;
  recordModelUsage(handle: ModelCallHandle, chunk: LlmUsageChunk): void;
  finishModelCall(handle: ModelCallHandle): void;
  startStage(stageName: string): StageHandle;
  finishStage(handle: StageHandle): void;
  setActiveStages?(stages: Iterable<string>): void;
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

type TokenTotals = {
  prompt: number;
  cached: number;
  responseText: number;
  responseImages: number;
  thinking: number;
  total: number;
  toolUse: number;
};

type MetricsSnapshot = {
  readonly promptChars: number;
  readonly promptImages: number;
  readonly promptImageBytes: number;
  readonly responseChars: number;
  readonly responseImages: number;
  readonly responseImageBytes: number;
  readonly thinkingChars: number;
  readonly tokens: TokenTotals;
  readonly costUsd: number;
  readonly activeCalls: number;
  readonly modelsUsed: readonly string[];
};

type CallTokenState = {
  promptTokens: number;
  cachedTokens: number;
  responseTokens: number;
  responseImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  toolUsePromptTokens: number;
};

type CallUsageState = {
  modelId: string;
  modelVersion?: string;
  requestImageSize?: string;
  promptChars: number;
  promptImages: number;
  promptImageBytes: number;
  responseChars: number;
  responseImages: number;
  responseImageBytes: number;
  thinkingChars: number;
  tokens: CallTokenState;
  appliedCostUsd: number;
};

const PRO_PREVIEW_THRESHOLD = 200_000; // prompt token count threshold for higher tier pricing
const PRO_PREVIEW_INPUT_RATE_LOW = 2 / 1_000_000; // $2 per 1M input tokens
const PRO_PREVIEW_INPUT_RATE_HIGH = 4 / 1_000_000; // $4 per 1M input tokens (large prompts)
const PRO_PREVIEW_OUTPUT_RATE_LOW = 12 / 1_000_000; // $12 per 1M output/thinking tokens
const PRO_PREVIEW_OUTPUT_RATE_HIGH = 18 / 1_000_000; // $18 per 1M output/thinking tokens (large prompts)
const PRO_PREVIEW_CACHED_RATE_LOW = 0.2 / 1_000_000; // $0.20 per 1M cached tokens
const PRO_PREVIEW_CACHED_RATE_HIGH = 0.4 / 1_000_000; // $0.40 per 1M cached tokens (large prompts)

const IMAGE_PREVIEW_INPUT_RATE = 2 / 1_000_000; // $2 per 1M input tokens (text/image)
const IMAGE_PREVIEW_OUTPUT_TEXT_RATE = 12 / 1_000_000; // $12 per 1M text/thinking tokens
const IMAGE_PREVIEW_OUTPUT_IMAGE_RATE = 120 / 1_000_000; // $120 per 1M image tokens
const IMAGE_PREVIEW_IMAGE_PRICES: Record<string, number> = {
  "1K": 0.134,
  "2K": 0.134,
  "4K": 0.24,
};
const IMAGE_PREVIEW_CACHED_RATE = 0.2 / 1_000_000; // $0.20 per 1M cached tokens

function createEmptyTokenState(): CallTokenState {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    responseTokens: 0,
    responseImageTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    toolUsePromptTokens: 0,
  };
}

function resolveNumber(next: number | undefined, prev: number): number {
  if (typeof next === "number" && Number.isFinite(next)) {
    return Math.max(0, next);
  }
  return prev;
}

function resolvePricingModel(
  modelId: string,
): "pro-preview" | "image-preview" | undefined {
  if (modelId.includes("image-preview")) {
    return "image-preview";
  }
  if (modelId.includes("gemini-3-pro")) {
    return "pro-preview";
  }
  return undefined;
}

function calculateCallCost({
  modelId,
  tokens,
  responseImages,
  imageSize,
}: {
  modelId: string;
  tokens: CallTokenState;
  responseImages: number;
  imageSize?: string;
}): number {
  const pricingModel = resolvePricingModel(modelId);
  if (!pricingModel) {
    return 0;
  }
  const promptTokens = tokens.promptTokens + (tokens.toolUsePromptTokens ?? 0);
  const cachedTokens = tokens.cachedTokens;
  const nonCachedPrompt = Math.max(0, promptTokens - cachedTokens);
  const responseImageTokens = tokens.responseImageTokens;
  const responseTokensRaw = tokens.responseTokens;
  const responseTextTokens = Math.max(
    0,
    responseTokensRaw - responseImageTokens,
  );
  const thinkingTokens = tokens.thinkingTokens;

  if (pricingModel === "pro-preview") {
    const useHighTier = promptTokens > PRO_PREVIEW_THRESHOLD;
    const inputRate = useHighTier
      ? PRO_PREVIEW_INPUT_RATE_HIGH
      : PRO_PREVIEW_INPUT_RATE_LOW;
    const cachedRate = useHighTier
      ? PRO_PREVIEW_CACHED_RATE_HIGH
      : PRO_PREVIEW_CACHED_RATE_LOW;
    const outputRate = useHighTier
      ? PRO_PREVIEW_OUTPUT_RATE_HIGH
      : PRO_PREVIEW_OUTPUT_RATE_LOW;
    const inputCost = nonCachedPrompt * inputRate;
    const cachedCost = cachedTokens * cachedRate;
    const outputTokens = tokens.responseTokens + thinkingTokens;
    const outputCost = outputTokens * outputRate;
    return inputCost + cachedCost + outputCost;
  }

  const imageRate =
    imageSize && IMAGE_PREVIEW_IMAGE_PRICES[imageSize]
      ? IMAGE_PREVIEW_IMAGE_PRICES[imageSize]
      : IMAGE_PREVIEW_IMAGE_PRICES["2K"];
  const tokensPerImage =
    IMAGE_PREVIEW_OUTPUT_IMAGE_RATE > 0
      ? imageRate / IMAGE_PREVIEW_OUTPUT_IMAGE_RATE
      : 0;
  let responseTextForPricing = responseTextTokens;
  let imageTokensForPricing = responseImageTokens;
  if (imageTokensForPricing <= 0 && responseImages > 0 && tokensPerImage > 0) {
    const estimatedImageTokens = responseImages * tokensPerImage;
    imageTokensForPricing = estimatedImageTokens;
    if (responseTextForPricing >= estimatedImageTokens) {
      responseTextForPricing -= estimatedImageTokens;
    }
  }
  const inputCost = nonCachedPrompt * IMAGE_PREVIEW_INPUT_RATE;
  const cachedCost = cachedTokens * IMAGE_PREVIEW_CACHED_RATE;
  const textOutputCost =
    (responseTextForPricing + thinkingTokens) * IMAGE_PREVIEW_OUTPUT_TEXT_RATE;
  const imageOutputCost =
    imageTokensForPricing * IMAGE_PREVIEW_OUTPUT_IMAGE_RATE;
  return inputCost + cachedCost + textOutputCost + imageOutputCost;
}

class MetricsTracker {
  private promptChars = 0;
  private promptImages = 0;
  private promptImageBytes = 0;
  private responseChars = 0;
  private responseImages = 0;
  private responseImageBytes = 0;
  private thinkingChars = 0;
  private readonly tokens: TokenTotals = {
    prompt: 0,
    cached: 0,
    responseText: 0,
    responseImages: 0,
    thinking: 0,
    total: 0,
    toolUse: 0,
  };
  private costUsd = 0;
  private activeCalls = 0;
  private readonly modelsUsed = new Set<string>();
  private readonly callInfo = new Map<ModelCallHandle, CallUsageState>();

  startCall(
    modelId: string,
    _uploadBytes: number,
    imageSize?: string,
  ): ModelCallHandle {
    const handle: ModelCallHandle = Symbol("model-call");
    this.activeCalls += 1;
    this.modelsUsed.add(modelId);
    this.callInfo.set(handle, {
      modelId,
      requestImageSize: imageSize,
      promptChars: 0,
      promptImages: 0,
      promptImageBytes: 0,
      responseChars: 0,
      responseImages: 0,
      responseImageBytes: 0,
      thinkingChars: 0,
      tokens: createEmptyTokenState(),
      appliedCostUsd: 0,
    });
    return handle;
  }

  recordUsage(handle: ModelCallHandle, chunk: LlmUsageChunk): void {
    const state = this.callInfo.get(handle);
    if (!state) {
      return;
    }
    if (chunk.modelVersion) {
      state.modelVersion = chunk.modelVersion;
      this.modelsUsed.add(chunk.modelVersion);
    }
    if (chunk.prompt) {
      const textChars = Math.max(0, chunk.prompt.textChars ?? 0);
      const imageCount = Math.max(0, chunk.prompt.imageCount ?? 0);
      const imageBytes = Math.max(0, chunk.prompt.imageBytes ?? 0);
      this.promptChars += textChars;
      this.promptImages += imageCount;
      this.promptImageBytes += imageBytes;
      state.promptChars += textChars;
      state.promptImages += imageCount;
      state.promptImageBytes += imageBytes;
    }
    if (chunk.response) {
      const textDelta = Math.max(0, chunk.response.textCharsDelta ?? 0);
      const imageDelta = Math.max(0, chunk.response.imageCountDelta ?? 0);
      const imageBytesDelta = Math.max(0, chunk.response.imageBytesDelta ?? 0);
      this.responseChars += textDelta;
      this.responseImages += imageDelta;
      this.responseImageBytes += imageBytesDelta;
      state.responseChars += textDelta;
      state.responseImages += imageDelta;
      state.responseImageBytes += imageBytesDelta;
    }
    if (chunk.thinking) {
      const thinkingDelta = Math.max(0, chunk.thinking.textCharsDelta ?? 0);
      this.thinkingChars += thinkingDelta;
      state.thinkingChars += thinkingDelta;
    }
    if (chunk.tokens) {
      this.applyTokenUpdate(state, chunk.tokens);
    }
  }

  finishCall(handle: ModelCallHandle): void {
    if (this.callInfo.delete(handle)) {
      this.activeCalls = Math.max(0, this.activeCalls - 1);
    }
  }

  getSnapshot(): MetricsSnapshot {
    return {
      promptChars: this.promptChars,
      promptImages: this.promptImages,
      promptImageBytes: this.promptImageBytes,
      responseChars: this.responseChars,
      responseImages: this.responseImages,
      responseImageBytes: this.responseImageBytes,
      thinkingChars: this.thinkingChars,
      tokens: { ...this.tokens },
      costUsd: this.costUsd,
      activeCalls: this.activeCalls,
      modelsUsed: Array.from(this.modelsUsed).sort(),
    };
  }

  private applyTokenUpdate(
    state: CallUsageState,
    tokens: LlmUsageTokenUpdate,
  ): void {
    const previous = state.tokens;
    const resolvedPromptTokens = resolveNumber(
      tokens.promptTokens,
      previous.promptTokens,
    );
    const resolvedCachedTokens = resolveNumber(
      tokens.cachedTokens,
      previous.cachedTokens,
    );
    const resolvedResponseTokens = resolveNumber(
      tokens.responseTokens,
      previous.responseTokens,
    );
    const resolvedResponseImageTokens = resolveNumber(
      tokens.responseImageTokens,
      previous.responseImageTokens,
    );
    const resolvedThinkingTokens = resolveNumber(
      tokens.thinkingTokens,
      previous.thinkingTokens,
    );
    const resolvedToolUseTokens = resolveNumber(
      tokens.toolUsePromptTokens,
      previous.toolUsePromptTokens,
    );
    const computedTotal =
      resolvedPromptTokens +
      resolvedResponseTokens +
      resolvedThinkingTokens +
      resolvedToolUseTokens;
    const resolvedTotalTokens = resolveNumber(
      tokens.totalTokens ?? computedTotal,
      previous.totalTokens,
    );
    const next: CallTokenState = {
      promptTokens: resolvedPromptTokens,
      cachedTokens: resolvedCachedTokens,
      responseTokens: resolvedResponseTokens,
      responseImageTokens: resolvedResponseImageTokens,
      thinkingTokens: resolvedThinkingTokens,
      totalTokens: resolvedTotalTokens,
      toolUsePromptTokens: resolvedToolUseTokens,
    };

    const promptDelta = Math.max(0, next.promptTokens - previous.promptTokens);
    const cachedDelta = Math.max(0, next.cachedTokens - previous.cachedTokens);
    const responseImageDelta = Math.max(
      0,
      next.responseImageTokens - previous.responseImageTokens,
    );
    const prevResponseText = Math.max(
      0,
      previous.responseTokens - previous.responseImageTokens,
    );
    const nextResponseText = Math.max(
      0,
      next.responseTokens - next.responseImageTokens,
    );
    const responseTextDelta = Math.max(0, nextResponseText - prevResponseText);
    const thinkingDelta = Math.max(
      0,
      next.thinkingTokens - previous.thinkingTokens,
    );
    const totalDelta = Math.max(0, next.totalTokens - previous.totalTokens);
    const toolUseDelta = Math.max(
      0,
      next.toolUsePromptTokens - previous.toolUsePromptTokens,
    );

    this.tokens.prompt += promptDelta;
    this.tokens.cached += cachedDelta;
    this.tokens.responseImages += responseImageDelta;
    this.tokens.responseText += responseTextDelta;
    this.tokens.thinking += thinkingDelta;
    this.tokens.total += totalDelta;
    this.tokens.toolUse += toolUseDelta;

    state.tokens = next;
    const callCost = calculateCallCost({
      modelId: state.modelVersion ?? state.modelId,
      tokens: next,
      responseImages: state.responseImages,
      imageSize: state.requestImageSize,
    });
    const costDelta = Math.max(0, callCost - state.appliedCostUsd);
    if (costDelta > 0) {
      this.costUsd += costDelta;
      state.appliedCostUsd = callCost;
    }
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
  private readonly activeStages = new Map<
    StageHandle,
    { label: string; reporterId: symbol; startedAt: number }
  >();

  constructor(
    totalJobs: number,
    label: string,
    updateIntervalMs: number,
    { mode, output }: { mode: StatusMode; output: NodeJS.WriteStream },
  ) {
    this.totalJobs = totalJobs;
    this.label = label;
    this.updateIntervalMs = updateIntervalMs;
    this.mode = mode;
    this.output = output;
    this.useColor = Boolean(output.isTTY) && mode === "interactive";
    this.labelDisplay = this.useColor ? `\u001b[36m${label}\u001b[0m` : label;
  }

  start(): void {
    if (this.mode === "off" || this.totalJobs === 0) {
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
    if (this.mode === "off") {
      return;
    }
    this.render(true);
    if (this.totalJobs > 0 && this.mode === "interactive") {
      this.output.write("\n");
    }
  }

  jobStarted(): void {
    if (this.mode === "off") {
      return;
    }
    this.runningJobs += 1;
    this.dirty = true;
    this.render(this.mode === "interactive");
  }

  jobCompleted(reporterId?: symbol): void {
    if (this.mode === "off") {
      return;
    }
    if (reporterId) {
      this.clearStagesForReporter(reporterId);
    }
    if (this.runningJobs > 0) {
      this.runningJobs -= 1;
    }
    this.completedJobs += 1;
    this.dirty = true;
    this.render(this.mode === "interactive");
  }

  startModelCall(
    modelId: string,
    uploadBytes: number,
    imageSize?: string,
  ): ModelCallHandle {
    if (this.mode === "off") {
      return Symbol("model-call");
    }
    this.dirty = true;
    return this.metrics.startCall(modelId, uploadBytes, imageSize);
  }

  recordModelUsage(handle: ModelCallHandle, chunk: LlmUsageChunk): void {
    if (this.mode === "off") {
      return;
    }
    this.metrics.recordUsage(handle, chunk);
    this.dirty = true;
  }

  finishModelCall(handle: ModelCallHandle): void {
    if (this.mode === "off") {
      return;
    }
    this.metrics.finishCall(handle);
    this.dirty = true;
  }

  log(message: string): void {
    if (this.mode === "off") {
      console.log(message);
      return;
    }
    const formattedLines = this.formatLogLines(message);
    if (formattedLines.length === 0) {
      return;
    }
    if (this.mode === "interactive") {
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

  createReporter(): { reporter: JobProgressReporter; reporterId: symbol } {
    if (this.mode === "off") {
      const reporter: JobProgressReporter = {
        log: (message) => {
          console.log(message);
        },
        startModelCall: (details) => {
          void details;
          return Symbol("model-call");
        },
        recordModelUsage: () => {},
        finishModelCall: () => {},
        startStage: () => Symbol("stage"),
        finishStage: () => {},
        setActiveStages: () => {},
      };
      return { reporter, reporterId: Symbol("reporter") };
    }
    const reporterId = Symbol("reporter");
    const reporter: JobProgressReporter = {
      log: (message) => {
        this.log(message);
      },
      startModelCall: ({ modelId, uploadBytes, imageSize }) =>
        this.startModelCall(modelId, uploadBytes, imageSize),
      recordModelUsage: (handle, chunk) => {
        this.recordModelUsage(handle, chunk);
      },
      finishModelCall: (handle) => {
        this.finishModelCall(handle);
      },
      startStage: (stageName) => this.startStage(reporterId, stageName),
      finishStage: (handle) => {
        this.finishStage(reporterId, handle);
      },
      setActiveStages: (stages) => {
        this.setActiveStagesForReporter(reporterId, stages);
      },
    };
    return { reporter, reporterId };
  }

  private startStage(reporterId: symbol, stageName: string): StageHandle {
    const name = stageName.trim() || "stage";
    const handle: StageHandle = Symbol("stage");
    this.activeStages.set(handle, {
      label: name,
      reporterId,
      startedAt: Date.now(),
    });
    this.dirty = true;
    this.render(true);
    return handle;
  }

  private finishStage(reporterId: symbol, handle: StageHandle): void {
    const entry = this.activeStages.get(handle);
    if (!entry || entry.reporterId !== reporterId) {
      return;
    }
    this.activeStages.delete(handle);
    this.dirty = true;
    this.render(true);
  }

  private clearStagesForReporter(reporterId: symbol): void {
    let changed = false;
    for (const [handle, entry] of Array.from(this.activeStages.entries())) {
      if (entry.reporterId === reporterId) {
        this.activeStages.delete(handle);
        changed = true;
      }
    }
    if (changed) {
      this.dirty = true;
      this.render(true);
    }
  }

  private setActiveStagesForReporter(
    reporterId: symbol,
    stages: Iterable<string>,
  ): void {
    let changed = false;
    for (const [handle, entry] of Array.from(this.activeStages.entries())) {
      if (entry.reporterId === reporterId) {
        this.activeStages.delete(handle);
        changed = true;
      }
    }
    const timestamp = Date.now();
    let offset = 0;
    for (const rawStage of stages) {
      const stage = rawStage.trim();
      if (stage.length === 0) {
        continue;
      }
      const handle: StageHandle = Symbol("stage");
      this.activeStages.set(handle, {
        label: stage,
        reporterId,
        startedAt: timestamp + offset,
      });
      offset += 1;
      changed = true;
    }
    if (changed) {
      this.dirty = true;
      this.render(this.mode === "interactive");
    }
  }

  private formatStages(): string {
    if (this.activeStages.size === 0) {
      return "n/a";
    }
    const seen = new Set<string>();
    const ordered = Array.from(this.activeStages.values()).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
    const labels: string[] = [];
    for (const entry of ordered) {
      if (seen.has(entry.label)) {
        continue;
      }
      seen.add(entry.label);
      labels.push(entry.label);
    }
    return labels.join(", ");
  }

  private render(force = false): void {
    if (this.mode === "off") {
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
    if (
      this.mode === "plain" &&
      !force &&
      now - this.lastRenderTime < this.updateIntervalMs
    ) {
      return;
    }
    const metrics = this.metrics.getSnapshot();
    const stageDisplay = this.formatStages();
    const usageSummary = formatUsageSummary(metrics);
    const lineParts = [
      this.labelDisplay,
      `stages: ${stageDisplay}`,
      usageSummary,
    ].filter((part) => part.trim().length > 0);
    const line =
      lineParts.length > 1
        ? `${lineParts[0]} ${lineParts.slice(1).join(" | ")}`
        : lineParts[0];
    this.writeLine(line);
    this.lastRenderTime = now;
  }

  private formatLogLines(message: string): string[] {
    const lines = message.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length === 0) {
      return [];
    }
    const timestamp = this.formatTimestamp(new Date());
    const [firstLine, ...rest] = lines;
    const formatted: string[] = [];
    formatted.push(this.formatPrimaryLogLine(firstLine ?? "", timestamp));
    for (const line of rest) {
      formatted.push(this.formatContinuationLine(line ?? "", timestamp));
    }
    return formatted;
  }

  private formatPrimaryLogLine(line: string, timestamp: string): string {
    const errorMarker = "ERROR ";
    const markerIndex = line.indexOf(errorMarker);
    const hasError =
      markerIndex >= 0 &&
      (markerIndex === 0 ||
        line[markerIndex - 1] === " " ||
        line[markerIndex - 1] === "]");
    const basePrefix = this.useColor
      ? `${ANSI_GRAY}[${timestamp}]${ANSI_RESET}`
      : `[${timestamp}]`;
    if (hasError) {
      const context = line.slice(0, markerIndex).trim();
      const errorText = line
        .slice(markerIndex + errorMarker.length)
        .trimStart();
      const contextDisplay = context.length > 0 ? `${context} ` : "";
      const errorLabel = this.useColor
        ? `${ANSI_RED}Error:${ANSI_RESET}`
        : "Error:";
      return `${basePrefix} ${errorLabel} ${contextDisplay}${errorText}`;
    }
    return `${basePrefix} ${line}`;
  }

  private formatContinuationLine(line: string, timestamp: string): string {
    const basePrefix = this.useColor
      ? `${ANSI_GRAY}[${timestamp}]${ANSI_RESET}`
      : `[${timestamp}]`;
    const continuation = line.length > 0 ? line : "";
    return `${basePrefix}   ${continuation}`;
  }

  private formatTimestamp(date: Date): string {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  private writeLine(line: string): void {
    if (this.mode === "interactive") {
      const padded = line.padEnd(this.lastRenderedLength, " ");
      this.output.write(`\r${padded}`);
      this.lastRenderedLength = Math.max(this.lastRenderedLength, line.length);
      return;
    }
    this.output.write(`${line}\n`);
    this.lastRenderedLength = 0;
  }

  private clearLine(): void {
    if (this.mode !== "interactive" || this.lastRenderedLength === 0) {
      return;
    }
    this.output.write(`\r${" ".repeat(this.lastRenderedLength)}\r`);
    this.lastRenderedLength = 0;
  }
}

export async function runJobsWithConcurrency<I, O>({
  items,
  concurrency,
  getId,
  handler,
  updateIntervalMs,
  label = "Progress",
  statusMode = "interactive",
  output = process.stderr,
}: JobRunnerOptions<I, O>): Promise<O[]> {
  const total = items.length;
  if (total === 0) {
    return [];
  }
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, total));
  const results = new Array<O>(total);
  const stream = output ?? process.stderr;
  const effectiveStatusMode: StatusMode = stream.isTTY
    ? statusMode
    : statusMode === "interactive"
      ? "plain"
      : statusMode;
  const effectiveUpdateInterval =
    updateIntervalMs ?? (effectiveStatusMode === "plain" ? 10_000 : 1_000);
  const progressDisplay = new ProgressDisplay(
    total,
    label,
    effectiveUpdateInterval,
    {
      mode: effectiveStatusMode,
      output: stream,
    },
  );
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
      const { reporter, reporterId } = progressDisplay.createReporter();
      progressDisplay.jobStarted();
      try {
        const result = await handler(item, {
          index: currentIndex,
          progress: {
            log: (message: string) => {
              reporter.log(`[${id}] ${message}`);
            },
            startModelCall: (details) => reporter.startModelCall(details),
            recordModelUsage: (handle, chunk) =>
              reporter.recordModelUsage(handle, chunk),
            finishModelCall: (handle) => reporter.finishModelCall(handle),
            startStage: (stageName) => reporter.startStage(stageName),
            finishStage: (handle) => reporter.finishStage(handle),
            setActiveStages: (stages) => reporter.setActiveStages?.(stages),
          },
        });
        results[currentIndex] = result;
      } finally {
        progressDisplay.jobCompleted(reporterId);
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: effectiveConcurrency }, () => runWorker()),
    );
  } finally {
    progressDisplay.stop();
  }

  return results;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.floor(value)),
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = value >= 10 ? 0 : 1;
  return `${value.toFixed(fractionDigits)}${units[unitIndex]}`;
}

function formatCurrency(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: safeValue < 1 ? 4 : 2,
    maximumFractionDigits: safeValue < 1 ? 4 : 2,
  }).format(safeValue);
}

function formatUsageSummary(metrics: MetricsSnapshot): string {
  const sections: string[] = [];

  const promptParts: string[] = [];
  if (metrics.promptChars > 0) {
    promptParts.push(`${formatNumber(metrics.promptChars)} chars`);
  }
  if (metrics.promptImages > 0) {
    const bytes =
      metrics.promptImageBytes > 0
        ? ` (${formatBytes(metrics.promptImageBytes)})`
        : "";
    promptParts.push(`${formatNumber(metrics.promptImages)} imgs${bytes}`);
  } else if (metrics.promptImageBytes > 0) {
    promptParts.push(formatBytes(metrics.promptImageBytes));
  }
  const promptTokenTotal = metrics.tokens.prompt + metrics.tokens.toolUse;
  if (promptTokenTotal > 0) {
    promptParts.push(`${formatNumber(promptTokenTotal)} tok`);
  }
  if (metrics.tokens.cached > 0) {
    promptParts.push(`cached: ${formatNumber(metrics.tokens.cached)} tok`);
  }
  if (promptParts.length > 0) {
    sections.push(`prompt: ${promptParts.join(", ")}`);
  }

  const thinkingParts: string[] = [];
  if (metrics.thinkingChars > 0) {
    thinkingParts.push(`${formatNumber(metrics.thinkingChars)} chars`);
  }
  if (metrics.tokens.thinking > 0) {
    thinkingParts.push(`${formatNumber(metrics.tokens.thinking)} tok`);
  }
  if (thinkingParts.length > 0) {
    sections.push(`thinking: ${thinkingParts.join(", ")}`);
  }

  const responseParts: string[] = [];
  if (metrics.responseChars > 0) {
    responseParts.push(`${formatNumber(metrics.responseChars)} chars`);
  }
  if (metrics.responseImages > 0) {
    const bytes =
      metrics.responseImageBytes > 0
        ? ` (${formatBytes(metrics.responseImageBytes)})`
        : "";
    responseParts.push(`${formatNumber(metrics.responseImages)} imgs${bytes}`);
  } else if (metrics.responseImageBytes > 0) {
    responseParts.push(formatBytes(metrics.responseImageBytes));
  }
  const responseTokens =
    metrics.tokens.responseText + metrics.tokens.responseImages;
  if (responseTokens > 0) {
    responseParts.push(`${formatNumber(responseTokens)} tok`);
  }
  if (responseParts.length > 0) {
    sections.push(`response: ${responseParts.join(", ")}`);
  }

  if (metrics.costUsd > 0) {
    sections.push(`cost: ${formatCurrency(metrics.costUsd)}`);
  }
  if (metrics.modelsUsed.length > 0) {
    sections.push(`models: ${metrics.modelsUsed.join(", ")}`);
  }
  return sections.join(" | ");
}
