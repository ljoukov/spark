import { z } from "zod";

import {
  getGoogleAccessToken,
  parseGoogleServiceAccountJson,
} from "./googleAccessToken";

const GOOGLE_CLOUD_PLATFORM_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";
const MONITORING_API_ROOT = "https://monitoring.googleapis.com/v3";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_NAMESPACE = "spark";
const DEFAULT_LOCATION = "global";
const DEFAULT_LABEL_VALUE = "n/a";
const DEFAULT_METRIC_JOB = "spark-llm";

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const handle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(handle),
  };
}

function readEnvVar(name: string): string {
  const processRecord = globalThis as unknown as {
    process?: { env?: Record<string, unknown> };
  };
  const value = processRecord.process?.env?.[name];
  return typeof value === "string" ? value : "";
}

function isTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function sanitizeGenericTaskLabel(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }
  const normalized = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized.slice(0, 128);
}

function sanitizeMetricLabelValue(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return DEFAULT_LABEL_VALUE;
  }
  return trimmed.slice(0, 256);
}

function createSparkMetricTaskId(prefix: string): string {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return sanitizeGenericTaskLabel(`${prefix}-${randomPart}`, prefix);
}

function resolveMonitoringLocation(): string {
  return sanitizeGenericTaskLabel(
    readEnvVar("SPARK_MONITORING_LOCATION") ||
      readEnvVar("GOOGLE_CLOUD_REGION") ||
      readEnvVar("CLOUD_RUN_REGION") ||
      readEnvVar("FUNCTION_REGION") ||
      readEnvVar("REGION"),
    DEFAULT_LOCATION,
  );
}

export const SPARK_MONITORING_METRIC_TYPES = {
  llmCallLatencyMs: "custom.googleapis.com/spark/llm/call_latency_ms",
  llmCallTotalTokens: "custom.googleapis.com/spark/llm/call_total_tokens",
  llmCallCostUsd: "custom.googleapis.com/spark/llm/call_cost_usd",
  llmToolLoopStepLatencyMs:
    "custom.googleapis.com/spark/llm/tool_loop_step_latency_ms",
  agentRunDurationMs: "custom.googleapis.com/spark/agent/run_duration_ms",
  agentProcessCpuUtilization:
    "custom.googleapis.com/spark/agent/process_cpu_utilization",
  agentProcessCpuTimeMs: "custom.googleapis.com/spark/agent/process_cpu_time_ms",
  agentProcessRssPeakBytes:
    "custom.googleapis.com/spark/agent/process_rss_peak_bytes",
} as const;

type SparkMetricType =
  (typeof SPARK_MONITORING_METRIC_TYPES)[keyof typeof SPARK_MONITORING_METRIC_TYPES];

type SparkMetricDescriptorDefinition = {
  readonly type: SparkMetricType;
  readonly displayName: string;
  readonly description: string;
  readonly unit: string;
  readonly labels: ReadonlyArray<{
    readonly key: string;
    readonly description: string;
  }>;
};

