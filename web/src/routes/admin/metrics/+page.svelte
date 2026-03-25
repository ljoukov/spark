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
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Metrics</h1>
			<p class="text-sm text-muted-foreground">
				Cloud Monitoring-backed LLM and agent workload telemetry from Spark.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#each windowOptions as option}
				<Button
					href={`/admin/metrics?window=${option.key}`}
					variant={data.windowKey === option.key ? 'default' : 'outline'}
					size="sm"
				>
					{option.label}
				</Button>
			{/each}
			<Button href={`/admin/metrics/llm?window=${data.windowKey}`} variant="secondary" size="sm">
				Open LLM Detail
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
					P95 LLM latency
				</p>
				<p class="mt-2 text-2xl font-semibold">
					{formatLatency(data.dashboard.overview.p95LatencyMs)}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Average {formatLatency(data.dashboard.overview.averageLatencyMs)}
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
					P95 duration {formatLatency(data.dashboard.overview.p95AgentDurationMs)}
				</p>
			</div>
		</div>

		<div class="grid gap-4 xl:grid-cols-2">
			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header>
					<Card.Title>Top LLM operations</Card.Title>
					<Card.Description
						>Grouped over {data.dashboard.windowLabel.toLowerCase()}.</Card.Description
					>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#if data.dashboard.operations.length === 0}
						<p class="text-sm text-muted-foreground">No LLM call metrics in this window.</p>
					{:else}
						{#each data.dashboard.operations.slice(0, 5) as row}
							<div class="rounded-lg border border-border/70 bg-background/70 p-3">
								<div class="flex items-center justify-between gap-3">
									<p class="font-medium">{row.operation}</p>
									<p class="text-xs text-muted-foreground">{formatNumber(row.callCount)} calls</p>
								</div>
								<div class="mt-2 grid gap-2 text-sm md:grid-cols-3">
									<p>P95 {formatLatency(row.p95LatencyMs)}</p>
									<p>Tokens {formatNumber(row.totalTokens)}</p>
									<p>Cost {formatUsd(row.totalCostUsd)}</p>
								</div>
							</div>
						{/each}
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header>
					<Card.Title>Agent workload types</Card.Title>
					<Card.Description>
						Primary agent runs across chat and background jobs, grouped by agent category.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#if data.dashboard.agentTypes.length === 0}
						<p class="text-sm text-muted-foreground">No agent metrics in this window.</p>
					{:else}
						{#each data.dashboard.agentTypes.slice(0, 5) as row}
							<div class="rounded-lg border border-border/70 bg-background/70 p-3">
								<div class="flex items-center justify-between gap-3">
									<p class="font-medium capitalize">{row.agentType}</p>
									<p class="text-xs text-muted-foreground">{formatNumber(row.runCount)} runs</p>
								</div>
								<div class="mt-2 grid gap-2 text-sm md:grid-cols-3">
									<p>P95 {formatLatency(row.p95DurationMs)}</p>
									<p>CPU {formatPercent(row.averageCpuUtilization)}</p>
									<p>RSS peak {formatBytes(row.peakRssBytes)}</p>
								</div>
							</div>
						{/each}
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>
