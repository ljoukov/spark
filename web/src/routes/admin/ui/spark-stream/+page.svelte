<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { renderMarkdown } from '$lib/markdown';

	const phases = [
		'Establishing connection...',
		'Sending request...',
		'Thinking...',
		'Responding...'
	] as const;

	type PhaseIndex = 0 | 1 | 2 | 3;

	const sampleThoughtLines = [
		'Parsing your message and constraints...',
		'Selecting tools and building a plan...',
		'Checking edge cases and drafting the response...',
		'Finalising the answer...'
	] as const;

	const sampleResponse = [
		'Here is a sample streamed response.',
		'',
		'1. First point',
		'2. Second point',
		'',
		'```ts',
		'console.log(\"hello\")',
		'```'
	].join('\n');

	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	let phaseIndex = $state<PhaseIndex>(0);
	let thoughtText = $state('');
	let responseText = $state('');
	let playing = $state(false);
	let playAbort = $state<AbortController | null>(null);

	function clampPhase(value: number): PhaseIndex {
		if (value <= 0) {
			return 0;
		}
		if (value === 1) {
			return 1;
		}
		if (value === 2) {
			return 2;
		}
		return 3;
	}

	function applyPhase(next: PhaseIndex): void {
		phaseIndex = next;
		if (playing) {
			return;
		}
		if (next <= 1) {
			thoughtText = '';
			responseText = '';
			return;
		}
		if (next === 2) {
			thoughtText = sampleThoughtLines.join('\n');
			responseText = '';
			return;
		}
		thoughtText = sampleThoughtLines.join('\n');
		responseText = sampleResponse;
	}

	function handlePhaseInput(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}
		const next = clampPhase(Number(target.value));
		applyPhase(next);
	}

	async function runSimulation(): Promise<void> {
		if (playing) {
			return;
		}
		const abortController = new AbortController();
		playAbort = abortController;
		playing = true;
		phaseIndex = 0;
		thoughtText = '';
		responseText = '';

		try {
			await sleep(450);
			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 1;

			await sleep(550);
			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 2;

			for (const line of sampleThoughtLines) {
				if (abortController.signal.aborted) {
					return;
				}
				thoughtText = thoughtText ? `${thoughtText}\n${line}` : line;
				await sleep(320);
			}

			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 3;

			const responseChunks = sampleResponse.split(/(\s+)/u);
			for (const chunk of responseChunks) {
				if (!chunk) {
					continue;
				}
				if (abortController.signal.aborted) {
					return;
				}
				responseText += chunk;
				await sleep(35);
			}
		} finally {
			playing = false;
			playAbort = null;
		}
	}

	function stopSimulation(): void {
		playAbort?.abort();
		playAbort = null;
		playing = false;
	}

	const phaseLabel = $derived(phases[phaseIndex]);
	const responseHtml = $derived(responseText ? renderMarkdown(responseText) : '');
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">Spark chat stream preview</h1>
		<p class="text-sm text-muted-foreground">
			Simulates the client-side states shown in <code>/spark</code> while an assistant response streams.
		</p>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Controls</Card.Title>
			<Card.Description>Move the slider or run the auto simulation.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-sm font-semibold text-foreground">State</p>
					<p class="text-xs font-medium text-muted-foreground">{phaseLabel}</p>
				</div>
				<input
					type="range"
					min="0"
					max="3"
					step="1"
					value={phaseIndex}
					oninput={handlePhaseInput}
					disabled={playing}
					class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted outline-none disabled:cursor-not-allowed disabled:opacity-60"
				/>
				<div class="flex justify-between text-[10px] font-medium text-muted-foreground">
					<span>connecting</span>
					<span>sending</span>
					<span>thinking</span>
					<span>responding</span>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					onclick={() => void runSimulation()}
					disabled={playing}
				>
					Run simulation
				</Button>
				<Button variant="outline" size="sm" onclick={stopSimulation} disabled={!playing}>
					Stop
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Preview</Card.Title>
			<Card.Description>Representative assistant bubble layout.</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="mx-auto w-full max-w-2xl space-y-3 rounded-2xl border border-border/70 bg-background/40 p-5">
				{#if phaseIndex <= 1}
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<span
							class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground/60"
							aria-hidden="true"
						></span>
						<span>{phaseLabel}</span>
					</div>
				{/if}

				{#if phaseIndex >= 2}
					<div class="rounded-xl border border-border/70 bg-muted/30 p-4">
						<p class="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
							Thinking...
						</p>
						<pre class="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap text-sm text-muted-foreground"
							>{thoughtText}</pre
						>
					</div>
				{/if}

				{#if phaseIndex === 3}
					{#if responseHtml}
						<div class="prose prose-sm max-w-none dark:prose-invert">
							{@html responseHtml}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">…</p>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">…</p>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
</div>