const SPARK_MONITORING_METRIC_DESCRIPTORS = [
  {
    type: SPARK_MONITORING_METRIC_TYPES.llmCallLatencyMs,
    displayName: "Spark LLM call latency",
    description:
      "Wall-clock latency for @spark/llm text, JSON, image, and tool-loop wrapper calls.",
    unit: "ms",
    labels: [
      { key: "operation", description: "Spark wrapper operation name." },
      { key: "model", description: "Requested model identifier." },
      { key: "provider", description: "Resolved LLM provider." },
      { key: "status", description: "Call outcome status." },
      { key: "agent_type", description: "Agent workload type when applicable." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.llmCallTotalTokens,
    displayName: "Spark LLM total tokens",
    description:
      "Total tokens reported by @spark/llm for a completed text or JSON call.",
    unit: "1",
    labels: [
      { key: "operation", description: "Spark wrapper operation name." },
      { key: "model", description: "Requested model identifier." },
      { key: "provider", description: "Resolved LLM provider." },
      { key: "status", description: "Call outcome status." },
      { key: "agent_type", description: "Agent workload type when applicable." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.llmCallCostUsd,
    displayName: "Spark LLM call cost",
    description: "Estimated USD cost reported by @spark/llm for a completed call.",
    unit: "USD",
    labels: [
      { key: "operation", description: "Spark wrapper operation name." },
      { key: "model", description: "Requested model identifier." },
      { key: "provider", description: "Resolved LLM provider." },
      { key: "status", description: "Call outcome status." },
      { key: "agent_type", description: "Agent workload type when applicable." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.llmToolLoopStepLatencyMs,
    displayName: "Spark LLM tool-loop step latency",
    description:
      "Detailed per-step timing phases exposed by @ljoukov/llm tool-loop results.",
    unit: "ms",
    labels: [
      { key: "operation", description: "Tool-loop operation name." },
      { key: "model", description: "Requested model identifier." },
      { key: "provider", description: "Resolved LLM provider." },
      { key: "status", description: "Call outcome status." },
      { key: "agent_type", description: "Agent workload type when applicable." },
      { key: "phase", description: "Tool-loop timing phase name." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.agentRunDurationMs,
    displayName: "Spark agent run duration",
    description:
      "End-to-end agent run duration emitted from @ljoukov/llm telemetry completion events.",
    unit: "ms",
    labels: [
      { key: "agent_type", description: "Spark agent workload type." },
      { key: "status", description: "Agent run outcome status." },
      { key: "scope", description: "Primary run or nested subagent run." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.agentProcessCpuUtilization,
    displayName: "Spark agent process CPU utilization",
    description:
      "Average process CPU utilization ratio sampled over a task-runner agent run.",
    unit: "1",
    labels: [
      { key: "agent_type", description: "Spark agent workload type." },
      { key: "status", description: "Agent run outcome status." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.agentProcessCpuTimeMs,
    displayName: "Spark agent process CPU time",
    description: "Total process CPU time consumed while an agent run was active.",
    unit: "ms",
    labels: [
      { key: "agent_type", description: "Spark agent workload type." },
      { key: "status", description: "Agent run outcome status." },
    ],
  },
  {
    type: SPARK_MONITORING_METRIC_TYPES.agentProcessRssPeakBytes,
    displayName: "Spark agent process RSS peak",
    description: "Peak resident set size observed during an agent run.",
    unit: "By",
    labels: [
      { key: "agent_type", description: "Spark agent workload type." },
      { key: "status", description: "Agent run outcome status." },
    ],
  },
] as const satisfies readonly SparkMetricDescriptorDefinition[];

const SPARK_MONITORING_METRIC_DESCRIPTOR_MAP = new Map<
  SparkMetricType,
  SparkMetricDescriptorDefinition
>(
  SPARK_MONITORING_METRIC_DESCRIPTORS.map((descriptor) => [
    descriptor.type,
    descriptor,
  ]),
);

const MonitoringMetricDescriptorSchema = z.object({
  type: z.string().trim().min(1),
});

const MonitoringApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
  }),
});

const MonitoringTimeSeriesListResponseSchema = z.object({
  timeSeries: z
    .array(
      z.object({
        metric: z.object({
          type: z.string().trim().min(1),
          labels: z.record(z.string(), z.string()).optional(),
        }),
        resource: z.object({
          type: z.string().trim().min(1),
          labels: z.record(z.string(), z.string()).optional(),
        }),
        points: z.array(
          z.object({
            interval: z.object({
              endTime: z.string().trim().min(1),
              startTime: z.string().trim().min(1).optional(),
            }),
            value: z.looseObject({
              doubleValue: z.number().optional(),
              int64Value: z.string().trim().min(1).optional(),
            }),
          }),
        ),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

const ensuredSparkMetricDescriptorTypesByProject = new Map<
  string,
  Set<SparkMetricType>
>();

async function readMonitoringApiError(
  response: Response,
): Promise<{ text: string; status: string | null; message: string | null }> {
  const text = await response.text().catch(() => "");
  if (text.length === 0) {
    return {
      text,
      status: null,
      message: null,
    };
  }
  try {
    const payload = MonitoringApiErrorResponseSchema.parse(JSON.parse(text));
    return {
      text,
      status: payload.error.status ?? null,
      message: payload.error.message ?? null,
    };
  } catch {
    return {
      text,
      status: null,
      message: null,
    };
  }
}

function isMissingMetricTypeError(options: {
  responseStatus: number;
  errorStatus: string | null;
  errorMessage: string | null;
}): boolean {
  if (options.responseStatus !== 404) {
    return false;
  }
  if (options.errorStatus === "NOT_FOUND") {
    return true;
  }
  if (!options.errorMessage) {
    return false;
  }
  return options.errorMessage.includes("Cannot find metric(s) that match type");
}

async function fetchMonitoringApi(options: {
  serviceAccountJson: string;
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<{
  response: Response;
  projectId: string;
}> {
  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE],
  });
  const url = new URL(
    `${MONITORING_API_ROOT}/projects/${encodeURIComponent(projectId)}/${options.path.replace(/^\/+/g, "")}`,
  );
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value.length === 0) {
        continue;
      }
      url.searchParams.set(key, value);
    }
  }
  const { signal, cleanup } = createTimeoutSignal(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal,
    });
    return { response, projectId };
  } finally {
    cleanup();
  }
}

function metricDescriptorUrlPath(metricType: string): string {
  return `metricDescriptors/${metricType.replace(/^\/+/g, "")}`;
}

async function ensureSparkMetricDescriptor(options: {
  serviceAccountJson: string;
  descriptor: SparkMetricDescriptorDefinition;
}): Promise<void> {
  const serviceAccount = parseGoogleServiceAccountJson(options.serviceAccountJson);
  const projectId = serviceAccount.projectId;
  let ensuredTypes = ensuredSparkMetricDescriptorTypesByProject.get(projectId);
  if (!ensuredTypes) {
    ensuredTypes = new Set<SparkMetricType>();
    ensuredSparkMetricDescriptorTypesByProject.set(projectId, ensuredTypes);
  }
  if (ensuredTypes.has(options.descriptor.type)) {
    return;
  }

  const descriptorPath = metricDescriptorUrlPath(options.descriptor.type);
  const existing = await fetchMonitoringApi({
    serviceAccountJson: options.serviceAccountJson,
    path: descriptorPath,
  });
  if (existing.response.ok) {
    const payload = MonitoringMetricDescriptorSchema.parse(
      await existing.response.json(),
    );
    if (payload.type === options.descriptor.type) {
      ensuredTypes.add(options.descriptor.type);
      return;
    }
  } else if (existing.response.status !== 404) {
    const text = await existing.response.text().catch(() => "");
    throw new Error(
      `Monitoring metric descriptor lookup failed (${existing.response.status}): ${text.slice(0, 500)}`,
    );
  }

  const create = await fetchMonitoringApi({
    serviceAccountJson: options.serviceAccountJson,
    method: "POST",
    path: "metricDescriptors",
    body: {
      type: options.descriptor.type,
      metricKind: "GAUGE",
      valueType: "DOUBLE",
      unit: options.descriptor.unit,
      displayName: options.descriptor.displayName,
      description: options.descriptor.description,
      labels: options.descriptor.labels.map((label) => ({
        key: label.key,
        valueType: "STRING",
        description: label.description,
      })),
    },
  });
  if (!create.response.ok && create.response.status !== 409) {
    const text = await create.response.text().catch(() => "");
    throw new Error(
      `Monitoring metric descriptor create failed (${create.response.status}): ${text.slice(0, 500)}`,
    );
  }
  ensuredTypes.add(options.descriptor.type);
}

export type SparkMetricPointWrite = {
  readonly metricType: SparkMetricType;
  readonly value: number;
  readonly metricLabels?: Record<string, string | undefined>;
  readonly timestamp?: Date | string;
  readonly job?: string;
  readonly taskId?: string;
  readonly namespace?: string;
  readonly location?: string;
};

function toMonitoringTimestamp(value: Date | string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function toDoubleValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function buildTimeSeriesRequestBody(
  serviceAccountJson: string,
  points: readonly SparkMetricPointWrite[],
): { timeSeries: Array<Record<string, unknown>> } {
  const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
  return {
    timeSeries: points.map((point) => {
      const descriptor = SPARK_MONITORING_METRIC_DESCRIPTOR_MAP.get(point.metricType);
      if (!descriptor) {
        throw new Error(`Unknown Spark metric type: ${point.metricType}`);
      }
      const labels: Record<string, string> = {};
      for (const label of descriptor.labels) {
        labels[label.key] = sanitizeMetricLabelValue(
          point.metricLabels?.[label.key],
        );
      }
      return {
        metric: {
          type: point.metricType,
          labels,
        },
        resource: {
          type: "generic_task",
          labels: {
            project_id: serviceAccount.projectId,
            location: sanitizeGenericTaskLabel(
              point.location,
              resolveMonitoringLocation(),
            ),
            namespace: sanitizeGenericTaskLabel(
              point.namespace,
              DEFAULT_NAMESPACE,
            ),
            job: sanitizeGenericTaskLabel(point.job, DEFAULT_METRIC_JOB),
            task_id: sanitizeGenericTaskLabel(
              point.taskId,
              createSparkMetricTaskId("spark"),
            ),
          },
        },
        points: [
          {
            interval: {
              endTime: toMonitoringTimestamp(point.timestamp),
            },
            value: {
              doubleValue: toDoubleValue(point.value),
            },
          },
        ],
      };
    }),
  };
}

export async function writeSparkMetricPoints(options: {
  serviceAccountJson: string;
  points: readonly SparkMetricPointWrite[];
}): Promise<void> {
  if (options.points.length === 0) {
    return;
  }

  const uniqueMetricTypes = new Set<SparkMetricType>();
  for (const point of options.points) {
    uniqueMetricTypes.add(point.metricType);
  }
  for (const metricType of uniqueMetricTypes) {
    const descriptor = SPARK_MONITORING_METRIC_DESCRIPTOR_MAP.get(metricType);
    if (!descriptor) {
      throw new Error(`Unknown Spark metric type: ${metricType}`);
    }
    await ensureSparkMetricDescriptor({
      serviceAccountJson: options.serviceAccountJson,
      descriptor,
    });
  }

  for (let index = 0; index < options.points.length; index += 200) {
    const batch = options.points.slice(index, index + 200);
    const response = await fetchMonitoringApi({
      serviceAccountJson: options.serviceAccountJson,
      method: "POST",
      path: "timeSeries",
      body: buildTimeSeriesRequestBody(options.serviceAccountJson, batch),
    });
    if (!response.response.ok) {
      const text = await response.response.text().catch(() => "");
      throw new Error(
        `Monitoring timeSeries.create failed (${response.response.status}): ${text.slice(0, 500)}`,
      );
    }
  }
}

function getSparkMonitoringServiceAccountJsonFromEnv(): string | null {
  if (isTruthy(readEnvVar("SPARK_DISABLE_MONITORING_METRICS"))) {
    return null;
  }
  if (readEnvVar("NODE_ENV") === "test" || readEnvVar("VITEST").length > 0) {
    return null;
  }
  const raw = readEnvVar("GOOGLE_SERVICE_ACCOUNT_JSON").trim();
  if (raw.length === 0) {
    return null;
  }
  return raw;
}

export async function writeSparkMetricPointsFromEnv(
  points: readonly SparkMetricPointWrite[],
): Promise<void> {
  const serviceAccountJson = getSparkMonitoringServiceAccountJsonFromEnv();
  if (!serviceAccountJson || points.length === 0) {
    return;
  }
  try {
    await writeSparkMetricPoints({
      serviceAccountJson,
      points,
    });
  } catch (error) {
    console.warn(
      `[spark-monitoring] failed to write metrics: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type SparkMonitoringNumericPoint = {
  readonly metricType: string;
  readonly metricLabels: Record<string, string>;
  readonly resourceType: string;
  readonly resourceLabels: Record<string, string>;
  readonly recordedAt: string;
  readonly value: number;
};

function extractPointValue(value: {
  doubleValue?: number;
  int64Value?: string;
}): number | null {
  if (typeof value.doubleValue === "number" && Number.isFinite(value.doubleValue)) {
    return value.doubleValue;
  }
  if (typeof value.int64Value === "string") {
    const parsed = Number(value.int64Value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export async function listSparkMetricPoints(options: {
  serviceAccountJson: string;
  metricType: string;
  startTime: Date | string;
  endTime?: Date | string;
  extraFilter?: string;
  pageSize?: number;
}): Promise<SparkMonitoringNumericPoint[]> {
  const points: SparkMonitoringNumericPoint[] = [];
  const endTime = toMonitoringTimestamp(options.endTime);
  const startTime = toMonitoringTimestamp(options.startTime);
  let nextPageToken = "";
  do {
    const filterParts = [
      `metric.type = "${options.metricType}"`,
      'resource.type = "generic_task"',
      `resource.labels.namespace = "${DEFAULT_NAMESPACE}"`,
    ];
    if (options.extraFilter) {
      filterParts.push(options.extraFilter);
    }
    const response = await fetchMonitoringApi({
      serviceAccountJson: options.serviceAccountJson,
      path: "timeSeries",
      query: {
        filter: filterParts.join(" AND "),
        "interval.startTime": startTime,
        "interval.endTime": endTime,
        view: "FULL",
        pageSize: String(options.pageSize ?? 1000),
        ...(nextPageToken ? { pageToken: nextPageToken } : {}),
      },
    });
    if (!response.response.ok) {
      const monitoringError = await readMonitoringApiError(response.response);
      if (
        isMissingMetricTypeError({
          responseStatus: response.response.status,
          errorStatus: monitoringError.status,
          errorMessage: monitoringError.message,
        })
      ) {
        return [];
      }
      throw new Error(
        `Monitoring timeSeries.list failed (${response.response.status}): ${monitoringError.text.slice(0, 500)}`,
      );
    }
    const payload = MonitoringTimeSeriesListResponseSchema.parse(
      await response.response.json(),
    );
    for (const series of payload.timeSeries) {
      for (const point of series.points) {
        const value = extractPointValue(point.value);
        if (value === null) {
          continue;
        }
        points.push({
          metricType: series.metric.type,
          metricLabels: { ...(series.metric.labels ?? {}) },
          resourceType: series.resource.type,
          resourceLabels: { ...(series.resource.labels ?? {}) },
          recordedAt: point.interval.endTime,
          value,
        });
      }
    }
    nextPageToken = payload.nextPageToken ?? "";
  } while (nextPageToken.length > 0);

  points.sort((left, right) => {
    return (
      new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime()
    );
  });
  return points;
}

export function resolveSparkMetricProviderLabel(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("chatgpt-")) {
    return "chatgpt";
  }
  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3")
  ) {
    return "openai";
  }
  if (normalized.startsWith("gemini-")) {
    return "gemini";
  }
  if (
    normalized.startsWith("kimi-") ||
    normalized.startsWith("glm-") ||
    normalized.startsWith("minimax-") ||
    normalized.startsWith("gpt-oss-")
  ) {
    return "fireworks";
  }
  return "unknown";
}

export type SparkLlmCallMetricOptions = {
  readonly operation: string;
  readonly model: string;
  readonly provider?: string;
  readonly status: "ok" | "blocked" | "error";
  readonly latencyMs: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  readonly agentType?: string;
  readonly job?: string;
  readonly taskId?: string;
  readonly timestamp?: Date | string;
};

export async function publishSparkLlmCallMetricsFromEnv(
  options: SparkLlmCallMetricOptions,
): Promise<void> {
  const taskId = sanitizeGenericTaskLabel(
    options.taskId,
    createSparkMetricTaskId("llm-call"),
  );
  const metricLabels = {
    operation: options.operation,
    model: options.model,
    provider:
      options.provider ?? resolveSparkMetricProviderLabel(options.model),
    status: options.status,
    agent_type: options.agentType ?? DEFAULT_LABEL_VALUE,
  };
  const points: SparkMetricPointWrite[] = [
    {
      metricType: SPARK_MONITORING_METRIC_TYPES.llmCallLatencyMs,
      value: Math.max(0, options.latencyMs),
      metricLabels,
      job: options.job ?? DEFAULT_METRIC_JOB,
      taskId,
      timestamp: options.timestamp,
    },
  ];
  if (
    typeof options.totalTokens === "number" &&
    Number.isFinite(options.totalTokens) &&
    options.totalTokens >= 0
  ) {
    points.push({
      metricType: SPARK_MONITORING_METRIC_TYPES.llmCallTotalTokens,
      value: options.totalTokens,
      metricLabels,
      job: options.job ?? DEFAULT_METRIC_JOB,
      taskId,
      timestamp: options.timestamp,
    });
  }
  if (
    typeof options.costUsd === "number" &&
    Number.isFinite(options.costUsd) &&
    options.costUsd >= 0
  ) {
    points.push({
      metricType: SPARK_MONITORING_METRIC_TYPES.llmCallCostUsd,
      value: options.costUsd,
      metricLabels,
      job: options.job ?? DEFAULT_METRIC_JOB,
      taskId,
      timestamp: options.timestamp,
    });
  }
  await writeSparkMetricPointsFromEnv(points);
}

export type SparkToolLoopStepTimingMetrics = {
  readonly totalMs: number;
  readonly queueWaitMs: number;
  readonly connectionSetupMs: number;
  readonly activeGenerationMs: number;
  readonly toolExecutionMs: number;
  readonly waitToolMs: number;
  readonly schedulerDelayMs: number;
  readonly providerRetryDelayMs: number;
};

export async function publishSparkToolLoopStepMetricsFromEnv(options: {
  readonly operation: string;
  readonly model: string;
  readonly provider?: string;
  readonly status: "ok" | "blocked" | "error";
  readonly timings: SparkToolLoopStepTimingMetrics;
  readonly agentType?: string;
  readonly job?: string;
  readonly taskId?: string;
  readonly timestamp?: Date | string;
}): Promise<void> {
  const metricLabelsBase = {
    operation: options.operation,
    model: options.model,
    provider:
      options.provider ?? resolveSparkMetricProviderLabel(options.model),
    status: options.status,
    agent_type: options.agentType ?? DEFAULT_LABEL_VALUE,
  };
  const taskId = sanitizeGenericTaskLabel(
    options.taskId,
    createSparkMetricTaskId("tool-step"),
  );
  const phaseEntries = [
    ["total", options.timings.totalMs],
    ["queue_wait", options.timings.queueWaitMs],
    ["connection_setup", options.timings.connectionSetupMs],
    ["active_generation", options.timings.activeGenerationMs],
    ["tool_execution", options.timings.toolExecutionMs],
    ["wait_tool", options.timings.waitToolMs],
    ["scheduler_delay", options.timings.schedulerDelayMs],
    ["provider_retry_delay", options.timings.providerRetryDelayMs],
  ] as const;
  await writeSparkMetricPointsFromEnv(
    phaseEntries.map(([phase, value]) => ({
      metricType: SPARK_MONITORING_METRIC_TYPES.llmToolLoopStepLatencyMs,
      value: Math.max(0, value),
      metricLabels: {
        ...metricLabelsBase,
        phase,
      },
      job: options.job ?? "spark-task-runner",
      taskId,
      timestamp: options.timestamp,
    })),
  );
}

export async function publishSparkAgentRunMetricFromEnv(options: {
  readonly agentType: string;
  readonly status: "ok" | "error" | "stopped";
  readonly scope: "primary" | "subagent";
  readonly durationMs: number;
  readonly job?: string;
  readonly taskId?: string;
  readonly timestamp?: Date | string;
}): Promise<void> {
  await writeSparkMetricPointsFromEnv([
    {
      metricType: SPARK_MONITORING_METRIC_TYPES.agentRunDurationMs,
      value: Math.max(0, options.durationMs),
      metricLabels: {
        agent_type: options.agentType,
        status: options.status,
        scope: options.scope,
      },
      job: options.job ?? "spark-task-runner",
      taskId: options.taskId,
      timestamp: options.timestamp,
    },
  ]);
}

export async function publishSparkAgentProcessMetricsFromEnv(options: {
  readonly agentType: string;
  readonly status: "ok" | "error" | "stopped";
  readonly cpuUtilization: number;
  readonly cpuTimeMs: number;
  readonly rssPeakBytes: number;
  readonly job?: string;
  readonly taskId?: string;
  readonly timestamp?: Date | string;
}): Promise<void> {
  await writeSparkMetricPointsFromEnv([
    {
      metricType: SPARK_MONITORING_METRIC_TYPES.agentProcessCpuUtilization,
      value: Math.max(0, options.cpuUtilization),
      metricLabels: {
        agent_type: options.agentType,
        status: options.status,
      },
      job: options.job ?? "spark-task-runner",
      taskId: options.taskId,
      timestamp: options.timestamp,
    },
    {
      metricType: SPARK_MONITORING_METRIC_TYPES.agentProcessCpuTimeMs,
      value: Math.max(0, options.cpuTimeMs),
      metricLabels: {
        agent_type: options.agentType,
        status: options.status,
      },
      job: options.job ?? "spark-task-runner",
      taskId: options.taskId,
      timestamp: options.timestamp,
    },
    {
      metricType: SPARK_MONITORING_METRIC_TYPES.agentProcessRssPeakBytes,
      value: Math.max(0, options.rssPeakBytes),
      metricLabels: {
        agent_type: options.agentType,
        status: options.status,
      },
      job: options.job ?? "spark-task-runner",
      taskId: options.taskId,
      timestamp: options.timestamp,
    },
  ]);
}
