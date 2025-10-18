<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { createSessionStateStore } from '$lib/client/sessionState';
	import TakeBreakDialogContent from '$lib/components/dialog/take-break-dialog-content.svelte';
	import type { PageData } from './$types';
	import type { PlanItemState } from '@spark/schemas';

	const EPSILON = 0.15;
	const MIN_KEN_BURNS_DURATION = 10;
	const DEFAULT_KEN_BURNS_DURATION = 14;

	export let data: PageData;

	const sessionStateStore = createSessionStateStore(data.sessionId, data.sessionState);
	let planItemState: PlanItemState | null = data.planItemState ?? null;
	const stopSessionState = sessionStateStore.subscribe((value) => {
		planItemState = (value.items[data.planItem.id] as PlanItemState | undefined) ?? null;
	});

	onDestroy(() => {
		stopSessionState();
		sessionStateStore.stop();
		componentDestroyed = true;
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
	let duration =
		audioInfo.durationSec && audioInfo.durationSec > 0 ? audioInfo.durationSec : baseTimelineEnd;
	let manualSeeking = false;
	let pendingSeek = 0;
	let currentImageOrder = 0;
	let currentNarrationIndex = -1;
	let playbackError: string | null = audioInfo.url ? null : 'Clip is not available right now.';
	let exitPending = false;
	let hasFinishedPlayback = false;
	let showDoneButton = false;
	let quitDialogOpen = false;

	const imageCount = images.length;
	let imageLoadState: 'idle' | 'loading' | 'ready' | 'error' =
		imageCount === 0 ? 'ready' : 'idle';
	let imageLoadError: string | null = null;
	let imagePreloadToken = 0;
	let componentDestroyed = false;
	let areImagesReady = imageLoadState === 'ready';

	$: sliderMax = Math.max(duration, baseTimelineEnd);
	$: hasStarted = planItemState?.status !== 'not_started';
	$: hasCompleted = planItemState?.status === 'completed';
	$: showDoneButton = hasCompleted || hasFinishedPlayback;
	$: if (showDoneButton && quitDialogOpen) {
		quitDialogOpen = false;
	}
	$: activeImage = images[currentImageOrder] ?? null;
	$: activeNarrationLine = currentNarrationIndex >= 0 ? narration[currentNarrationIndex] : null;
	$: timestampLabel = `${formatTime(currentTime)} / ${formatTime(sliderMax)}`;
	$: isReady = Boolean(audioInfo.url) && metadataLoaded;
	$: areImagesReady = imageLoadState === 'ready';
	$: kenBurnsDurationSec =
		activeImage?.durationSec && activeImage.durationSec > 0
			? Math.max(activeImage.durationSec, MIN_KEN_BURNS_DURATION)
			: DEFAULT_KEN_BURNS_DURATION;
	$: kenBurnsDirectionClass =
		currentImageOrder % 2 === 0 ? 'kenburns-forward' : 'kenburns-reverse';
	$: kenBurnsPlayState = isPlaying ? 'running' : 'paused';

	async function startImagePreload(): Promise<void> {
		if (typeof window === 'undefined') {
			return;
		}
		imagePreloadToken += 1;
		const token = imagePreloadToken;
		if (imageCount === 0) {
			imageLoadState = 'ready';
			imageLoadError = null;
			return;
		}
		const urls = images
			.map((image) => image.url)
			.filter((url): url is string => Boolean(url));
		if (urls.length === 0) {
			imageLoadState = 'ready';
			imageLoadError = null;
			return;
		}
		imageLoadState = 'loading';
		imageLoadError = null;
		try {
			await Promise.all(
				urls.map(
					(url) =>
						new Promise<void>((resolve, reject) => {
							const preload = new Image();
							preload.onload = () => resolve();
							preload.onerror = () => reject(new Error(`Failed to load image: ${url}`));
							preload.src = url;
						})
				)
			);
			if (componentDestroyed || token !== imagePreloadToken) {
				return;
			}
			imageLoadState = 'ready';
		} catch (error) {
			console.error('Failed to preload media images', error);
			if (componentDestroyed || token !== imagePreloadToken) {
				return;
			}
			imageLoadState = 'error';
			imageLoadError =
				'We could not load the visuals for this clip. Check your connection and try again.';
		}
	}

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
		hasFinishedPlayback = true;
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
		if (!audioElement || !audioInfo.url || !areImagesReady) {
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
		if (!areImagesReady) {
			return;
		}
		if (currentImageOrder <= 0) {
			seekTo(0);
			return;
		}
		goToImage(currentImageOrder - 1);
	}

	function handleNextImage() {
		if (!areImagesReady) {
			return;
		}
		if (currentImageOrder >= imageCount - 1) {
			seekTo(sliderMax);
			return;
		}
		goToImage(currentImageOrder + 1);
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented) {
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target) {
			const tagName = target.tagName;
			if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
				return;
			}
			if (target.isContentEditable) {
				return;
			}
		}
		if (quitDialogOpen || imageCount === 0 || !areImagesReady) {
			return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			handlePrevImage();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			handleNextImage();
		}
	}

	function openQuitDialog() {
		if (exitPending) {
			return;
		}
		quitDialogOpen = true;
	}

	function closeQuitDialog() {
		if (exitPending) {
			return;
		}
		quitDialogOpen = false;
	}

	function handleQuitDialogChange(open: boolean) {
		if (exitPending) {
			return;
		}
		quitDialogOpen = open;
	}

	async function navigateToSessionDashboard(): Promise<void> {
		if (typeof window === 'undefined') {
			return;
		}
		await goto(`/code/${data.sessionId}`, {
			replaceState: true,
			invalidateAll: true
		});
	}

	async function handleQuitNow(): Promise<void> {
		if (exitPending) {
			return;
		}
		exitPending = true;
		try {
			await navigateToSessionDashboard();
		} catch (error) {
			console.error('Navigation to session dashboard failed', error);
		} finally {
			exitPending = false;
		}
	}

	async function handleDone(): Promise<void> {
		if (exitPending) {
			return;
		}
		exitPending = true;
		try {
			await markCompleted();
			await navigateToSessionDashboard();
		} catch (error) {
			console.error('Finishing media clip failed', error);
		} finally {
			exitPending = false;
		}
	}

	const playControlClass = buttonVariants({ variant: 'secondary', size: 'icon' });
	const navButtonClass = buttonVariants({ variant: 'outline', size: 'icon' });
	const muteControlClass = buttonVariants({ variant: 'ghost', size: 'icon' });
	const exitButtonClass =
		'media-exit-button flex size-8 items-center justify-center rounded-full border-2 border-border text-lg font-semibold text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30';

	updateTimelineState(0);
	onMount(() => {
		void startImagePreload();
	});
