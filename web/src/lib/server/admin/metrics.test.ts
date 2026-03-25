import { afterEach, describe, expect, it, vi } from 'vitest';

const listSparkMetricPointsMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: {
		GOOGLE_SERVICE_ACCOUNT_JSON: '{"project_id":"test-project"}'
	}
}));

vi.mock('$lib/server/gcp/monitoring', () => ({
	SPARK_MONITORING_METRIC_TYPES: {
		llmCallLatencyMs: 'custom.googleapis.com/spark/llm/call_latency_ms',
		llmCallTotalTokens: 'custom.googleapis.com/spark/llm/call_total_tokens',
		llmCallCostUsd: 'custom.googleapis.com/spark/llm/call_cost_usd',
		llmToolLoopStepLatencyMs: 'custom.googleapis.com/spark/llm/tool_loop_step_latency_ms',
		agentRunDurationMs: 'custom.googleapis.com/spark/agent/run_duration_ms',
		agentProcessCpuUtilization: 'custom.googleapis.com/spark/agent/process_cpu_utilization',
		agentProcessRssPeakBytes: 'custom.googleapis.com/spark/agent/process_rss_peak_bytes'
	},
	listSparkMetricPoints: listSparkMetricPointsMock
}));

afterEach(() => {
	listSparkMetricPointsMock.mockReset();
	vi.resetModules();
});

describe('loadLlmMetricsDashboard', () => {
	it('includes chat and task-runner metrics instead of filtering to task-runner only', async () => {
		listSparkMetricPointsMock.mockImplementation(async ({ metricType, extraFilter }) => {
			if (metricType === 'custom.googleapis.com/spark/llm/tool_loop_step_latency_ms') {
				if (typeof extraFilter === 'string' && extraFilter.includes('resource.labels.job')) {
					return [
						{
							metricType,
							metricLabels: { phase: 'total' },
							resourceType: 'generic_task',
							resourceLabels: { job: 'spark-task-runner' },
							recordedAt: '2026-03-24T10:00:00.000Z',
							value: 120
						}
					];
				}
				return [
					{
						metricType,
						metricLabels: { phase: 'total' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-task-runner' },
						recordedAt: '2026-03-24T10:00:00.000Z',
						value: 120
					},
					{
						metricType,
						metricLabels: { phase: 'total' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-chat' },
						recordedAt: '2026-03-24T10:05:00.000Z',
						value: 80
					}
				];
			}

			if (metricType === 'custom.googleapis.com/spark/agent/run_duration_ms') {
				if (typeof extraFilter === 'string' && extraFilter.includes('resource.labels.job')) {
					return [
						{
							metricType,
							metricLabels: { agent_type: 'lesson', status: 'ok', scope: 'primary' },
							resourceType: 'generic_task',
							resourceLabels: { job: 'spark-task-runner' },
							recordedAt: '2026-03-24T10:00:00.000Z',
							value: 2_000
						}
					];
				}
				return [
					{
						metricType,
						metricLabels: { agent_type: 'lesson', status: 'ok', scope: 'primary' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-task-runner' },
						recordedAt: '2026-03-24T10:00:00.000Z',
						value: 2_000
					},
					{
						metricType,
						metricLabels: { agent_type: 'chat', status: 'ok', scope: 'primary' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-chat' },
						recordedAt: '2026-03-24T10:05:00.000Z',
						value: 500
					}
				];
			}

			if (metricType === 'custom.googleapis.com/spark/agent/process_cpu_utilization') {
				if (typeof extraFilter === 'string' && extraFilter.includes('resource.labels.job')) {
					return [
						{
							metricType,
							metricLabels: { agent_type: 'lesson', status: 'ok' },
							resourceType: 'generic_task',
							resourceLabels: { job: 'spark-task-runner' },
							recordedAt: '2026-03-24T10:00:00.000Z',
							value: 0.4
						}
					];
				}
				return [
					{
						metricType,
						metricLabels: { agent_type: 'lesson', status: 'ok' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-task-runner' },
						recordedAt: '2026-03-24T10:00:00.000Z',
						value: 0.4
					},
					{
						metricType,
						metricLabels: { agent_type: 'chat', status: 'ok' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-chat' },
						recordedAt: '2026-03-24T10:05:00.000Z',
						value: 0.2
					}
				];
			}

			if (metricType === 'custom.googleapis.com/spark/agent/process_rss_peak_bytes') {
				if (typeof extraFilter === 'string' && extraFilter.includes('resource.labels.job')) {
					return [
						{
							metricType,
							metricLabels: { agent_type: 'lesson', status: 'ok' },
							resourceType: 'generic_task',
							resourceLabels: { job: 'spark-task-runner' },
							recordedAt: '2026-03-24T10:00:00.000Z',
							value: 2_048
						}
					];
				}
				return [
					{
						metricType,
						metricLabels: { agent_type: 'lesson', status: 'ok' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-task-runner' },
						recordedAt: '2026-03-24T10:00:00.000Z',
						value: 2_048
					},
					{
						metricType,
						metricLabels: { agent_type: 'chat', status: 'ok' },
						resourceType: 'generic_task',
						resourceLabels: { job: 'spark-chat' },
						recordedAt: '2026-03-24T10:05:00.000Z',
						value: 1_024
					}
				];
			}

			return [];
		});

		const { loadLlmMetricsDashboard } = await import('./metrics');
		const dashboard = await loadLlmMetricsDashboard('24h');

		expect(dashboard.overview.agentRunCount).toBe(2);
		expect(dashboard.stepPhases).toEqual([
			{
				phase: 'total',
				callCount: 2,
				averageLatencyMs: 100,
				p95LatencyMs: 118,
				maxLatencyMs: 120
			}
		]);
		expect(dashboard.agentTypes.map((row) => row.agentType)).toEqual(['chat', 'lesson']);
		expect(dashboard.agentTypes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentType: 'chat',
					runCount: 1,
					averageCpuUtilization: 0.2,
					peakRssBytes: 1_024
				}),
				expect.objectContaining({
					agentType: 'lesson',
					runCount: 1,
					averageCpuUtilization: 0.4,
					peakRssBytes: 2_048
				})
			])
		);
	});
});
