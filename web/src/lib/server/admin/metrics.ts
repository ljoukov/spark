import { env } from '$env/dynamic/private';
import {
	listSparkMetricPoints,
	SPARK_MONITORING_METRIC_TYPES,
	type SparkMonitoringNumericPoint
} from '$lib/server/gcp/monitoring';
import { z } from 'zod';

export const MetricsWindowSchema = z.enum(['1h', '24h', '7d']);

export type MetricsWindowKey = z.infer<typeof MetricsWindowSchema>;

export const METRICS_WINDOWS: Record<
	MetricsWindowKey,
	{ label: string; durationMs: number; shortLabel: string }
> = {
	'1h': {
		label: 'Last hour',
		durationMs: 60 * 60 * 1000,
		shortLabel: '1h'
	},
	'24h': {
		label: 'Last 24 hours',
		durationMs: 24 * 60 * 60 * 1000,
		shortLabel: '24h'
	},
	'7d': {
		label: 'Last 7 days',
		durationMs: 7 * 24 * 60 * 60 * 1000,
		shortLabel: '7d'
	}
};

type NumericSummary = {
	count: number;
	sum: number;
	average: number | null;
	p50: number | null;
	p95: number | null;
	max: number | null;
};

type LlmGroupSummary = {
	key: string;
	callCount: number;
	okCount: number;
	blockedCount: number;
	errorCount: number;
	averageLatencyMs: number | null;
	p95LatencyMs: number | null;
	maxLatencyMs: number | null;
	totalTokens: number;
	totalCostUsd: number;
};

type AgentTypeSummary = {
	agentType: string;
	runCount: number;
	okCount: number;
	stoppedCount: number;
	errorCount: number;
	averageDurationMs: number | null;
	p95DurationMs: number | null;
	averageCpuUtilization: number | null;
	p95CpuUtilization: number | null;
	peakRssBytes: number | null;
	p95RssBytes: number | null;
};

export type MetricsOverview = {
	callCount: number;
	totalTokens: number;
	totalCostUsd: number;
	averageLatencyMs: number | null;
	p95LatencyMs: number | null;
	agentRunCount: number;
	averageAgentDurationMs: number | null;
	p95AgentDurationMs: number | null;
	averageCpuUtilization: number | null;
	peakRssBytes: number | null;
};

export type LlmMetricsDashboard = {
	windowKey: MetricsWindowKey;
	windowLabel: string;
	loadedAt: string;
	overview: MetricsOverview;
	operations: Array<LlmGroupSummary & { operation: string }>;
	models: Array<LlmGroupSummary & { model: string }>;
	stepPhases: Array<{
		phase: string;
		callCount: number;
		averageLatencyMs: number | null;
		p95LatencyMs: number | null;
		maxLatencyMs: number | null;
	}>;
	agentTypes: AgentTypeSummary[];
};

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
	if (value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

export function resolveMetricsWindow(url: URL): MetricsWindowKey {
	const parsed = MetricsWindowSchema.safeParse(url.searchParams.get('window') ?? '24h');
	return parsed.success ? parsed.data : '24h';
}

function buildWindowStart(windowKey: MetricsWindowKey, now = new Date()): Date {
	return new Date(now.getTime() - METRICS_WINDOWS[windowKey].durationMs);
}

function metricLabel(point: SparkMonitoringNumericPoint, key: string, fallback = 'n/a'): string {
	const value = point.metricLabels[key];
	if (!value || value.trim().length === 0) {
		return fallback;
	}
	return value;
}

function summarizeValues(values: number[]): NumericSummary {
	if (values.length === 0) {
		return {
			count: 0,
			sum: 0,
			average: null,
			p50: null,
			p95: null,
			max: null
		};
	}

	const sorted = values
		.filter((value) => Number.isFinite(value))
		.slice()
		.sort((left, right) => left - right);
	const sum = sorted.reduce((total, value) => total + value, 0);
	const max = sorted[sorted.length - 1] ?? null;
	return {
		count: sorted.length,
		sum,
		average: sum / sorted.length,
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		max
	};
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
	if (sortedValues.length === 0) {
		return null;
	}
	if (sortedValues.length === 1) {
		return sortedValues[0] ?? null;
	}
	const targetIndex = (sortedValues.length - 1) * percentileValue;
	const lowerIndex = Math.floor(targetIndex);
	const upperIndex = Math.ceil(targetIndex);
	const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? null;
	const upper = sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1] ?? null;
	if (lower === null || upper === null) {
		return null;
	}
	if (lowerIndex === upperIndex) {
		return lower;
	}
	const weight = targetIndex - lowerIndex;
	return lower + (upper - lower) * weight;
}

