<script lang="ts">
	import { onDestroy } from 'svelte';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import QuizQuestionCard from '$lib/components/quiz/quiz-question-card.svelte';
	import { cn } from '$lib/utils.js';
	import { createSessionStateStore } from '$lib/client/sessionState';
	import type { PageData } from './$types';
	import type { PlanItemState } from '@spark/schemas';

	const EPSILON = 0.15;

	export let data: PageData;

	const sessionStateStore = createSessionStateStore(data.sessionId, data.sessionState);
	let planItemState: PlanItemState | null = data.planItemState ?? null;
	const stopSessionState = sessionStateStore.subscribe((value) => {
		planItemState = (value.items[data.planItem.id] as PlanItemState | undefined) ?? null;
	});

	onDestroy(() => {
		stopSessionState();
		sessionStateStore.stop();
	});

	const slides = data.media.slides;
	const captions = data.media.captions;
	const audioInfo = data.media.audio;

	const baseTimelineEnd = (() => {
		if (slides.length === 0) {
			return audioInfo.durationSec ?? 0;
		}
		const last = slides[slides.length - 1];
		const lastCoverage = last.startSec + (last.durationSec ?? 0);
		return Math.max(lastCoverage, audioInfo.durationSec ?? lastCoverage);
	})();

	let audioElement: HTMLAudioElement | null = null;
	let metadataLoaded = false;
	let isPlaying = false;
	let isMuted = false;
	let currentTime = 0;
	let duration = audioInfo.durationSec && audioInfo.durationSec > 0 ? audioInfo.durationSec : baseTimelineEnd;
	let manualSeeking = false;
	let pendingSeek = 0;
	let currentSlideOrder = 0;
	let currentCaptionIndex = -1;
	let playbackError: string | null = audioInfo.url ? null : 'Clip is not available right now.';

	const slideCount = slides.length;
	const speakerLabel: Record<'m' | 'f', string> = { m: 'Voice A', f: 'Voice B' };
	const speakerBadge: Record<'m' | 'f', string> = { m: 'M', f: 'F' };

	$: sliderMax = Math.max(duration, baseTimelineEnd);
	$: hasStarted = planItemState?.status !== 'not_started';
	$: hasCompleted = planItemState?.status === 'completed';
	$: activeSlide = slides[currentSlideOrder] ?? null;
	$: activeCaption = currentCaptionIndex >= 0 ? captions[currentCaptionIndex] : null;
	$: upcomingCaptions = captions.slice(Math.max(currentCaptionIndex + 1, 0), currentCaptionIndex + 3);
	$: isReady = Boolean(audioInfo.url) && metadataLoaded;

	function clampTime(value: number): number {
		if (!Number.isFinite(value)) {
			return 0;
		}
		const max = sliderMax > 0 ? sliderMax : 0;
		return Math.min(Math.max(value, 0), max);
	}

	function getCaptionEnd(index: number): number {
		const caption = captions[index];
		if (!caption) {
			return sliderMax;
		}
		if (caption.durationSec && caption.durationSec > 0) {
			return caption.startSec + caption.durationSec;
		}
		const next = captions[index + 1];
		return next ? next.startSec : sliderMax;
	}

	function resolveSlideOrder(time: number): number {
		if (slides.length === 0) {
			return 0;
		}
		for (let order = slides.length - 1; order >= 0; order -= 1) {
			const slide = slides[order];
			if (time + EPSILON >= slide.startSec) {
				return order;
			}
		}
		return 0;
	}

	function resolveCaptionIndex(time: number): number {
		if (captions.length === 0) {
			return -1;
		}
		for (let index = captions.length - 1; index >= 0; index -= 1) {
			const caption = captions[index];
			const end = getCaptionEnd(index);
			if (time + EPSILON >= caption.startSec && time - EPSILON <= end) {
				return index;
			}
		}
		return captions.length > 0 && time >= captions[captions.length - 1].startSec - EPSILON
			? captions.length - 1
			: -1;
	}

	function updateTimelineState(time: number) {
		const clamped = clampTime(time);
		currentSlideOrder = resolveSlideOrder(clamped);
		currentCaptionIndex = resolveCaptionIndex(clamped);
	}

	function formatTime(value: number): string {
		if (!Number.isFinite(value) || value < 0) {
			return '0:00';
		}
		const totalSeconds = Math.floor(value);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	async function markStarted(): Promise<void> {
		if (hasStarted) {
			return;
		}
		try {
			await sessionStateStore.markStatus(
				data.planItem.id,
				'in_progress',
				{ startedAt: new Date() },
				{ markInProgress: true }
			);
		} catch (error) {
			console.error('Unable to mark media step in progress', error);
		}
	}

	async function markCompleted(): Promise<void> {
		if (hasCompleted) {
			return;
		}
		try {
			await sessionStateStore.markStatus(
				data.planItem.id,
				'completed',
				{ completedAt: new Date() },
				{ markInProgress: true }
			);
		} catch (error) {
			console.error('Unable to mark media step completed', error);
		}
	}

	function handleLoadedMetadata() {
		if (!audioElement) {
			return;
		}
		const audioDuration = audioElement.duration;
		if (Number.isFinite(audioDuration) && audioDuration > 0) {
			duration = Math.max(audioDuration, baseTimelineEnd);
		}
		metadataLoaded = true;
	}

	function handleTimeUpdate() {
		if (!audioElement || manualSeeking) {
			return;
		}
		currentTime = audioElement.currentTime;
		updateTimelineState(currentTime);
	}

	function handlePlay() {
		isPlaying = true;
		void markStarted();
	}

	function handlePause() {
		isPlaying = false;
	}

	function handleEnded() {
		isPlaying = false;
		currentTime = sliderMax;
		updateTimelineState(currentTime);
		void markCompleted();
	}

	function handleVolumeChange() {
		if (!audioElement) {
			return;
		}
		isMuted = audioElement.muted;
	}

	function handleAudioError() {
		playbackError = 'We could not load this clip. Please try again or contact support.';
	}

	async function togglePlay() {
		if (!audioElement || !audioInfo.url) {
			return;
		}
		if (isPlaying) {
			audioElement.pause();
			return;
		}
		try {
			await audioElement.play();
		} catch (error) {
			console.error('Failed to play media clip', error);
			playbackError = 'Playback failed. Check your connection and try again.';
		}
	}

	function toggleMute() {
		isMuted = !isMuted;
		if (audioElement) {
			audioElement.muted = isMuted;
		}
	}

	function seekTo(time: number) {
		const clamped = clampTime(time);
		currentTime = clamped;
		updateTimelineState(clamped);
		if (audioElement) {
			audioElement.currentTime = clamped;
		}
	}

	function handleSeekInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const value = Number.parseFloat(target.value);
		if (!Number.isFinite(value)) {
			return;
		}
		manualSeeking = true;
		pendingSeek = value;
		currentTime = value;
		updateTimelineState(value);
	}

	function handleSeekCommit() {
		manualSeeking = false;
		seekTo(pendingSeek);
	}

	function goToSlide(order: number) {
		const slide = slides[order];
		if (!slide) {
			return;
		}
		seekTo(slide.startSec);
	}

	function handlePrevSlide() {
		if (currentSlideOrder <= 0) {
			seekTo(0);
			return;
		}
		goToSlide(currentSlideOrder - 1);
	}

	function handleNextSlide() {
		if (currentSlideOrder >= slideCount - 1) {
			seekTo(sliderMax);
			return;
		}
		goToSlide(currentSlideOrder + 1);
	}

	function handleManualComplete() {
		void markCompleted();
	}

	const playButtonClass = cn(
		buttonVariants({ variant: 'outline', size: 'icon' }),
		'rounded-full h-12 w-12 md:h-14 md:w-14'
	);
	const transportButtonClass = cn(
		buttonVariants({ variant: 'ghost', size: 'icon' }),
		'rounded-full h-10 w-10 md:h-11 md:w-11 text-foreground/70 hover:text-foreground'
	);
	const muteButtonClass = cn(
		buttonVariants({ variant: 'ghost', size: 'sm' }),
		'rounded-full px-3 md:px-4 font-medium'
	);

	updateTimelineState(0);
