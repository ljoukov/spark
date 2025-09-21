<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	const quickLinks = [
		{
			title: 'Gemini console',
			description: 'Preview Gemini prompts and inspect mock responses.',
			href: '/admin/gemini',
			cta: 'Open workspace'
		}
	] as const;
</script>

<section class="grid gap-6 lg:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
	{#each quickLinks as link (link.href)}
		<Card.Card class="border-border/80 bg-card shadow-sm shadow-black/5 transition hover:shadow-md">
			<Card.CardHeader>
				<Card.CardTitle class="text-xl">{link.title}</Card.CardTitle>
				<Card.CardDescription>{link.description}</Card.CardDescription>
			</Card.CardHeader>
			<Card.CardFooter class="flex justify-end">
				<a
					href={link.href}
					class="inline-flex"
				>
					<Button>{link.cta}</Button>
				</a>
			</Card.CardFooter>
		</Card.Card>
	{/each}
</section>

<section class="rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
	<h2 class="text-base font-semibold text-foreground">What’s next?</h2>
	<p class="mt-2">
		More admin tools will appear here soon. Let us know if a workflow needs priority and
		we'll slot it into the roadmap.
	</p>
</section>
