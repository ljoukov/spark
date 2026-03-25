<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const windowOptions = [
		{ key: '1h', label: '1h' },
		{ key: '24h', label: '24h' },
		{ key: '7d', label: '7d' }
	] as const;

	function formatNumber(value: number | null | undefined, digits = 0): string {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '—';
		}
		return value.toLocaleString('en-GB', {
			maximumFractionDigits: digits,
			minimumFractionDigits: digits
		});
	}

	function formatLatency(value: number | null | undefined): string {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '—';
		}
		if (value >= 1000) {
			return `${formatNumber(value / 1000, 2)} s`;
		}
		return `${formatNumber(value, 0)} ms`;
	}

	function formatUsd(value: number | null | undefined): string {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '—';
		}
		return `$${formatNumber(value, 4)}`;
	}

	function formatPercent(value: number | null | undefined): string {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '—';
		}
		return `${formatNumber(value * 100, 1)}%`;
	}

	function formatBytes(value: number | null | undefined): string {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
			return '—';
		}
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let current = value;
		let unitIndex = 0;
		while (current >= 1024 && unitIndex < units.length - 1) {
			current /= 1024;
			unitIndex += 1;
		}
		return `${formatNumber(current, current >= 10 ? 1 : 2)} ${units[unitIndex]}`;
	}
</script>

