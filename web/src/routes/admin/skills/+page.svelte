<script lang="ts">
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	type ViewMode = 'rendered' | 'raw';
	type SkillId = PageData['skills'][number]['id'];

	let { data }: { data: PageData } = $props();

	let selectedSkillId = $state<SkillId | null>(null);
	let viewMode = $state<ViewMode>('rendered');

	$effect(() => {
		if (selectedSkillId === null && data.skills[0]) {
			selectedSkillId = data.skills[0].id;
		}
	});

	const selectedSkill = $derived.by(() => {
		return data.skills.find((skill) => skill.id === selectedSkillId) ?? data.skills[0] ?? null;
	});
	const frontmatterEntries = $derived.by(() => {
		if (!selectedSkill) {
			return [];
		}
		return Object.entries(selectedSkill.frontmatter);
	});

	function selectSkill(skillId: SkillId): void {
		selectedSkillId = skillId;
		viewMode = 'rendered';
	}
</script>

<div class="space-y-6">
	<div class="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
		<div class="space-y-2">
			<p class="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
				Agent runtime
			</p>
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Reusable workflow files that Spark materializes into agent workspaces before sheet and
				grader runs.
			</p>
		</div>
		<p class="text-sm text-muted-foreground">
			{data.skills.length} skill{data.skills.length === 1 ? '' : 's'} bundled
		</p>
	</div>

	<div class="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header>
				<Card.Title>Catalog</Card.Title>
				<Card.Description>Loaded from generated package metadata.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				{#each data.skills as skill (skill.id)}
					<button
						type="button"
						class={cn(
							'w-full rounded-md border px-3 py-3 text-left transition-colors',
							selectedSkill?.id === skill.id
								? 'border-primary/45 bg-primary/10 text-foreground'
								: 'border-border/70 bg-background hover:bg-muted/60'
						)}
						onclick={() => selectSkill(skill.id)}
					>
						<span class="block text-sm font-semibold">{skill.name}</span>
						<span class="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
							{skill.description}
						</span>
					</button>
				{/each}
			</Card.Content>
		</Card.Root>

		{#if selectedSkill}
			<div class="space-y-4">
				<section class="rounded-md border border-border/70 bg-card/95 p-4 shadow-sm">
					<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div class="min-w-0 space-y-2">
							<p class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
								SKILL.md
							</p>
							<h2 class="text-xl font-semibold tracking-tight break-words text-foreground">
								{selectedSkill.name}
							</h2>
							<p class="max-w-3xl text-sm leading-6 text-muted-foreground">
								{selectedSkill.description}
							</p>
						</div>
						<div class="flex shrink-0 gap-2">
							<button
								type="button"
								class={cn(
									buttonVariants({
										variant: viewMode === 'rendered' ? 'default' : 'outline',
										size: 'sm'
									})
								)}
								onclick={() => {
									viewMode = 'rendered';
								}}
							>
								Rendered
							</button>
							<button
								type="button"
								class={cn(
									buttonVariants({
										variant: viewMode === 'raw' ? 'default' : 'outline',
										size: 'sm'
									})
								)}
								onclick={() => {
									viewMode = 'raw';
								}}
							>
								Raw
							</button>
						</div>
					</div>

					<div class="mt-4 grid gap-3 md:grid-cols-2">
						<div class="rounded-md border border-border/70 bg-background/75 p-3">
							<p class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
								Workspace path
							</p>
							<p class="mt-1 font-mono text-xs break-all text-foreground">
								{selectedSkill.workspacePath}
							</p>
						</div>
						<div class="rounded-md border border-border/70 bg-background/75 p-3">
							<p class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
								Source path
							</p>
							<p class="mt-1 font-mono text-xs break-all text-foreground">
								{selectedSkill.sourcePath}
							</p>
						</div>
					</div>
				</section>

				<section class="rounded-md border border-border/70 bg-card/95 p-4 shadow-sm">
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-sm font-semibold text-foreground">YAML header</h2>
						<span class="text-xs text-muted-foreground">{frontmatterEntries.length} field(s)</span>
					</div>
					<div class="grid gap-2 md:grid-cols-2">
						{#each frontmatterEntries as [key, value] (key)}
							<div class="rounded-md border border-border/70 bg-background/75 p-3">
								<p class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
									{key}
								</p>
								<p class="mt-1 text-sm text-foreground">{value}</p>
							</div>
						{/each}
					</div>
				</section>

				<section class="rounded-md border border-border/70 bg-card/95 p-4 shadow-sm">
					{#if viewMode === 'rendered'}
						<MarkdownContent
							markdown={selectedSkill.body}
							class="skills-markdown text-sm leading-6"
						/>
					{:else}
						<pre
							class="max-h-[72vh] overflow-auto rounded-md border border-border/70 bg-muted/30 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">{selectedSkill.content}</pre>
					{/if}
				</section>
			</div>
		{:else}
			<p class="rounded-md border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
				No skills were bundled.
			</p>
		{/if}
	</div>
</div>
