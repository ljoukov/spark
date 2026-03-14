<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const logs = $derived(data.logs);
	const sortedLogs = $derived.by(() =>
		[...logs].sort((left, right) => right.timestamp.localeCompare(left.timestamp))
	);
	const logsError = $derived(data.logsError);
	const userId = $derived(data.userId);
	const agentId = $derived(data.agentId);
	const workspaceId = $derived(data.workspaceId);
	const source = $derived(data.source);
	const level = $derived(data.level);
	const limit = $derived(data.limit);
	const lookbackHours = $derived(data.lookbackHours);
	let expandedLogRows = $state<Record<string, boolean>>({});

	function formatInstant(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString();
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

	function getLogRowKey(
		entry: (typeof sortedLogs)[number],
		index: number
	): string {
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

	function toggleLogRow(key: string): void {
		expandedLogRows = {
			...expandedLogRows,
			[key]: !expandedLogRows[key]
		};
	}
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Logs</Card.Title>
			<Card.Description>
				Query Cloud Logging across Spark web logs, Cloud Run task logs, and Cloud Tasks queue
				operations.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<form method="GET" action="/admin/logs" class="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
				<div class="space-y-1">
					<label for="logs-user-id" class="text-xs font-medium text-muted-foreground">
						User ID
					</label>
					<Input
						id="logs-user-id"
						name="userId"
						value={userId}
						placeholder="Optional"
						autocomplete="off"
					/>
				</div>
				<div class="space-y-1">
					<label for="logs-agent-id" class="text-xs font-medium text-muted-foreground">
						Agent run ID
					</label>
					<Input
						id="logs-agent-id"
						name="agentId"
						value={agentId}
						placeholder="Optional"
						autocomplete="off"
					/>
				</div>
				<div class="space-y-1">
					<label for="logs-workspace-id" class="text-xs font-medium text-muted-foreground">
						Workspace ID
					</label>
					<Input
						id="logs-workspace-id"
						name="workspaceId"
						value={workspaceId}
						placeholder="Optional"
						autocomplete="off"
					/>
				</div>
				<div class="space-y-1">
					<label for="logs-source" class="text-xs font-medium text-muted-foreground">Source</label>
					<select
						id="logs-source"
						name="source"
						class="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
					>
						<option value="all" selected={source === 'all'}>All sources</option>
						<option value="web" selected={source === 'web'}>Web</option>
						<option value="cloud-run" selected={source === 'cloud-run'}>Cloud Run</option>
						<option value="cloud-run-request" selected={source === 'cloud-run-request'}>Cloud Run request</option>
						<option value="cloud-run-stdout" selected={source === 'cloud-run-stdout'}>Cloud Run stdout</option>
						<option value="cloud-run-stderr" selected={source === 'cloud-run-stderr'}>Cloud Run stderr</option>
						<option value="tasks-queue" selected={source === 'tasks-queue'}>Tasks queue</option>
					</select>
				</div>
				<div class="space-y-1">
					<label for="logs-level" class="text-xs font-medium text-muted-foreground">Level</label>
					<select
						id="logs-level"
						name="level"
						class="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
					>
						<option value="all" selected={level === 'all'}>All levels</option>
						<option value="DEFAULT" selected={level === 'DEFAULT'}>DEFAULT</option>
						<option value="INFO" selected={level === 'INFO'}>INFO</option>
						<option value="WARNING" selected={level === 'WARNING'}>WARNING</option>
						<option value="ERROR" selected={level === 'ERROR'}>ERROR</option>
					</select>
				</div>
				<div class="space-y-1">
					<label for="logs-limit" class="text-xs font-medium text-muted-foreground">Limit</label>
					<Input id="logs-limit" name="limit" type="number" min="1" max="200" value={limit} />
				</div>
				<div class="space-y-1">
					<label for="logs-lookback" class="text-xs font-medium text-muted-foreground">
						Lookback hours
					</label>
					<Input
						id="logs-lookback"
						name="lookbackHours"
						type="number"
						min="1"
						max="168"
						value={lookbackHours}
					/>
				</div>
				<div class="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-7">
					<Button type="submit">Refresh</Button>
					<a
						href="/admin/logs"
						class={cn(buttonVariants({ variant: 'secondary' }))}
					>
						Clear filters
					</a>
				</div>
			</form>

			<p class="text-xs text-muted-foreground">
				Showing the newest {limit} entries from the last {lookbackHours} hour{lookbackHours === 1 ? '' : 's'}.
			</p>
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Results</Card.Title>
			<Card.Description>
				Loaded {sortedLogs.length} log entr{sortedLogs.length === 1 ? 'y' : 'ies'} at {formatInstant(data.loadedAt)}.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if logsError}
				<p
					class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{logsError}
				</p>
			{:else if sortedLogs.length === 0}
				<p class="text-sm text-muted-foreground">No logs matched the current filters.</p>
			{:else}
				<div class="overflow-x-auto rounded-xl border border-border/70 bg-background/60">
					<table class="min-w-full w-max border-collapse text-xs">
						<thead class="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
							<tr>
								<th class="w-10 px-2 py-2 font-medium whitespace-nowrap"></th>
								<th class="w-44 px-3 py-2 font-medium whitespace-nowrap">Time</th>
								<th class="px-3 py-2 font-medium whitespace-nowrap">Source</th>
								<th class="px-3 py-2 font-medium whitespace-nowrap">Level</th>
								<th class="px-3 py-2 font-medium whitespace-nowrap">User</th>
								<th class="px-3 py-2 font-medium whitespace-nowrap">Agent</th>
								<th class="px-3 py-2 font-medium whitespace-nowrap">Workspace</th>
								<th class="px-3 py-2 font-medium">Message</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedLogs as entry, index (getLogRowKey(entry, index))}
								{@const rowKey = getLogRowKey(entry, index)}
								{@const compactMessage = compactLogText(entry.message, entry.requestUrl)}
								{@const fullMessage = expandedLogText(entry.message, entry.requestUrl)}
								{@const expanded = expandedLogRows[rowKey] === true}
								<tr class="border-t border-border/60 align-top">
									<td class="px-2 py-2 whitespace-nowrap text-center">
										<button
											type="button"
											class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
											aria-label={expanded ? 'Collapse log row' : 'Expand log row'}
											aria-expanded={expanded}
											onclick={() => {
												toggleLogRow(rowKey);
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
										{formatInstant(entry.timestamp)}
									</td>
									<td class="px-3 py-2 whitespace-nowrap">
										<span class="inline-flex rounded-full bg-muted px-2 py-0.5 font-medium uppercase">
											{entry.source}
										</span>
									</td>
									<td class="px-3 py-2 whitespace-nowrap">
										<span class="inline-flex rounded-full bg-muted px-2 py-0.5 font-medium uppercase">
											{entry.httpStatus !== null ? `${entry.severity} · ${entry.httpStatus}` : entry.severity}
										</span>
									</td>
									<td class="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
										{entry.userId ?? '—'}
									</td>
									<td class="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
										{entry.agentId ?? '—'}
									</td>
									<td class="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
										{entry.workspaceId ?? '—'}
									</td>
									<td class="px-3 py-2 font-mono text-[11px]">
										{#if !expanded}
											<span class="whitespace-nowrap">{truncateMessage(compactMessage)}</span>
										{/if}
									</td>
								</tr>
								{#if expanded}
									<tr class="border-t border-border/40 bg-muted/10 align-top">
										<td class="px-2 py-2"></td>
										<td colspan="7" class="px-3 py-2">
											<pre class="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{fullMessage}</pre>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