function createLlmGroupSummary(options: {
	key: string;
	latencyPoints: SparkMonitoringNumericPoint[];
	tokenPoints: SparkMonitoringNumericPoint[];
	costPoints: SparkMonitoringNumericPoint[];
}): LlmGroupSummary {
	const latencyValues = options.latencyPoints.map((point) => point.value);
	const latencySummary = summarizeValues(latencyValues);
	return {
		key: options.key,
		callCount: options.latencyPoints.length,
		okCount: options.latencyPoints.filter((point) => metricLabel(point, 'status') === 'ok').length,
		blockedCount: options.latencyPoints.filter((point) => metricLabel(point, 'status') === 'blocked')
			.length,
		errorCount: options.latencyPoints.filter((point) => metricLabel(point, 'status') === 'error').length,
		averageLatencyMs: latencySummary.average,
		p95LatencyMs: latencySummary.p95,
		maxLatencyMs: latencySummary.max,
		totalTokens: options.tokenPoints.reduce((total, point) => total + point.value, 0),
		totalCostUsd: options.costPoints.reduce((total, point) => total + point.value, 0)
	};
}

function groupByLabel(
	points: SparkMonitoringNumericPoint[],
	labelName: string
): Map<string, SparkMonitoringNumericPoint[]> {
	const grouped = new Map<string, SparkMonitoringNumericPoint[]>();
	for (const point of points) {
		const key = metricLabel(point, labelName);
		const group = grouped.get(key);
		if (group) {
			group.push(point);
		} else {
			grouped.set(key, [point]);
		}
	}
	return grouped;
}

function buildAgentTypeSummary(options: {
	agentType: string;
	durationPoints: SparkMonitoringNumericPoint[];
	cpuPoints: SparkMonitoringNumericPoint[];
	rssPoints: SparkMonitoringNumericPoint[];
}): AgentTypeSummary {
	const durationSummary = summarizeValues(options.durationPoints.map((point) => point.value));
	const cpuSummary = summarizeValues(options.cpuPoints.map((point) => point.value));
	const rssSummary = summarizeValues(options.rssPoints.map((point) => point.value));
	return {
		agentType: options.agentType,
		runCount: options.durationPoints.length,
		okCount: options.durationPoints.filter((point) => metricLabel(point, 'status') === 'ok').length,
		stoppedCount: options.durationPoints.filter((point) => metricLabel(point, 'status') === 'stopped')
			.length,
		errorCount: options.durationPoints.filter((point) => metricLabel(point, 'status') === 'error').length,
		averageDurationMs: durationSummary.average,
		p95DurationMs: durationSummary.p95,
		averageCpuUtilization: cpuSummary.average,
		p95CpuUtilization: cpuSummary.p95,
		peakRssBytes: rssSummary.max,
		p95RssBytes: rssSummary.p95
	};
}

