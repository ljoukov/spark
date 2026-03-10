<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { formatRelativeAge } from '$lib/utils/relativeAge';
	import type { ActionData, PageData } from './$types';

	type BuildDetails = PageData['uiBuildInfo'];
	type BuildField = {
		label: string;
		value: string;
		mono?: boolean;
	};

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	const successMessage = $derived(form?.success?.message ?? '');
	const hasSuccess = $derived(Boolean(successMessage));
	const errorMessage = $derived(form?.error ?? '');
	const uiBuildInfo = $derived(data.uiBuildInfo);
	const taskRunnerInfo = $derived.by(() => {
		if (!form || !('taskRunnerInfo' in form)) {
			return null;
		}
		return form.taskRunnerInfo ?? null;
	});
	const buildsMatch = $derived.by(() => {
		if (!taskRunnerInfo) {
			return null;
		}
		return taskRunnerInfo.build.buildId === uiBuildInfo.buildId;
	});
	const uiBuildFields = $derived(buildRows(uiBuildInfo));
	const taskRunnerBuildFields = $derived.by(() =>
		taskRunnerInfo ? buildRows(taskRunnerInfo.build, taskRunnerInfo.endpointUrl) : []
	);

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

	function buildRows(build: BuildDetails, endpointUrl?: string): BuildField[] {
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

<div class="mx-auto w-full max-w-4xl">
	<Card.Root>
		<Card.Header>
			<Card.Title>Tasks</Card.Title>
			<Card.Description>Fire background jobs in the Spark task queue.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if hasSuccess}
				<p
					class="rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
				>
					{successMessage}
				</p>
			{:else if errorMessage}
				<p
					class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{errorMessage}
				</p>
			{/if}

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-lg border bg-muted/30 p-4">
					<div class="space-y-1">
						<p class="text-sm font-medium text-muted-foreground">Admin UI build</p>
						<p class="text-xs text-muted-foreground/80">
							Build metadata embedded into this web binary at build time.
						</p>
					</div>
					<div class="mt-4 grid gap-3 sm:grid-cols-2">
						{#each uiBuildFields as field}
							<div class="space-y-1 rounded-md border bg-background/70 p-3">
								<p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									{field.label}
								</p>
								<p class={`text-sm ${field.mono ? 'break-all font-mono text-xs' : ''}`}>
									{field.value}
								</p>
							</div>
						{/each}
					</div>
				</div>

				<div class="rounded-lg border bg-muted/30 p-4">
					<div class="space-y-1">
						<p class="text-sm font-medium text-muted-foreground">Task runner build</p>
						<p class="text-xs text-muted-foreground/80">
							Fetches `/api/internal/tasks/info` from the configured task service using the same
							Bearer token as queued tasks.
						</p>
					</div>
					<form method="POST" action="?/fetchTaskRunnerInfo" class="mt-4">
						<Button type="submit">Retrieve build info</Button>
					</form>

					{#if taskRunnerInfo}
						{#if buildsMatch === true}
							<p
								class="mt-4 rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
							>
								Task runner matches this admin UI build.
							</p>
						{:else if buildsMatch === false}
							<p
								class="mt-4 rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
							>
								Task runner is serving a different build than this admin UI.
							</p>
						{/if}

						<div class="mt-4 grid gap-3 sm:grid-cols-2">
							{#each taskRunnerBuildFields as field}
								<div class="space-y-1 rounded-md border bg-background/70 p-3">
									<p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
										{field.label}
									</p>
									<p class={`text-sm ${field.mono ? 'break-all font-mono text-xs' : ''}`}>
										{field.value}
									</p>
								</div>
							{/each}
						</div>
					{:else}
						<p class="mt-4 text-sm text-muted-foreground">
							No task runner response yet.
						</p>
					{/if}
				</div>
			</div>

			<div class="rounded-lg border bg-muted/30 p-4">
				<form
					method="POST"
					action="?/startHelloWorld"
					class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
				>
					<div class="space-y-1">
						<p class="text-sm font-medium text-muted-foreground">Hello World</p>
						<p class="text-xs text-muted-foreground/80">
							Queues a helloWorld task that logs "Hello World" on the server.
						</p>
					</div>
					<Button type="submit" class="md:w-auto">Run task</Button>
				</form>
			</div>

			<div class="rounded-lg border bg-muted/30 p-4">
				<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div class="space-y-1">
						<p class="text-sm font-medium text-muted-foreground">Generate welcome session</p>
						<p class="text-xs text-muted-foreground/80">
							Creates a new welcome template for learners from a topic. The task generates plan,
							quizzes, coding problems, and story media in the background.
						</p>
					</div>
					<form
						method="POST"
						action="?/startWelcomeSession"
						class="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center"
					>
						<label class="sr-only" for="welcome-topic">Topic</label>
						<Input
							id="welcome-topic"
							name="topic"
							placeholder="e.g. Dynamic programming basics"
							required
							class="md:w-72"
						/>
						<Button type="submit" class="md:w-auto">Run task</Button>
					</form>
				</div>
			</div>
		</Card.Content>
	</Card.Root>
</div>