</script>

<svelte:head>
	<title>Spark Code · {data.planItem.title}</title>
</svelte:head>

<section class="media-page">
	<header class="media-header">
		<p class="eyebrow">Session clip</p>
		<h1>{data.planItem.title}</h1>
		{#if data.planItem.summary}
			<p class="summary">{data.planItem.summary}</p>
		{/if}
		<div class="status-row">
			<span class="status-chip" data-status={hasCompleted ? 'completed' : hasStarted ? 'in-progress' : 'idle'}>
				{#if hasCompleted}
					Completed
				{:else if hasStarted}
					In progress
				{:else}
					Not started
				{/if}
			</span>
			<code class="storage-path" title="Firebase Storage path">{audioInfo.storagePath}</code>
		</div>
	</header>

	<div class="player-card">
		<div class="player-top">
			<button
				class={playButtonClass}
				type="button"
				onclick={togglePlay}
				disabled={!audioInfo.url}
				aria-label={isPlaying ? 'Pause clip' : 'Play clip'}
			>
				{#if isPlaying}
					<Pause aria-hidden="true" />
				{:else}
					<Play aria-hidden="true" />
				{/if}
			</button>

			<div class="transport">
				<div class="transport-row">
					<button
						class={transportButtonClass}
						type="button"
						onclick={handlePrevSlide}
						aria-label="Previous slide"
					>
						<span aria-hidden="true" class="text-xl font-semibold">&lt;</span>
					</button>
					<div class="slide-badge">
						<span>Slide {slideCount === 0 ? 0 : currentSlideOrder + 1}</span>
						<small>of {slideCount}</small>
					</div>
					<button
						class={transportButtonClass}
						type="button"
						onclick={handleNextSlide}
						aria-label="Next slide"
					>
						<span aria-hidden="true" class="text-xl font-semibold">&gt;</span>
					</button>
				</div>
				<div class="time-row">
					<span>{formatTime(currentTime)}</span>
					<span>{formatTime(sliderMax)}</span>
				</div>
			</div>

			<button
				class={muteButtonClass}
				type="button"
				onclick={toggleMute}
				aria-label={isMuted ? 'Sound off' : 'Sound on'}
			>
				{#if isMuted}
					<VolumeX class="mr-2" aria-hidden="true" />
					Sound off
				{:else}
					<Volume2 class="mr-2" aria-hidden="true" />
					Sound on
				{/if}
			</button>
		</div>

		<div class="slider-row">
			<input
				type="range"
				min="0"
				max={sliderMax}
				step="0.01"
				value={currentTime}
				oninput={handleSeekInput}
				onchange={handleSeekCommit}
				aria-label="Clip progress"
			/>
		</div>

		{#if playbackError}
			<div class="error-banner">
				<AlertCircle aria-hidden="true" />
				<span>{playbackError}</span>
			</div>
		{:else if !isReady}
			<p class="loading-hint">Loading clip…</p>
		{/if}

		<audio
			bind:this={audioElement}
			src={audioInfo.url ?? undefined}
			preload="auto"
			muted={isMuted}
			onloadedmetadata={handleLoadedMetadata}
			ontimeupdate={handleTimeUpdate}
			onplay={handlePlay}
			onpause={handlePause}
			onended={handleEnded}
			onvolumechange={handleVolumeChange}
			onerror={handleAudioError}
		></audio>
	</div>

	{#if activeSlide}
		<div class="slide-card">
			<QuizQuestionCard
				eyebrow={`Slide ${currentSlideOrder + 1} · ${formatTime(activeSlide.startSec)}`}
				title={activeSlide.title}
				displayFooter={false}
			>
				<div class="slide-body" class:empty={!activeSlide.bodyHtml}>
					{#if activeSlide.bodyHtml}
						<div class="slide-markdown prose prose-neutral max-w-none">
							{@html activeSlide.bodyHtml}
						</div>
					{:else}
						<p class="text-base text-foreground/80">Stay tuned for the narration.</p>
					{/if}
				</div>
			</QuizQuestionCard>
		</div>
	{/if}

	<section class="captions-panel" aria-live="polite" aria-label="Captions">
		<h2>Captions</h2>
		{#if activeCaption}
			<div class="caption-line active">
				<span class="caption-speaker" aria-hidden="true">
					{speakerBadge[activeCaption.speaker]}
				</span>
				<div>
					<p class="caption-voice">{speakerLabel[activeCaption.speaker]}</p>
					<p class="caption-text">{activeCaption.text}</p>
				</div>
			</div>
		{:else}
			<p class="caption-placeholder">Captions will appear once the narration begins.</p>
		{/if}
		{#if upcomingCaptions.length > 0}
			<ul class="caption-queue">
				{#each upcomingCaptions as caption}
					<li>
						<span class="caption-speaker" aria-hidden="true">
							{speakerBadge[caption.speaker]}
						</span>
						<div>
							<p class="caption-voice">{speakerLabel[caption.speaker]}</p>
							<p class="caption-text">{caption.text}</p>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<div class="actions-row">
		{#if !hasCompleted}
			<Button variant="secondary" onclick={handleManualComplete}>Mark complete</Button>
		{/if}
	</div>
</section>

<style lang="postcss">
	:global(body) {
		background: radial-gradient(120% 120% at 15% 0%, rgba(59, 130, 246, 0.12), transparent),
			radial-gradient(120% 120% at 85% 0%, rgba(249, 115, 22, 0.08), transparent);
	}

	.media-page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		max-width: 960px;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
	}

	.media-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.media-header .eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: rgba(59, 130, 246, 0.7);
	}

	:global([data-theme='dark'] .media-header .eyebrow),
	:global(:root:not([data-theme='light']) .media-header .eyebrow) {
		color: rgba(96, 165, 250, 0.8);
	}

	.media-header h1 {
		font-size: clamp(2rem, 3vw, 2.5rem);
		line-height: 1.15;
		font-weight: 700;
		color: var(--foreground, #0f172a);
	}

	.media-header .summary {
		font-size: 1rem;
		line-height: 1.6;
		color: rgba(15, 23, 42, 0.78);
		max-width: 720px;
	}

	:global([data-theme='dark'] .media-header .summary),
	:global(:root:not([data-theme='light']) .media-header .summary) {
		color: rgba(226, 232, 240, 0.72);
	}

	.status-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		background: rgba(59, 130, 246, 0.1);
		color: rgba(37, 99, 235, 0.9);
	}

	.status-chip[data-status='in-progress'] {
		background: rgba(249, 115, 22, 0.15);
		color: rgba(234, 88, 12, 0.9);
	}

	.status-chip[data-status='completed'] {
		background: rgba(16, 185, 129, 0.2);
		color: rgba(5, 122, 85, 0.95);
	}

	.storage-path {
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.8rem;
		padding: 0.4rem 0.75rem;
		border-radius: 0.75rem;
		background: rgba(148, 163, 184, 0.16);
		color: rgba(71, 85, 105, 0.9);
	}

	:global([data-theme='dark'] .storage-path),
	:global(:root:not([data-theme='light']) .storage-path) {
		background: rgba(148, 163, 184, 0.22);
		color: rgba(203, 213, 225, 0.86);
	}

	.player-card {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.75rem;
		border-radius: 1.5rem;
		border: 1px solid rgba(59, 130, 246, 0.16);
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(248, 250, 252, 0.92));
		box-shadow: 0 24px 60px -40px rgba(59, 130, 246, 0.55);
		backdrop-filter: blur(18px);
	}

	:global([data-theme='dark'] .player-card),
	:global(:root:not([data-theme='light']) .player-card) {
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.88), rgba(30, 41, 59, 0.92));
		border-color: rgba(96, 165, 250, 0.2);
		box-shadow: 0 24px 60px -48px rgba(14, 165, 233, 0.4);
	}

	.player-top {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.transport {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		align-items: stretch;
	}

	.transport-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.slide-badge {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.12);
		color: rgba(30, 64, 175, 0.9);
		font-weight: 600;
	}

	.slide-badge small {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: rgba(30, 64, 175, 0.7);
	}

	:global([data-theme='dark'] .slide-badge),
	:global(:root:not([data-theme='light']) .slide-badge) {
		background: rgba(96, 165, 250, 0.18);
		color: rgba(191, 219, 254, 0.94);
	}

	:global([data-theme='dark'] .slide-badge small),
	:global(:root:not([data-theme='light']) .slide-badge small) {
		color: rgba(191, 219, 254, 0.75);
	}

	.time-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.85rem;
		color: rgba(15, 23, 42, 0.7);
	}

	:global([data-theme='dark'] .time-row),
	:global(:root:not([data-theme='light']) .time-row) {
		color: rgba(226, 232, 240, 0.75);
	}

	.slider-row {
		width: 100%;
	}

	.slider-row input[type='range'] {
		width: 100%;
		-webkit-appearance: none;
		height: 0.6rem;
		border-radius: 999px;
		background: linear-gradient(90deg, rgba(59, 130, 246, 0.8), rgba(37, 99, 235, 0.9));
		outline: none;
		position: relative;
	}

	.slider-row input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		height: 1.1rem;
		width: 1.1rem;
		border-radius: 50%;
		background: #ffffff;
		border: 2px solid rgba(59, 130, 246, 0.9);
		box-shadow: 0 8px 20px -10px rgba(59, 130, 246, 0.8);
		cursor: pointer;
	}

	.slider-row input[type='range']::-moz-range-thumb {
		height: 1.1rem;
		width: 1.1rem;
		border-radius: 50%;
		background: #ffffff;
		border: 2px solid rgba(59, 130, 246, 0.9);
		box-shadow: 0 8px 20px -10px rgba(59, 130, 246, 0.8);
		cursor: pointer;
	}

	.slider-row input[type='range']::-webkit-slider-runnable-track {
		height: 0.6rem;
		border-radius: 999px;
		background: transparent;
	}

	.slider-row input[type='range']::-moz-range-track {
		height: 0.6rem;
		border-radius: 999px;
		background: transparent;
	}

	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: 1rem;
		background: rgba(248, 113, 113, 0.2);
		color: rgba(220, 38, 38, 0.9);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.loading-hint {
		font-size: 0.9rem;
		color: rgba(59, 130, 246, 0.8);
	}

	.slide-card {
		display: flex;
	}

	.slide-body {
		padding-top: 0.75rem;
	}

	.slide-body.empty {
		padding-top: 0;
	}

	.slide-markdown :global(p) {
		margin: 0 0 0.75rem;
		font-size: 1rem;
		line-height: 1.65;
		color: rgba(15, 23, 42, 0.88);
	}

	.slide-markdown :global(h2),
	.slide-markdown :global(h3),
	.slide-markdown :global(h4) {
		margin: 0 0 0.6rem;
		font-size: 1.15rem;
		font-weight: 600;
		color: rgba(15, 23, 42, 0.92);
	}

	.slide-markdown :global(ul) {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.5rem;
	}

	.slide-markdown :global(li) {
		font-size: 1rem;
		color: rgba(15, 23, 42, 0.88);
		line-height: 1.6;
	}

	:global([data-theme='dark'] .slide-markdown :global(p)),
	:global([data-theme='dark'] .slide-markdown :global(li)),
	:global(:root:not([data-theme='light']) .slide-markdown :global(p)),
	:global(:root:not([data-theme='light']) .slide-markdown :global(li)) {
		color: rgba(226, 232, 240, 0.85);
	}

	:global([data-theme='dark'] .slide-markdown :global(h2)),
	:global([data-theme='dark'] .slide-markdown :global(h3)),
	:global([data-theme='dark'] .slide-markdown :global(h4)),
	:global(:root:not([data-theme='light']) .slide-markdown :global(h2)),
	:global(:root:not([data-theme='light']) .slide-markdown :global(h3)),
	:global(:root:not([data-theme='light']) .slide-markdown :global(h4)) {
		color: rgba(226, 232, 240, 0.92);
	}

	.captions-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border-radius: 1.25rem;
		border: 1px solid rgba(148, 163, 184, 0.3);
		background: rgba(248, 250, 252, 0.72);
		backdrop-filter: blur(14px);
	}

	.captions-panel h2 {
		font-size: 1.1rem;
		font-weight: 600;
		color: rgba(15, 23, 42, 0.85);
	}

	.caption-line,
	.caption-queue li {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.caption-line.active {
		padding: 0.9rem 1.1rem;
		border-radius: 1rem;
		background: rgba(59, 130, 246, 0.1);
	}

	.caption-speaker {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.85rem;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.15);
		color: rgba(37, 99, 235, 0.9);
	}

	.caption-voice {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: rgba(59, 130, 246, 0.75);
		margin-bottom: 0.25rem;
	}

	.caption-text {
		font-size: 1rem;
		line-height: 1.5;
		color: rgba(15, 23, 42, 0.9);
	}

	.caption-placeholder {
		font-size: 0.95rem;
		color: rgba(100, 116, 139, 0.85);
	}

	.caption-queue {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.caption-queue li .caption-voice {
		color: rgba(148, 163, 184, 0.95);
	}

	.caption-queue li .caption-text {
		color: rgba(100, 116, 139, 0.92);
	}

	.actions-row {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 768px) {
		.media-page {
			padding: 2rem 1.25rem 3rem;
		}

		.player-card {
			padding: 1.5rem;
		}

		.player-top {
			gap: 1rem;
		}

		.transport {
			width: 100%;
		}

		.transport-row {
			justify-content: space-between;
		}

		.status-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.actions-row {
			justify-content: flex-start;
		}
	}

	:global([data-theme='dark'] .captions-panel),
	:global(:root:not([data-theme='light']) .captions-panel) {
		background: rgba(15, 23, 42, 0.8);
		border-color: rgba(59, 130, 246, 0.2);
	}

	:global([data-theme='dark'] .caption-speaker),
	:global(:root:not([data-theme='light']) .caption-speaker) {
		background: rgba(37, 99, 235, 0.35);
		color: rgba(191, 219, 254, 0.95);
	}

	:global([data-theme='dark'] .caption-text),
	:global(:root:not([data-theme='light']) .caption-text) {
		color: rgba(226, 232, 240, 0.9);
	}

	:global([data-theme='dark'] .caption-placeholder),
	:global(:root:not([data-theme='light']) .caption-placeholder) {
		color: rgba(148, 163, 184, 0.8);
	}
</style>