export async function loadLlmMetricsDashboard(windowKey: MetricsWindowKey): Promise<LlmMetricsDashboard> {
	const serviceAccountJson = requireServiceAccountJson();
	const loadedAt = new Date();
	const startTime = buildWindowStart(windowKey, loadedAt);
	const taskRunnerFilter = 'resource.labels.job = "spark-task-runner"';
	const primaryScopeFilter = 'metric.labels.scope = "primary"';

	const [
		callLatencyPoints,
		callTokenPoints,
		callCostPoints,
		stepLatencyPoints,
		agentRunDurationPoints,
		agentCpuPoints,
		agentRssPoints
	] = await Promise.all([
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.llmCallLatencyMs,
			startTime
		}),
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.llmCallTotalTokens,
			startTime
		}),
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.llmCallCostUsd,
			startTime
		}),
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.llmToolLoopStepLatencyMs,
			startTime,
			extraFilter: taskRunnerFilter
		}),
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.agentRunDurationMs,
			startTime,
			extraFilter: `${taskRunnerFilter} AND ${primaryScopeFilter}`
		}),
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.agentProcessCpuUtilization,
			startTime,
			extraFilter: taskRunnerFilter
		}),
		listSparkMetricPoints({
			serviceAccountJson,
			metricType: SPARK_MONITORING_METRIC_TYPES.agentProcessRssPeakBytes,
			startTime,
			extraFilter: taskRunnerFilter
		})
	]);

	const operationKeys = new Set<string>(callLatencyPoints.map((point) => metricLabel(point, 'operation')));
	const operations = Array.from(operationKeys)
		.map((operation) =>
			createLlmGroupSummary({
				key: operation,
				latencyPoints: callLatencyPoints.filter((point) => metricLabel(point, 'operation') === operation),
				tokenPoints: callTokenPoints.filter((point) => metricLabel(point, 'operation') === operation),
				costPoints: callCostPoints.filter((point) => metricLabel(point, 'operation') === operation)
			})
		)
		.map((summary) => ({ ...summary, operation: summary.key }))
		.sort((left, right) => right.callCount - left.callCount || left.operation.localeCompare(right.operation));

	const modelKeys = new Set<string>(callLatencyPoints.map((point) => metricLabel(point, 'model')));
	const models = Array.from(modelKeys)
		.map((model) =>
			createLlmGroupSummary({
				key: model,
				latencyPoints: callLatencyPoints.filter((point) => metricLabel(point, 'model') === model),
				tokenPoints: callTokenPoints.filter((point) => metricLabel(point, 'model') === model),
				costPoints: callCostPoints.filter((point) => metricLabel(point, 'model') === model)
			})
		)
		.map((summary) => ({ ...summary, model: summary.key }))
		.sort((left, right) => right.callCount - left.callCount || left.model.localeCompare(right.model));

	const stepPhases = Array.from(groupByLabel(stepLatencyPoints, 'phase').entries())
		.map(([phase, points]) => {
			const summary = summarizeValues(points.map((point) => point.value));
			return {
				phase,
				callCount: points.length,
				averageLatencyMs: summary.average,
				p95LatencyMs: summary.p95,
				maxLatencyMs: summary.max
			};
		})
		.sort((left, right) => right.callCount - left.callCount || left.phase.localeCompare(right.phase));

	const agentTypeKeys = new Set<string>([
		...agentRunDurationPoints.map((point) => metricLabel(point, 'agent_type')),
		...agentCpuPoints.map((point) => metricLabel(point, 'agent_type')),
		...agentRssPoints.map((point) => metricLabel(point, 'agent_type'))
	]);
	const agentTypes = Array.from(agentTypeKeys)
		.map((agentType) =>
			buildAgentTypeSummary({
				agentType,
				durationPoints: agentRunDurationPoints.filter(
					(point) => metricLabel(point, 'agent_type') === agentType
				),
				cpuPoints: agentCpuPoints.filter((point) => metricLabel(point, 'agent_type') === agentType),
				rssPoints: agentRssPoints.filter((point) => metricLabel(point, 'agent_type') === agentType)
			})
		)
		.sort((left, right) => right.runCount - left.runCount || left.agentType.localeCompare(right.agentType));

	const latencySummary = summarizeValues(callLatencyPoints.map((point) => point.value));
	const durationSummary = summarizeValues(agentRunDurationPoints.map((point) => point.value));
	const cpuSummary = summarizeValues(agentCpuPoints.map((point) => point.value));
	const rssSummary = summarizeValues(agentRssPoints.map((point) => point.value));

	return {
		windowKey,
		windowLabel: METRICS_WINDOWS[windowKey].label,
		loadedAt: loadedAt.toISOString(),
		overview: {
			callCount: callLatencyPoints.length,
			totalTokens: callTokenPoints.reduce((total, point) => total + point.value, 0),
			totalCostUsd: callCostPoints.reduce((total, point) => total + point.value, 0),
			averageLatencyMs: latencySummary.average,
			p95LatencyMs: latencySummary.p95,
			agentRunCount: agentRunDurationPoints.length,
			averageAgentDurationMs: durationSummary.average,
			p95AgentDurationMs: durationSummary.p95,
			averageCpuUtilization: cpuSummary.average,
			peakRssBytes: rssSummary.max
		},
		operations,
		models,
		stepPhases,
		agentTypes
	};
}
