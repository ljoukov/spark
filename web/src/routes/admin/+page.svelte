<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatRelativeAge } from '$lib/utils/relativeAge';
	import type { PageData } from './$types';

	type BuildField = {
		label: string;
		value: string;
		mono?: boolean;
	};
	type BuildComparison = 'commit-match' | 'build-match' | 'commit-mismatch' | 'build-mismatch';

	let { data }: { data: PageData } = $props();

	const uiBuildFields = $derived(buildRows(data.uiBuildInfo));
	const taskRunnerInfo = $derived(data.taskRunnerInfo);
	const taskRunnerInfoError = $derived(data.taskRunnerInfoError);
	const taskRunnerBuildFields = $derived.by(() => {
		if (!taskRunnerInfo) {
			return [];
		}

		return buildRows(taskRunnerInfo.build, taskRunnerInfo.endpointUrl);
	});
	const buildComparison = $derived.by((): BuildComparison | null => {
		if (!taskRunnerInfo) {
			return null;
		}

		const taskRunnerCommit = taskRunnerInfo.build.gitCommitSha?.trim() ?? '';
		const uiCommit = data.uiBuildInfo.gitCommitSha?.trim() ?? '';
		if (taskRunnerCommit && uiCommit) {
			return taskRunnerCommit === uiCommit ? 'commit-match' : 'commit-mismatch';
		}

		return taskRunnerInfo.build.buildId === data.uiBuildInfo.buildId
			? 'build-match'
			: 'build-mismatch';
	});

	function formatInstant(value: string | null | undefined): string {
		if (!value) {
			return '—';
		}

		const instant = new Date(value);
		if (Number.isNaN(instant.getTime())) {
			return value;
		}

		return instant.toISOString().replace('.000Z', 'Z').replace('T', ' ');
	}

	function formatCommit(value: string | null | undefined): string {
		if (!value) {
			return '—';
		}

		return value.length > 12 ? value.slice(0, 12) : value;
	}

	function buildRows(build: PageData['uiBuildInfo'], endpointUrl?: string): BuildField[] {
		const rows: BuildField[] = [
			{ label: 'Build ID', value: build.buildId, mono: true },
			{ label: 'Built', value: formatInstant(build.builtAt) },
			{ label: 'Age', value: formatRelativeAge(build.builtAt, { now: new Date(data.loadedAt) }) },
			{ label: 'Platform', value: build.platform },
			{ label: 'Runtime', value: build.runtime },
			{
				label: 'Runtime version',
				value: build.runtimeVersion ?? '—',
				mono: Boolean(build.runtimeVersion)
			},
			{
				label: 'Commit',
				value: formatCommit(build.gitCommitSha),
				mono: Boolean(build.gitCommitSha)
			},
			{ label: 'Branch', value: build.gitBranch ?? '—' },
			{
				label: 'Provider build',
				value: build.providerBuildId ?? '—',
				mono: Boolean(build.providerBuildId)
			},
			{
				label: 'Revision',
				value: build.providerRevision ?? '—',
				mono: Boolean(build.providerRevision)
			}
		];

		if (build.deploymentUrl) {
			rows.push({
				label: 'Deployment URL',
				value: build.deploymentUrl,
				mono: true
			});
		}

		if (endpointUrl) {
			rows.push({
				label: 'Endpoint',
				value: endpointUrl,
				mono: true
			});
		}

		return rows;
	}
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">Build</h1>
		<p class="text-sm text-muted-foreground">
			Current admin binary, task runner build status, deployment metadata, and live runtime details.
		</p>
	</div>

	<div class="grid gap-4 xl:grid-cols-2">
		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header>
				<Card.Title>Admin UI build</Card.Title>
				<Card.Description>
					Build metadata embedded into this web binary at build time.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3 md:grid-cols-2">
				{#each uiBuildFields as field}
					<div class="space-y-1 rounded-md border bg-background/70 p-3">
						<p class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
							{field.label}
						</p>
						<p class={`text-sm ${field.mono ? 'font-mono text-xs break-all' : ''}`}>
							{field.value}
						</p>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header>
				<Card.Title>Task runner build</Card.Title>
				<Card.Description>
					Automatically fetched from `/api/internal/tasks/info` using the configured task service
					credentials.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if taskRunnerInfo}
					{#if buildComparison === 'commit-match'}
						<p
							class="rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
						>
							Task runner matches this admin UI commit.
						</p>
					{:else if buildComparison === 'build-match'}
						<p
							class="rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
						>
							Task runner matches this admin UI build.
						</p>
					{:else if buildComparison === 'commit-mismatch'}
						<p
							class="rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
						>
							Task runner is serving a different commit than this admin UI.
						</p>
					{:else if buildComparison === 'build-mismatch'}
						<p
							class="rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
						>
							Task runner is serving a different build than this admin UI.
						</p>
					{/if}

					<div class="grid gap-3 md:grid-cols-2">
						{#each taskRunnerBuildFields as field}
							<div class="space-y-1 rounded-md border bg-background/70 p-3">
								<p class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
									{field.label}
								</p>
								<p class={`text-sm ${field.mono ? 'font-mono text-xs break-all' : ''}`}>
									{field.value}
								</p>
							</div>
						{/each}
					</div>
				{:else if taskRunnerInfoError}
					<p
						class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						Automatic fetch failed: {taskRunnerInfoError}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">Task runner build info unavailable.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
