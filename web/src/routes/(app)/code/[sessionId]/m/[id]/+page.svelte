<script lang="ts">
	import { onDestroy } from 'svelte';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
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

	const images = data.media.images;
	const narration = data.media.narration;
	const audioInfo = data.media.audio;

	const baseTimelineEnd = (() => {
		if (images.length === 0) {
			return audioInfo.durationSec ?? 0;
		}
		const last = images[images.length - 1];
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
	let currentImageOrder = 0;
	let currentNarrationIndex = -1;
	let playbackError: string | null = audioInfo.url ? null : 'Clip is not available right now.';

	const imageCount = images.length;

	$: sliderMax = Math.max(duration, baseTimelineEnd);
	$: hasStarted = planItemState?.status !== 'not_started';
	$: hasCompleted = planItemState?.status === 'completed';
	$: activeImage = images[currentImageOrder] ?? null;
	$: activeNarrationLine =
		currentNarrationIndex >= 0 ? narration[currentNarrationIndex] : null;
	$: timestampLabel = `${formatTime(currentTime)} / ${formatTime(sliderMax)}`;
	$: isReady = Boolean(audioInfo.url) && metadataLoaded;

	function clampTime(value: number): number {
		if (!Number.isFinite(value)) {
			return 0;
		}
		const max = sliderMax > 0 ? sliderMax : 0;
		return Math.min(Math.max(value, 0), max);
	}

	function getNarrationEnd(index: number): number {
		const line = narration[index];
		if (!line) {
			return sliderMax;
		}
		if (line.durationSec && line.durationSec > 0) {
			return line.startSec + line.durationSec;
		}
		const next = narration[index + 1];
		return next ? next.startSec : sliderMax;
	}

	function resolveImageOrder(time: number): number {
		if (images.length === 0) {
			return 0;
		}
		for (let order = images.length - 1; order >= 0; order -= 1) {
			const image = images[order];
			if (time + EPSILON >= image.startSec) {
				return order;
			}
		}
		return 0;
	}

	function resolveNarrationIndex(time: number): number {
		if (narration.length === 0) {
			return -1;
		}
		for (let index = narration.length - 1; index >= 0; index -= 1) {
			const line = narration[index];
			const end = getNarrationEnd(index);
			if (time + EPSILON >= line.startSec && time - EPSILON <= end) {
				return index;
			}
		}
		return narration.length > 0 && time >= narration[narration.length - 1].startSec - EPSILON
			? narration.length - 1
			: -1;
	}

	function updateTimelineState(time: number) {
		const clamped = clampTime(time);
		currentImageOrder = resolveImageOrder(clamped);
		currentNarrationIndex = resolveNarrationIndex(clamped);
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

	function goToImage(order: number) {
		const image = images[order];
		if (!image) {
			return;
		}
		seekTo(image.startSec);
	}

	function handlePrevImage() {
		if (currentImageOrder <= 0) {
			seekTo(0);
			return;
		}
		goToImage(currentImageOrder - 1);
	}

	function handleNextImage() {
		if (currentImageOrder >= imageCount - 1) {
			seekTo(sliderMax);
			return;
		}
		goToImage(currentImageOrder + 1);
	}

	function handleManualComplete() {
		void markCompleted();
	}

	const playControlClass = buttonVariants({ variant: 'secondary', size: 'icon' });
	const navButtonClass = buttonVariants({ variant: 'outline', size: 'icon' });
	const muteControlClass = buttonVariants({ variant: 'ghost', size: 'icon' });

	updateTimelineState(0);
</script>

<svelte:head>
	<title>Spark Code · {data.planItem.title}</title>
</svelte:head>

<section class="media-page">
	<header class="media-header">
		<h1>{data.planItem.title}</h1>
		{#if data.planItem.summary}
			<p class="summary">{data.planItem.summary}</p>
		{/if}
	</header>

	<div class="image-stage">
		<button
			class={navButtonClass}
			class:image-nav-button={true}
			type="button"
			onclick={handlePrevImage}
			aria-label="Go to previous image"
			disabled={imageCount === 0}
		>
			<ChevronLeft aria-hidden="true" size={28} />
		</button>

		<div class="image-card">
			{#if activeImage}
				{#if activeImage.url}
					<div class="image-frame">
						<img
							src={activeImage.url}
							alt={`Session illustration ${currentImageOrder + 1}`}
							width="1600"
							height="900"
							loading="lazy"
						/>
					</div>
				{:else}
					<div class="image-card-empty">
						<p>Image unavailable for this moment.</p>
					</div>
				{/if}
			{:else}
				<div class="image-card-empty">
					<p>No images available for this clip yet.</p>
				</div>
			{/if}
		</div>

		<button
			class={navButtonClass}
			class:image-nav-button={true}
			type="button"
			onclick={handleNextImage}
			aria-label="Go to next image"
			disabled={imageCount === 0}
		>
			<ChevronRight aria-hidden="true" size={28} />
		</button>
	</div>

	<div
		class="subtitle-strip"
		class:has-error={Boolean(playbackError)}
		aria-live="polite"
		aria-label="Subtitles"
	>
		{#if playbackError}
			<div class="error-banner">
				<AlertCircle aria-hidden="true" />
				<span>{playbackError}</span>
			</div>
		{:else if !isReady}
			<p class="subtitle-placeholder">Loading clip…</p>
		{:else if activeNarrationLine}
			<p class="subtitle-active">{activeNarrationLine.text}</p>
		{:else}
			<p class="subtitle-placeholder">Captions will appear once the narration begins.</p>
		{/if}
	</div>

	<div class="transport-bar">
		<button
			class={playControlClass}
			class:play-toggle={true}
			type="button"
			onclick={togglePlay}
			disabled={!audioInfo.url}
			aria-label={isPlaying ? 'Pause clip' : 'Play clip'}
		>
			{#if isPlaying}
				<Pause aria-hidden="true" size={28} />
			{:else}
				<Play aria-hidden="true" size={28} />
			{/if}
		</button>

		<button
			class={muteControlClass}
			class:mute-toggle={true}
			type="button"
			onclick={toggleMute}
			aria-label={isMuted ? 'Sound off' : 'Sound on'}
			disabled={!audioInfo.url}
		>
			{#if isMuted}
				<VolumeX aria-hidden="true" size={22} />
			{:else}
				<Volume2 aria-hidden="true" size={22} />
			{/if}
		</button>

		<span class="transport-timestamp">{timestampLabel}</span>

		<div class="transport-slider">
			<input
				type="range"
				min="0"
				max={sliderMax}
				step="0.01"
				value={currentTime}
				oninput={handleSeekInput}
				onchange={handleSeekCommit}
				aria-label="Clip progress"
				disabled={!audioInfo.url}
			/>
		</div>
	</div>

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
		width: min(100%, 960px);
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

	.image-stage {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.25rem;
		padding: 1.75rem;
		border-radius: 1.75rem;
		border: 1px solid rgba(59, 130, 246, 0.16);
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(248, 250, 252, 0.94));
		box-shadow: 0 28px 60px -48px rgba(59, 130, 246, 0.5);
		backdrop-filter: blur(18px);
	}

	:global([data-theme='dark'] .image-stage),
	:global(:root:not([data-theme='light']) .image-stage) {
		border-color: rgba(96, 165, 250, 0.22);
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.94));
		box-shadow: 0 28px 60px -48px rgba(14, 165, 233, 0.4);
	}

	.image-nav-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 3.25rem;
		width: 3.25rem;
		border-radius: 999px;
		box-shadow: 0 22px 55px -35px rgba(59, 130, 246, 0.45);
		background: rgba(255, 255, 255, 0.72);
		color: rgba(37, 99, 235, 0.92);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.image-nav-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 28px 60px -34px rgba(59, 130, 246, 0.55);
	}

	.image-nav-button:disabled {
		opacity: 0.5;
		transform: none;
		box-shadow: none;
	}

	:global([data-theme='dark'] .image-nav-button),
	:global(:root:not([data-theme='light']) .image-nav-button) {
		background: rgba(30, 41, 59, 0.9);
		color: rgba(191, 219, 254, 0.85);
		box-shadow: 0 22px 50px -35px rgba(14, 165, 233, 0.4);
	}

	.image-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.image-frame {
		position: relative;
		width: min(100%, 720px);
		aspect-ratio: 16 / 9;
		border-radius: 1.5rem;
		overflow: hidden;
		border: 1px solid rgba(59, 130, 246, 0.16);
		background: rgba(15, 23, 42, 0.05);
		box-shadow: 0 28px 60px -48px rgba(59, 130, 246, 0.4);
	}

	.image-frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.image-card-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		width: min(100%, 720px);
		min-height: clamp(280px, 40vh, 340px);
		padding: 2rem;
		border-radius: 1.5rem;
		border: 1px dashed rgba(148, 163, 184, 0.42);
		background: rgba(255, 255, 255, 0.7);
		color: rgba(100, 116, 139, 0.85);
		text-align: center;
	}

	:global([data-theme='dark'] .image-card-empty),
	:global(:root:not([data-theme='light']) .image-card-empty) {
		background: rgba(30, 41, 59, 0.78);
		border-color: rgba(148, 163, 184, 0.35);
		color: rgba(203, 213, 225, 0.78);
	}

	.image-card-empty p {
		margin: 0;
		font-size: 1rem;
		line-height: 1.6;
	}

	.image-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: min(100%, 720px);
		font-size: 0.85rem;
		font-weight: 600;
		color: rgba(37, 99, 235, 0.85);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	:global([data-theme='dark'] .image-meta),
	:global(:root:not([data-theme='light']) .image-meta) {
		color: rgba(191, 219, 254, 0.78);
	}

	.subtitle-strip {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 3.25rem;
		padding: 0.85rem 1.75rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.08);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
	}

	.subtitle-strip.has-error {
		padding: 0;
		background: transparent;
		box-shadow: none;
		min-height: auto;
	}

	.subtitle-active {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: rgba(15, 23, 42, 0.9);
		text-align: center;
	}

	.subtitle-placeholder {
		margin: 0;
		font-size: 0.95rem;
		color: rgba(100, 116, 139, 0.85);
		text-align: center;
	}

	:global([data-theme='dark'] .subtitle-strip:not(.has-error)),
	:global(:root:not([data-theme='light']) .subtitle-strip:not(.has-error)) {
		background: rgba(30, 41, 59, 0.7);
		box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.12);
	}

	:global([data-theme='dark'] .subtitle-active),
	:global(:root:not([data-theme='light']) .subtitle-active) {
		color: rgba(226, 232, 240, 0.94);
	}

	:global([data-theme='dark'] .subtitle-placeholder),
	:global(:root:not([data-theme='light']) .subtitle-placeholder) {
		color: rgba(148, 163, 184, 0.82);
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.85rem 1.1rem;
		border-radius: 1rem;
		background: rgba(248, 113, 113, 0.18);
		color: rgba(185, 28, 28, 0.95);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.transport-bar {
		display: grid;
		grid-template-columns: auto auto auto minmax(0, 1fr);
		align-items: center;
		gap: 1.25rem;
		padding: 1.25rem 1.5rem;
		border-radius: 1.5rem;
		border: 1px solid rgba(59, 130, 246, 0.16);
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(241, 245, 249, 0.88));
		box-shadow: 0 24px 55px -48px rgba(59, 130, 246, 0.5);
		backdrop-filter: blur(16px);
	}

	:global([data-theme='dark'] .transport-bar),
	:global(:root:not([data-theme='light']) .transport-bar) {
		border-color: rgba(96, 165, 250, 0.2);
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.9));
		box-shadow: 0 24px 55px -48px rgba(14, 165, 233, 0.4);
	}

	.play-toggle {
		height: 3.25rem;
		width: 3.25rem;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 24px 56px -36px rgba(59, 130, 246, 0.6);
		color: rgba(37, 99, 235, 0.95);
	}

	:global([data-theme='dark'] .play-toggle),
	:global(:root:not([data-theme='light']) .play-toggle) {
		color: rgba(191, 219, 254, 0.94);
		box-shadow: 0 24px 56px -36px rgba(14, 165, 233, 0.45);
	}

	.mute-toggle {
		height: 2.75rem;
		width: 2.75rem;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgba(15, 23, 42, 0.85);
	}

	:global([data-theme='dark'] .mute-toggle),
	:global(:root:not([data-theme='light']) .mute-toggle) {
		color: rgba(226, 232, 240, 0.85);
	}

	.transport-timestamp {
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.9rem;
		color: rgba(15, 23, 42, 0.7);
		white-space: nowrap;
		min-width: 6rem;
	}

	:global([data-theme='dark'] .transport-timestamp),
	:global(:root:not([data-theme='light']) .transport-timestamp) {
		color: rgba(226, 232, 240, 0.78);
	}

	.transport-slider {
		width: 100%;
		display: flex;
		align-items: center;
	}

	.transport-slider input[type='range'] {
		--slider-track-thickness: 0.6rem;
		--slider-thumb-size: 1.1rem;
		width: 100%;
		-webkit-appearance: none;
		appearance: none;
		height: var(--slider-thumb-size);
		background: transparent;
		border-radius: calc(var(--slider-thumb-size) / 2);
		display: block;
		outline: none;
	}

	.transport-slider input[type='range']::-webkit-slider-runnable-track {
		height: var(--slider-track-thickness);
		border-radius: 999px;
		background: linear-gradient(90deg, rgba(59, 130, 246, 0.8), rgba(37, 99, 235, 0.9));
	}

	.transport-slider input[type='range']::-moz-range-track {
		height: var(--slider-track-thickness);
		border-radius: 999px;
		background: linear-gradient(90deg, rgba(59, 130, 246, 0.8), rgba(37, 99, 235, 0.9));
	}

	.transport-slider input[type='range']::slider-runnable-track {
		height: var(--slider-track-thickness);
		border-radius: 999px;
		background: linear-gradient(90deg, rgba(59, 130, 246, 0.8), rgba(37, 99, 235, 0.9));
	}

	.transport-slider input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		height: var(--slider-thumb-size);
		width: var(--slider-thumb-size);
		border-radius: 50%;
		background: #ffffff;
		border: 2px solid rgba(59, 130, 246, 0.9);
		box-shadow: 0 8px 20px -10px rgba(59, 130, 246, 0.8);
		cursor: pointer;
		margin-top: calc((var(--slider-track-thickness) - var(--slider-thumb-size)) / 2);
	}

	.transport-slider input[type='range']::-moz-range-thumb {
		height: var(--slider-thumb-size);
		width: var(--slider-thumb-size);
		border-radius: 50%;
		background: #ffffff;
		border: 2px solid rgba(59, 130, 246, 0.9);
		box-shadow: 0 8px 20px -10px rgba(59, 130, 246, 0.8);
		cursor: pointer;
		transform: translateY(calc((var(--slider-track-thickness) - var(--slider-thumb-size)) / 2));
	}

	.transport-slider input[type='range']::slider-thumb {
		height: var(--slider-thumb-size);
		width: var(--slider-thumb-size);
		border-radius: 50%;
		background: #ffffff;
		border: 2px solid rgba(59, 130, 246, 0.9);
		box-shadow: 0 8px 20px -10px rgba(59, 130, 246, 0.8);
		cursor: pointer;
		transform: translateY(calc((var(--slider-track-thickness) - var(--slider-thumb-size)) / 2));
	}

	.actions-row {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 768px) {
		.media-page {
			padding: 2rem 1.25rem 3rem;
			gap: 1.75rem;
		}

		.image-stage {
			padding: 1.25rem;
			gap: 1rem;
		}

		.image-frame {
			width: 100%;
		}

		.image-nav-button {
			height: 2.75rem;
			width: 2.75rem;
		}

		.play-toggle {
			height: 3rem;
			width: 3rem;
		}

		.mute-toggle {
			height: 2.5rem;
			width: 2.5rem;
		}

		.transport-bar {
			grid-template-columns: auto auto;
			grid-template-rows: auto auto;
			row-gap: 0.75rem;
		}

		.transport-timestamp {
			grid-column: 1 / -1;
			text-align: center;
		}

		.transport-slider {
			grid-column: 1 / -1;
		}

		.status-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.actions-row {
			justify-content: flex-start;
		}
	}
</style>
