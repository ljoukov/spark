<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatRelativeAge } from '$lib/utils/relativeAge';
	import type { PageData } from './$types';

	type BuildField = {
		label: string;
		value: string;
		mono?: boolean;
	};

	let { data }: { data: PageData } = $props();

	const buildFields = $derived(buildRows(data.uiBuildInfo));

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

	function buildRows(build: PageData['uiBuildInfo']): BuildField[] {
		const rows: BuildField[] = [
			{ label: 'Build ID', value: build.buildId, mono: true },
			{ label: 'Built', value: formatInstant(build.builtAt) },
			{ label: 'Age', value: formatRelativeAge(build.builtAt, { now: new Date(data.loadedAt) }) },
			{ label: 'Platform', value: build.platform },
			{ label: 'Runtime', value: build.runtime },
			{ label: 'Runtime version', value: build.runtimeVersion ?? '—', mono: Boolean(build.runtimeVersion) },
			{ label: 'Commit', value: formatCommit(build.gitCommitSha), mono: Boolean(build.gitCommitSha) },
			{ label: 'Branch', value: build.gitBranch ?? '—' },
			{ label: 'Provider build', value: build.providerBuildId ?? '—', mono: Boolean(build.providerBuildId) },
			{ label: 'Revision', value: build.providerRevision ?? '—', mono: Boolean(build.providerRevision) }
		];

		if (build.deploymentUrl) {
			rows.push({
				label: 'Deployment URL',
				value: build.deploymentUrl,
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
			Current admin binary, deployment metadata, and live runtime details.
		</p>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Current build</Card.Title>
			<Card.Description>
				Use the sidebar for tools. This page stays focused on what is actually deployed.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each buildFields as field}
				<div class="space-y-1 rounded-md border bg-background/70 p-3">
					<p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						{field.label}
					</p>
					<p class={`text-sm ${field.mono ? 'break-all font-mono text-xs' : ''}`}>
						{field.value}
					</p>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
