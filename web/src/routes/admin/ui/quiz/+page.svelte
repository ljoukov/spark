<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	const previews = [
		{
			title: 'LaTeX block prompt',
			description: 'Sequence recurrence prompt using bracket-style display math blocks.',
			href: '/admin/ui/quiz/latex-1'
		},
		{
			title: 'MCQ with LaTeX answers',
			description: 'Quadratic roots with inline math in the answer options.',
			href: '/admin/ui/quiz/latex-2'
		},
		{
			title: 'MCQ with display math',
			description: 'Definite integral with display math in prompt and explanation.',
			href: '/admin/ui/quiz/latex-3'
		},
		{
			title: 'Python prompt + short answers',
			description: 'Multiline Python question with single-line responses.',
			href: '/admin/ui/quiz/code-1'
		},
		{
			title: 'Free-text math check',
			description: 'Type-answer preview with LaTeX display blocks.',
			href: '/admin/ui/quiz/free-text-1'
		}
	] as const;
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">Quiz UI previews</h1>
		<p class="text-sm text-muted-foreground">
			These pages open a full-screen quiz shell to validate LaTeX rendering.
		</p>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Available previews</Card.Title>
			<Card.Description>Each preview opens as a full-screen overlay.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 md:grid-cols-2">
			{#each previews as preview}
				<div
					class="flex h-full flex-col justify-between gap-4 rounded-xl border border-border/70 p-4"
				>
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{preview.title}</p>
						<p class="text-xs text-muted-foreground">{preview.description}</p>
					</div>
					<a
						href={preview.href}
						class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'self-start')}
					>
						Open preview
					</a>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
