<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';
	import { tick } from 'svelte';

	let { data }: { data: PageData } = $props();

	const availableVoices = $derived(data.voices);

	let input = $state(
		'Hello! This is a quick text-to-speech check for Spark. If you can hear this, TTS is working.'
	);
	let voice = $state('');
	let audioSrc = $state<string | null>(null);
	let audioEl = $state<HTMLAudioElement | null>(null);

	const ui = $state({
		error: '',
		starting: false
	});

	$effect(() => {
		if (!voice) {
			voice =
				availableVoices.includes('alloy') && availableVoices.length > 0
					? 'alloy'
					: (availableVoices[0] ?? '');
		}
	});

	function buildAudioUrl(): string | null {
		if (typeof window === 'undefined') {
			return null;
		}
		const trimmed = input.trim();
		if (!trimmed) {
			ui.error = 'Enter some text to synthesize.';
			return null;
		}
		if (!voice) {
			ui.error = 'Select a voice.';
			return null;
		}

		const params = new URLSearchParams();
		params.set('voice', voice);
		params.set('input', trimmed);
		params.set('t', `${Date.now()}`);
		return `/admin/tts/stream?${params.toString()}`;
	}

	async function handleSpeak(): Promise<void> {
		ui.error = '';
		ui.starting = true;
		try {
			const url = buildAudioUrl();
			if (!url) {
				return;
			}
			audioSrc = url;
			await tick();
			if (!audioEl) {
				return;
			}
			audioEl.load();
			await audioEl.play();
		} catch (error) {
			ui.error = error instanceof Error ? error.message : 'Failed to start playback.';
		} finally {
			ui.starting = false;
		}
	}

	function handleStop(): void {
		ui.error = '';
		if (!audioEl) {
			return;
		}
		audioEl.pause();
		audioEl.currentTime = 0;
	}
</script>

<div class="mx-auto w-full max-w-5xl space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">Text-to-Speech</h1>
		<p class="text-sm text-muted-foreground">
			Synthesize speech using the shared <code class="font-mono text-xs">@spark/llm</code> TTS
			wrapper (OpenAI and Google voices).
		</p>
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Preview</Card.Title>
			<Card.Description>Pick a voice, enter text, and play streamed audio.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-5">
			{#if ui.error}
				<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{ui.error}
				</p>
			{/if}

			<div class="grid gap-4 md:grid-cols-[220px_1fr] md:items-start">
				<div class="space-y-2">
					<label class="text-sm font-medium text-foreground" for="tts-voice">Voice</label>
					<select
						id="tts-voice"
						class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none ring-offset-background transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
						bind:value={voice}
					>
						{#each availableVoices as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</div>

				<div class="space-y-2">
					<label class="text-sm font-medium text-foreground" for="tts-input">Text</label>
					<textarea
						id="tts-input"
						class="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none ring-offset-background transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
						rows={5}
						bind:value={input}
					></textarea>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button type="button" onclick={handleSpeak} disabled={ui.starting}>
					{ui.starting ? 'Starting…' : 'Speak'}
				</Button>
				<Button type="button" variant="secondary" onclick={handleStop}>Stop</Button>
			</div>

			<div class="rounded-lg border bg-muted/30 p-4">
				<p class="mb-2 text-xs font-medium text-muted-foreground">Audio</p>
				<audio
					bind:this={audioEl}
					controls
					autoplay
					src={audioSrc ?? undefined}
					onerror={() => {
						ui.error =
							'TTS playback failed. Check server logs for credential/config errors (OPENAI_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON).';
					}}
				></audio>
			</div>
		</Card.Content>
	</Card.Root>
</div>