</script>

<svelte:head>
	<title>Spark Code · {data.planItem.title}</title>
</svelte:head>

<svelte:window on:keydown={handleGlobalKeydown} />

<section class="media-page">
	<header class="media-header">
		<h1>{data.planItem.title}</h1>
		{#if !showDoneButton}
			<button type="button" class={exitButtonClass} onclick={openQuitDialog} aria-label="Quit clip">
				×
			</button>
		{/if}
	</header>

	<div class="image-stage">
		<button
			class={navButtonClass}
			class:image-nav-button={true}
			type="button"
			onclick={handlePrevImage}
			aria-label="Go to previous image"
			disabled={imageCount === 0 || !areImagesReady}
		>
			<ChevronLeft aria-hidden="true" size={28} />
		</button>

		<div class="image-card">
			<div class="image-frame">
				{#if imageCount === 0}
					<div class="image-frame-message image-card-empty">
						<p>No images available for this clip yet.</p>
					</div>
				{:else if imageLoadState === 'error'}
					<div class="image-frame-message image-card-feedback" role="status" aria-live="polite">
						<p>{imageLoadError ?? 'We could not load the visuals for this clip.'}</p>
						<Button size="sm" variant="secondary" onclick={() => void startImagePreload()}>
							Retry
						</Button>
					</div>
				{:else if !areImagesReady}
					<div class="image-frame-message image-card-feedback" role="status" aria-live="polite">
						<div class="image-spinner" aria-hidden="true"></div>
						<p>Loading visuals…</p>
					</div>
				{:else if activeImage?.url}
					<div class="image-frame-visual">
						{#key currentImageOrder}
							<img
								src={activeImage.url}
								alt={`Session illustration ${currentImageOrder + 1}`}
								width="1600"
								height="900"
								loading="lazy"
								class={`image-visual ${kenBurnsDirectionClass}`}
								style={`--kenburns-duration: ${kenBurnsDurationSec}s; --kenburns-play-state: ${kenBurnsPlayState};`}
								in:fade={{ duration: 420 }}
								out:fade={{ duration: 420 }}
							/>
						{/key}
					</div>
				{:else}
					<div class="image-frame-message image-card-empty">
						<p>Image unavailable for this moment.</p>
					</div>
				{/if}
			</div>
		</div>

		<button
			class={navButtonClass}
			class:image-nav-button={true}
			type="button"
			onclick={handleNextImage}
			aria-label="Go to next image"
			disabled={imageCount === 0 || !areImagesReady}
		>
			<ChevronRight aria-hidden="true" size={28} />
		</button>
	</div>

	<div class="transport-bar">
		<button
			class={playControlClass}
			class:play-toggle={true}
			type="button"
			onclick={togglePlay}
			disabled={!audioInfo.url || !areImagesReady}
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
			disabled={!audioInfo.url || !areImagesReady}
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
				disabled={!audioInfo.url || !areImagesReady}
			/>
		</div>
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

	{#if showDoneButton}
		<div class="actions-row">
			<Button size="lg" disabled={exitPending} onclick={() => void handleDone()}>Done</Button>
		</div>
	{/if}
</section>

<Dialog.Root open={quitDialogOpen} onOpenChange={handleQuitDialogChange}>
	<Dialog.Content
		class="finish-dialog max-w-lg overflow-hidden rounded-3xl bg-background/98 p-0 shadow-[0_35px_90px_-40px_rgba(15,23,42,0.45)] dark:shadow-[0_35px_90px_-40px_rgba(2,6,23,0.75)]"
		hideClose
	>
		<TakeBreakDialogContent
			description="You're partway through this story. Keep watching to mark it complete, or quit now and return later."
			keepLabel="Keep watching"
			quitLabel="Quit now"
			quitDisabled={exitPending}
			on:keep={closeQuitDialog}
			on:quit={() => void handleQuitNow()}
		/>
	</Dialog.Content>
</Dialog.Root>

<style lang="postcss">
	:global(body) {
		background:
			radial-gradient(120% 120% at 15% 0%, rgba(59, 130, 246, 0.12), transparent),
			radial-gradient(120% 120% at 85% 0%, rgba(249, 115, 22, 0.08), transparent);
	}

	.media-page {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		width: min(100%, 960px);
		margin: 0 auto;
		padding: 1.5rem 1.5rem 4rem;
	}

	.media-header {
		position: relative;
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

	.media-exit-button {
		position: absolute;
		top: -0.75rem;
		right: -0.75rem;
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
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
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

	.image-frame-visual {
		position: absolute;
		inset: 0;
	}

	.image-visual {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		will-change: transform;
		animation-duration: var(--kenburns-duration, 14s);
		animation-timing-function: ease-in-out;
		animation-fill-mode: forwards;
		animation-play-state: var(--kenburns-play-state, running);
	}

	.image-frame-message {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: clamp(1.5rem, 3vw, 2.5rem);
		text-align: center;
		border-radius: inherit;
	}

	.image-card-feedback {
		background: rgba(255, 255, 255, 0.82);
		color: rgba(30, 41, 59, 0.85);
		backdrop-filter: blur(6px);
	}

	.image-visual.kenburns-forward {
		animation-name: kenburns-forward;
	}

	.image-visual.kenburns-reverse {
		animation-name: kenburns-reverse;
	}

	:global([data-theme='dark'] .image-card-feedback),
	:global(:root:not([data-theme='light']) .image-card-feedback) {
		background: rgba(15, 23, 42, 0.88);
		color: rgba(226, 232, 240, 0.88);
	}

	.image-spinner {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 999px;
		border: 0.3rem solid rgba(59, 130, 246, 0.25);
		border-top-color: rgba(59, 130, 246, 0.9);
		animation: image-spinner 0.9s linear infinite;
	}

	:global([data-theme='dark'] .image-spinner),
	:global(:root:not([data-theme='light']) .image-spinner) {
		border-color: rgba(148, 163, 184, 0.35);
		border-top-color: rgba(96, 165, 250, 0.85);
	}

	.image-card-empty {
		background: rgba(255, 255, 255, 0.78);
		color: rgba(100, 116, 139, 0.85);
		backdrop-filter: blur(6px);
	}

	:global([data-theme='dark'] .image-card-empty),
	:global(:root:not([data-theme='light']) .image-card-empty) {
		background: rgba(30, 41, 59, 0.8);
		color: rgba(203, 213, 225, 0.82);
	}

	.image-card-feedback p,
	.image-card-empty p {
		margin: 0;
		font-size: 1rem;
		line-height: 1.5;
		max-width: 28rem;
	}

	@keyframes image-spinner {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes kenburns-forward {
		0% {
			transform: scale(1.05) translate3d(-2%, -2%, 0);
		}
		100% {
			transform: scale(1.12) translate3d(2%, 2%, 0);
		}
	}

	@keyframes kenburns-reverse {
		0% {
			transform: scale(1.12) translate3d(2%, 2%, 0);
		}
		100% {
			transform: scale(1.05) translate3d(-2%, -2%, 0);
		}
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
		align-items: flex-start;
		justify-content: center;
		min-height: 5rem;
		padding: 0.85rem 1.75rem;
		border-radius: 1.5rem;
		background: rgba(59, 130, 246, 0.08);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
	}

	.subtitle-strip.has-error {
		padding: 0;
		background: transparent;
		box-shadow: none;
		height: auto;
		min-height: auto;
		max-height: none;
	}

	.subtitle-active {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 500;
		line-height: 1.4;
		color: rgba(15, 23, 42, 0.82);
		text-align: center;
	}

	.subtitle-placeholder {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 400;
		line-height: 1.45;
		color: rgba(100, 116, 139, 0.82);
		text-align: center;
	}

	:global([data-theme='dark'] .subtitle-strip:not(.has-error)),
	:global(:root:not([data-theme='light']) .subtitle-strip:not(.has-error)) {
		background: rgba(30, 41, 59, 0.7);
		box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.12);
	}

	:global([data-theme='dark'] .subtitle-active),
	:global(:root:not([data-theme='light']) .subtitle-active) {
		color: rgba(226, 232, 240, 0.9);
	}

	:global([data-theme='dark'] .subtitle-placeholder),
	:global(:root:not([data-theme='light']) .subtitle-placeholder) {
		color: rgba(148, 163, 184, 0.78);
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
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: nowrap;
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
		font-family:
			'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
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
		flex: 1;
		min-width: 0;
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

	@media (max-width: 960px) {
		.image-stage {
			grid-template-columns: minmax(0, 1fr);
		}

		.image-nav-button {
			display: none;
		}
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
			gap: 0.5rem;
		}

		.actions-row {
			justify-content: flex-start;
		}
	}
</style>
