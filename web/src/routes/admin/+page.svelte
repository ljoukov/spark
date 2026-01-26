<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	const quickLinks = [
		{
			title: 'Firestore',
			description: 'Verify Admin SDK connectivity and diagnostics.',
			href: '/admin/firestore'
		},
		{
			title: 'Gemini',
			description: 'Check Gemini integration and prompt tooling.',
			href: '/admin/gemini'
		},
		{
			title: 'Tasks',
			description: 'Run background tasks and task diagnostics.',
			href: '/admin/tasks'
		},
		{
			title: 'UI previews',
			description: 'Full-screen previews for UI smoke checks.',
			href: '/admin/ui'
		}
	] as const;
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">Admin dashboard</h1>
		<p class="text-sm text-muted-foreground">
			Quick access to internal tools and UI validation pages.
		</p>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Quick links</Card.Title>
			<Card.Description>Jump to the main admin tools.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 md:grid-cols-2">
			{#each quickLinks as link}
				<div
					class="flex h-full flex-col justify-between gap-4 rounded-xl border border-border/70 p-4"
				>
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{link.title}</p>
						<p class="text-xs text-muted-foreground">{link.description}</p>
					</div>
					<a
						href={link.href}
						class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'self-start')}
					>
						Open
					</a>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