<div class="space-y-6">
	<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">LLM Metrics</h1>
			<p class="text-sm text-muted-foreground">
				Latency, token, cost, and agent resource metrics sourced from Google Cloud Monitoring.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#each windowOptions as option}
				<Button
					href={`/admin/metrics/llm?window=${option.key}`}
					variant={data.windowKey === option.key ? 'default' : 'outline'}
					size="sm"
				>
					{option.label}
				</Button>
			{/each}
			<Button href={`/admin/metrics?window=${data.windowKey}`} variant="secondary" size="sm">
				Overview
			</Button>
		</div>
	</div>

	{#if data.error}
		<Card.Root>
			<Card.Header>
				<Card.Title>Metrics unavailable</Card.Title>
				<Card.Description>{data.error}</Card.Description>
			</Card.Header>
		</Card.Root>
	{:else if data.dashboard}
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
			<div class="rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">LLM calls</p>
				<p class="mt-2 text-2xl font-semibold">{formatNumber(data.dashboard.overview.callCount)}</p>
				<p class="mt-1 text-xs text-muted-foreground">{data.dashboard.windowLabel}</p>
			</div>
			<div class="rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Average latency
				</p>
				<p class="mt-2 text-2xl font-semibold">
					{formatLatency(data.dashboard.overview.averageLatencyMs)}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					P95 {formatLatency(data.dashboard.overview.p95LatencyMs)}
				</p>
			</div>
			<div class="rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Total tokens
				</p>
				<p class="mt-2 text-2xl font-semibold">
					{formatNumber(data.dashboard.overview.totalTokens)}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Cost {formatUsd(data.dashboard.overview.totalCostUsd)}
				</p>
			</div>
			<div class="rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Agent runs</p>
				<p class="mt-2 text-2xl font-semibold">
					{formatNumber(data.dashboard.overview.agentRunCount)}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					CPU {formatPercent(data.dashboard.overview.averageCpuUtilization)}
				</p>
			</div>
		</div>

		<div class="grid gap-4 xl:grid-cols-2">
			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header>
					<Card.Title>Operations</Card.Title>
					<Card.Description>Wrapper-level LLM calls grouped by operation.</Card.Description>
				</Card.Header>
				<Card.Content class="overflow-x-auto">
					<table class="min-w-full text-sm">
						<thead class="text-left text-xs tracking-wide text-muted-foreground uppercase">
							<tr>
								<th class="px-2 py-2">Operation</th>
								<th class="px-2 py-2">Calls</th>
								<th class="px-2 py-2">Errors</th>
								<th class="px-2 py-2">P95</th>
								<th class="px-2 py-2">Tokens</th>
								<th class="px-2 py-2">Cost</th>
							</tr>
						</thead>
						<tbody>
							{#if data.dashboard.operations.length === 0}
								<tr>
									<td class="px-2 py-3 text-muted-foreground" colspan="6">
										No LLM call metrics in this window.
									</td>
								</tr>
							{:else}
								{#each data.dashboard.operations as row}
									<tr class="border-t border-border/60">
										<td class="px-2 py-2 font-medium">{row.operation}</td>
										<td class="px-2 py-2">{formatNumber(row.callCount)}</td>
										<td class="px-2 py-2">{formatNumber(row.errorCount)}</td>
										<td class="px-2 py-2">{formatLatency(row.p95LatencyMs)}</td>
										<td class="px-2 py-2">{formatNumber(row.totalTokens)}</td>
										<td class="px-2 py-2">{formatUsd(row.totalCostUsd)}</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</Card.Content>
			</Card.Root>

			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header>
					<Card.Title>Models</Card.Title>
					<Card.Description>Requested model IDs grouped over the selected window.</Card.Description>
				</Card.Header>
				<Card.Content class="overflow-x-auto">
					<table class="min-w-full text-sm">
						<thead class="text-left text-xs tracking-wide text-muted-foreground uppercase">
							<tr>
								<th class="px-2 py-2">Model</th>
								<th class="px-2 py-2">Calls</th>
								<th class="px-2 py-2">P95</th>
								<th class="px-2 py-2">Tokens</th>
								<th class="px-2 py-2">Cost</th>
							</tr>
						</thead>
						<tbody>
							{#if data.dashboard.models.length === 0}
								<tr>
									<td class="px-2 py-3 text-muted-foreground" colspan="5">
										No model metrics in this window.
									</td>
								</tr>
							{:else}
								{#each data.dashboard.models as row}
									<tr class="border-t border-border/60">
										<td class="px-2 py-2 font-medium">{row.model}</td>
										<td class="px-2 py-2">{formatNumber(row.callCount)}</td>
										<td class="px-2 py-2">{formatLatency(row.p95LatencyMs)}</td>
										<td class="px-2 py-2">{formatNumber(row.totalTokens)}</td>
										<td class="px-2 py-2">{formatUsd(row.totalCostUsd)}</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</Card.Content>
			</Card.Root>
		</div>

		<div class="grid gap-4 xl:grid-cols-2">
			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header>
					<Card.Title>Tool-loop phases</Card.Title>
					<Card.Description>
						Per-step timing phases emitted by Spark agent tool loops across chat and background
						jobs.
					</Card.Description>
				</Card.Header>
				<Card.Content class="overflow-x-auto">
					<table class="min-w-full text-sm">
						<thead class="text-left text-xs tracking-wide text-muted-foreground uppercase">
							<tr>
								<th class="px-2 py-2">Phase</th>
								<th class="px-2 py-2">Samples</th>
								<th class="px-2 py-2">Average</th>
								<th class="px-2 py-2">P95</th>
								<th class="px-2 py-2">Max</th>
							</tr>
						</thead>
						<tbody>
							{#if data.dashboard.stepPhases.length === 0}
								<tr>
									<td class="px-2 py-3 text-muted-foreground" colspan="5">
										No tool-loop step metrics in this window.
									</td>
								</tr>
							{:else}
								{#each data.dashboard.stepPhases as row}
									<tr class="border-t border-border/60">
										<td class="px-2 py-2 font-medium">{row.phase}</td>
										<td class="px-2 py-2">{formatNumber(row.callCount)}</td>
										<td class="px-2 py-2">{formatLatency(row.averageLatencyMs)}</td>
										<td class="px-2 py-2">{formatLatency(row.p95LatencyMs)}</td>
										<td class="px-2 py-2">{formatLatency(row.maxLatencyMs)}</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</Card.Content>
			</Card.Root>

			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header>
					<Card.Title>Agent resource usage</Card.Title>
					<Card.Description>
						CPU and RSS summaries tagged by agent workload type across Spark jobs.
					</Card.Description>
				</Card.Header>
				<Card.Content class="overflow-x-auto">
					<table class="min-w-full text-sm">
						<thead class="text-left text-xs tracking-wide text-muted-foreground uppercase">
							<tr>
								<th class="px-2 py-2">Agent type</th>
								<th class="px-2 py-2">Runs</th>
								<th class="px-2 py-2">P95 duration</th>
								<th class="px-2 py-2">Avg CPU</th>
								<th class="px-2 py-2">P95 CPU</th>
								<th class="px-2 py-2">RSS peak</th>
							</tr>
						</thead>
						<tbody>
							{#if data.dashboard.agentTypes.length === 0}
								<tr>
									<td class="px-2 py-3 text-muted-foreground" colspan="6">
										No agent process metrics in this window.
									</td>
								</tr>
							{:else}
								{#each data.dashboard.agentTypes as row}
									<tr class="border-t border-border/60">
										<td class="px-2 py-2 font-medium capitalize">{row.agentType}</td>
										<td class="px-2 py-2">{formatNumber(row.runCount)}</td>
										<td class="px-2 py-2">{formatLatency(row.p95DurationMs)}</td>
										<td class="px-2 py-2">{formatPercent(row.averageCpuUtilization)}</td>
										<td class="px-2 py-2">{formatPercent(row.p95CpuUtilization)}</td>
										<td class="px-2 py-2">{formatBytes(row.peakRssBytes)}</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>
