<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	const mockRun = {
		id: 'run_01HXYZ9KS71',
		model: 'gemini-1.5-pro',
		promptSummary: 'Generate five GCSE Chemistry recap questions about rates of reaction.',
		createdAt: '2024-11-20T09:14:12Z'
	};

	const mockResponses = [
		{
			id: 'resp-01',
			type: 'Multiple choice',
			prompt: 'Which factor does not increase the rate of reaction for most reactions?',
			answer: 'Lower temperature.'
		},
		{
			id: 'resp-02',
			type: 'Short answer',
			prompt: 'State the effect of adding a catalyst to a reaction.',
			answer: 'Provides an alternative pathway with lower activation energy.'
		},
		{
			id: 'resp-03',
			type: 'Numeric',
			prompt: 'If concentration doubles, what happens to collisions per second?',
			answer: 'They double (directly proportional).'
		}
	];
</script>

<section class="space-y-6">
	<Card.Card class="border-border/70 bg-card shadow-sm">
		<Card.CardHeader>
			<Card.CardTitle class="text-2xl">Gemini workspace</Card.CardTitle>
			<Card.CardDescription>
				Mock environment for Gemini orchestration flows. Inspect recent prompts and generated
				artifacts before wiring them into production jobs.
			</Card.CardDescription>
		</Card.CardHeader>
		<Card.CardFooter class="flex flex-wrap gap-3">
			<Button variant="secondary">Run dry prompt</Button>
			<Button variant="outline">Upload sample context</Button>
			<Button variant="ghost">View execution logs</Button>
		</Card.CardFooter>
	</Card.Card>

	<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
		<Card.Card class="border-border/70 bg-card shadow-sm">
			<Card.CardHeader>
				<Card.CardTitle>Latest draft run</Card.CardTitle>
				<Card.CardDescription>Captured from the Cloudflare worker sandbox.</Card.CardDescription>
			</Card.CardHeader>
			<Card.CardContent class="space-y-4 text-sm">
				<div>
					<p class="text-muted-foreground">Run id</p>
					<p class="font-mono text-foreground">{mockRun.id}</p>
				</div>
				<div class="grid gap-2 md:grid-cols-2">
					<div>
						<p class="text-muted-foreground">Model</p>
						<p class="font-medium">{mockRun.model}</p>
					</div>
					<div>
						<p class="text-muted-foreground">Created at</p>
						<p>{new Date(mockRun.createdAt).toLocaleString()}</p>
					</div>
				</div>
				<div>
					<p class="text-muted-foreground">Prompt summary</p>
					<p class="leading-relaxed">{mockRun.promptSummary}</p>
				</div>
			</Card.CardContent>
		</Card.Card>

		<Card.Card class="border-border/70 bg-card shadow-sm">
			<Card.CardHeader>
				<Card.CardTitle>Streaming status</Card.CardTitle>
				<Card.CardDescription>Real-time diff preview.</Card.CardDescription>
			</Card.CardHeader>
			<Card.CardContent class="space-y-3">
				<Skeleton class="h-12 w-full" />
				<Skeleton class="h-12 w-full" />
				<Skeleton class="h-12 w-3/4" />
			</Card.CardContent>
		</Card.Card>
	</div>

	<Card.Card class="border-border/70 bg-card shadow-sm">
		<Card.CardHeader>
			<Card.CardTitle>Sample outputs</Card.CardTitle>
			<Card.CardDescription>Curated answers to evaluate scoring heuristics.</Card.CardDescription>
		</Card.CardHeader>
		<Card.CardContent class="grid gap-4 md:grid-cols-3">
			{#each mockResponses as response (response.id)}
				<Card.Card class="border-border/80 bg-background">
					<Card.CardHeader>
						<Card.CardTitle class="text-base">{response.type}</Card.CardTitle>
						<Card.CardDescription>{response.prompt}</Card.CardDescription>
					</Card.CardHeader>
					<Card.CardContent>
						<p class="text-sm font-medium text-foreground">{response.answer}</p>
					</Card.CardContent>
				</Card.Card>
			{/each}
		</Card.CardContent>
	</Card.Card>
</section>
