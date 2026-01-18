<script lang="ts">
	import { onMount } from 'svelte';
	import { startAutomaticThemeSync } from '$lib/utils/theme';

	let isMuted = true;
	let shouldAutoPlay = true;
	let videoReady = false;
	let videoEl: HTMLVideoElement | null = null;
	const INTRO_POSTER = '/intro.jpg';

	onMount(() => {
		const stopThemeSync = startAutomaticThemeSync();
		const prefersReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

		shouldAutoPlay = !prefersReduceMotion.matches;

		const handleMotionChange = (event: MediaQueryListEvent) => {
			shouldAutoPlay = !event.matches;
			if (!shouldAutoPlay && videoEl) {
				videoEl.pause();
			}
		};

		prefersReduceMotion.addEventListener('change', handleMotionChange);

		return () => {
			stopThemeSync();
			prefersReduceMotion.removeEventListener('change', handleMotionChange);
		};
	});

	function toggleAudio() {
		const element = videoEl;
		if (!element) {
			return;
		}
		isMuted = !isMuted;
		element.muted = isMuted;
		if (!isMuted) {
			element.play().catch(() => {
				isMuted = true;
				element.muted = true;
			});
		}
	}

	function handleCanPlay() {
		if (videoReady) {
			return;
		}
		videoReady = true;
		if (videoEl) {
			videoEl.poster = '';
		}
	}

	function handleVideoError() {
		videoReady = false;
		if (videoEl) {
			videoEl.poster = INTRO_POSTER;
		}
	}
</script>

<svelte:head>
	<title>Spark - Study that sparks</title>
	<meta
		name="description"
		content="Spark turns your notes into fast mastery — log in to get started."
	/>
	<meta property="og:title" content="Spark" />
	<meta
		property="og:description"
		content="Think. Hack. Spark. A faster way to learn from your own materials."
	/>
	<meta property="og:image" content="/intro.jpg" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="page-shell">
	<div class="page">
		<header class="top-bar">
			<div class="brand">
				<img class="brand__icon" src="/favicon.png" alt="Spark icon" loading="lazy" />
				<span class="brand__name">Spark</span>
			</div>
		</header>

		<main class="hero">
			<section class="hero__copy" aria-label="Spark introduction">
				<span class="pill">Beta</span>
				<h1 class="slogan">
					<span class="slogan__primary">Spark</span>
					<span class="slogan__secondary">Think. Hack. Spark.</span>
				</h1>
				<div class="cta">
					<a class="cta__button" href="/welcome">Login</a>
				</div>
			</section>

			<section class="hero__media" aria-label="App preview">
				<div class="video-shell" class:video-shell--ready={videoReady}>
					<div class="video-shell__halo" aria-hidden="true"></div>
					<div class="video-shell__inner" aria-hidden="true"></div>
					<div class="video-shell__media">
						{#if !videoReady}
							<img
								class="video-shell__poster"
								src={INTRO_POSTER}
								alt="Preview of the Spark app experience"
								loading="eager"
								decoding="async"
							/>
						{/if}
						<video
							class="video-shell__video"
							bind:this={videoEl}
							autoplay={shouldAutoPlay}
							loop
							playsinline
							muted={isMuted}
							preload="auto"
							poster={INTRO_POSTER}
							on:canplay={handleCanPlay}
							on:error={handleVideoError}
						>
							<source src="/intro.webm" type="video/webm" />
							<source src="/intro.mp4" type="video/mp4" />
						</video>
					</div>

					<button
						type="button"
						class="sound-toggle"
						on:click={toggleAudio}
						aria-pressed={!isMuted}
						aria-label={isMuted ? 'Enable soundtrack' : 'Mute soundtrack'}
					>
						<span>{isMuted ? 'Sound off' : 'Sound on'}</span>
					</button>
				</div>
			</section>
		</main>
	</div>
</div>

<style>
	:global(:root) {
		--scrollbar-compensation: max(0px, calc(100vw - 100%));
		--viewport-inline: calc(100vw - var(--scrollbar-compensation));
	}

	@supports (width: 100dvw) {
		:global(:root) {
			--scrollbar-compensation: 0px;
			--viewport-inline: 100dvw;
		}
	}

	.page-shell {
		position: relative;
		min-height: 100dvh;
		width: 100%;
		overflow: hidden;
		background:
			radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
			var(--app-surface);
		color: var(--text-primary, var(--foreground));
	}

	@supports not (height: 100dvh) {
		.page-shell {
			min-height: 100vh;
		}
	}

	.page-shell::before {
		content: '';
		position: absolute;
		inset: -30%;
		pointer-events: none;
		background-repeat: no-repeat;
		background-image:
			radial-gradient(
				closest-side at 12% 20%,
				color-mix(in srgb, var(--blob-gold) 75%, transparent) 0%,
				transparent 72%
			),
			radial-gradient(
				closest-side at 78% 18%,
				color-mix(in srgb, var(--blob-pink) 70%, transparent) 0%,
				transparent 74%
			),
			radial-gradient(
				closest-side at 30% 74%,
				color-mix(in srgb, var(--blob-blue) 70%, transparent) 0%,
				transparent 76%
			),
			radial-gradient(
				closest-side at 82% 70%,
				color-mix(in srgb, var(--blob-yellow-soft) 65%, transparent) 0%,
				transparent 80%
			),
			radial-gradient(
				closest-side at 46% 48%,
				color-mix(in srgb, var(--blob-yellow) 60%, transparent) 0%,
				transparent 78%
			);
		opacity: min(0.85, var(--blob-opacity, 0.65));
		z-index: 0;
		filter: blur(80px);
	}

	.page {
		--page-width: min(1160px, var(--viewport-inline));
		width: min(1160px, 100%);
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1.25rem, 6vw, 3.75rem) clamp(2.5rem, 8vw, 4rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2.25rem, 5vw, 3.75rem);
		position: relative;
		isolation: isolate;
		box-sizing: border-box;
		z-index: 1;
	}

	.top-bar {
		display: flex;
		justify-content: flex-start;
		align-items: center;
		gap: 1rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		text-decoration: none;
	}

	.brand__icon {
		width: clamp(2.5rem, 5vw, 3rem);
		height: clamp(2.5rem, 5vw, 3rem);
		border-radius: 0.8rem;
		box-shadow: 0 14px 44px var(--shadow-color);
		object-fit: cover;
	}

	.brand__name {
		font-size: clamp(1.05rem, 2.5vw, 1.4rem);
		font-weight: 600;
	}

	.hero {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(2rem, 5vw, 3.25rem);
		align-items: center;
	}

	.hero__copy {
		display: flex;
		flex-direction: column;
		gap: clamp(1.5rem, 4vw, 2rem);
	}

	.pill {
		align-self: flex-start;
		padding: 0.45rem 0.95rem;
		border-radius: 999px;
		background: var(--surface-color);
		border: 1px solid var(--surface-border);
		box-shadow: 0 10px 28px var(--shadow-color);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.slogan {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: clamp(0.3rem, 1vw, 0.5rem);
		font-size: clamp(2.6rem, 5.8vw, 4.3rem);
		line-height: 1.04;
		font-weight: 700;
	}

	.slogan__primary {
		font-size: 1em;
		color: rgba(7, 10, 26, 0.9);
		letter-spacing: -0.015em;
	}

	:global([data-theme='dark'] .slogan__primary) {
		color: rgba(248, 250, 252, 0.92);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .slogan__primary) {
			color: rgba(248, 250, 252, 0.92);
		}
	}

	.slogan__secondary {
		font-size: clamp(1.1rem, 2.2vw, 1.7rem);
		font-weight: 400;
		color: rgba(55, 63, 86, 0.84);
		letter-spacing: 0.01em;
		text-transform: none;
	}

	:global([data-theme='dark'] .slogan__secondary) {
		color: rgba(203, 213, 245, 0.78);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .slogan__secondary) {
			color: rgba(203, 213, 245, 0.78);
		}
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
	}

	.cta__button {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		text-decoration: none;
		color: #ffffff;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.9));
		border: 1px solid rgba(59, 130, 246, 0.35);
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		padding: 0.85rem 2.2rem;
		box-shadow: 0 22px 44px var(--shadow-color);
		transition:
			transform 180ms ease,
			box-shadow 180ms ease;
	}

	:global([data-theme='dark'] .cta__button) {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.88), rgba(37, 99, 235, 0.98));
		border-color: rgba(96, 165, 250, 0.4);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .cta__button) {
			background: linear-gradient(135deg, rgba(59, 130, 246, 0.88), rgba(37, 99, 235, 0.98));
			border-color: rgba(96, 165, 250, 0.4);
		}
	}

	.cta__button:hover {
		transform: translateY(-2px) scale(1.01);
		box-shadow: 0 28px 56px var(--shadow-color);
	}

	.hero__media {
		display: flex;
		justify-content: center;
	}

	.video-shell {
		position: relative;
		width: min(440px, 100%);
		aspect-ratio: 1 / 1;
		border-radius: 1.45rem;
		padding: clamp(0.35rem, 1.2vw, 0.6rem);
		background: linear-gradient(155deg, rgba(190, 169, 255, 0.58), rgba(22, 25, 60, 0.92));
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 68px var(--shadow-color);
		overflow: hidden;
		transition:
			background 220ms ease,
			box-shadow 220ms ease,
			border-color 220ms ease;
	}

	:global([data-theme='dark'] .video-shell) {
		background: linear-gradient(150deg, rgba(88, 28, 135, 0.5), rgba(2, 6, 23, 0.95));
		border-color: rgba(148, 163, 184, 0.26);
		box-shadow: 0 32px 84px rgba(8, 11, 21, 0.88);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .video-shell) {
			background: linear-gradient(150deg, rgba(88, 28, 135, 0.5), rgba(2, 6, 23, 0.95));
			border-color: rgba(148, 163, 184, 0.26);
			box-shadow: 0 32px 84px rgba(8, 11, 21, 0.88);
		}
	}

	.video-shell__halo {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: radial-gradient(circle at 50% 50%, rgba(209, 196, 255, 0.65), transparent 68%);
		filter: blur(62px);
		opacity: 0.7;
		mix-blend-mode: screen;
		pointer-events: none;
		z-index: 0;
		transform: scale(1.1);
		transform-origin: center;
	}

	:global([data-theme='dark'] .video-shell__halo) {
		background: radial-gradient(circle at 45% 55%, rgba(129, 140, 248, 0.42), transparent 72%);
		opacity: 0.6;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .video-shell__halo) {
			background: radial-gradient(circle at 45% 55%, rgba(129, 140, 248, 0.42), transparent 72%);
			opacity: 0.6;
		}
	}

	@media (min-width: 640px) {
		.video-shell__halo {
			transform: scale(1.4);
		}
	}

	@media (min-width: 960px) {
		.video-shell__halo {
			transform: scale(1.65);
		}
	}

	.video-shell__inner {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(150deg, rgba(255, 255, 255, 0.36), rgba(103, 87, 232, 0.18));
		border: 1px solid rgba(255, 255, 255, 0.18);
		opacity: 0.58;
		pointer-events: none;
		z-index: 1;
	}

	:global([data-theme='dark'] .video-shell__inner) {
		background: linear-gradient(155deg, rgba(59, 130, 246, 0.18), rgba(2, 6, 23, 0.88));
		border-color: rgba(148, 163, 184, 0.18);
		opacity: 0.52;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .video-shell__inner) {
			background: linear-gradient(155deg, rgba(59, 130, 246, 0.18), rgba(2, 6, 23, 0.88));
			border-color: rgba(148, 163, 184, 0.18);
			opacity: 0.52;
		}
	}

	.video-shell__media {
		position: relative;
		z-index: 2;
		width: 100%;
		height: 100%;
		border-radius: 1.1rem;
		overflow: hidden;
		background: rgba(5, 9, 21, 0.96);
		box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28);
		transition: box-shadow 220ms ease;
	}

	.video-shell__poster,
	.video-shell__video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-shell__poster {
		z-index: 1;
		transition: opacity 220ms ease;
	}

	.video-shell__video {
		z-index: 2;
		background: rgba(5, 9, 21, 0.96);
		opacity: 0;
		transition: opacity 220ms ease;
	}

	.video-shell--ready .video-shell__inner {
		opacity: 0.44;
		filter: saturate(1.05);
	}

	.video-shell--ready .video-shell__media {
		box-shadow: 0 34px 72px rgba(15, 23, 42, 0.38);
	}

	.video-shell--ready .video-shell__video {
		opacity: 1;
	}

	.sound-toggle {
		position: absolute;
		bottom: 1.1rem;
		right: 1.1rem;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: var(--sound-toggle-bg);
		backdrop-filter: blur(12px);
		color: var(--sound-toggle-foreground);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 0.55rem 1.1rem;
		z-index: 2;
		cursor: pointer;
		transition:
			transform 150ms ease,
			box-shadow 150ms ease,
			background 150ms ease;
	}

	:global([data-theme='dark'] .sound-toggle) {
		border-color: rgba(148, 163, 184, 0.24);
		background: var(--sound-toggle-bg);
		color: var(--sound-toggle-foreground);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .sound-toggle) {
			border-color: rgba(148, 163, 184, 0.24);
			background: var(--sound-toggle-bg);
			color: var(--sound-toggle-foreground);
		}
	}

	.sound-toggle:hover {
		transform: scale(1.05);
		box-shadow: 0 18px 50px var(--shadow-color);
	}

	@media (max-width: 960px) {
		.page {
			padding-inline: clamp(1.25rem, 4vw, 2rem);
		}

		.hero {
			grid-template-columns: 1fr;
			text-align: center;
		}

		.hero__copy {
			align-items: center;
		}

		.slogan {
			align-items: center;
			text-align: center;
		}

		.pill {
			align-self: center;
		}

		.cta {
			justify-content: center;
		}

		.cta__button {
			margin-inline: auto;
		}

		.hero__media {
			order: 2;
		}

		.brand__name {
			font-size: 1.1rem;
		}
	}

	@media (max-width: 540px) {
		.page {
			gap: 2rem;
		}

		.brand__icon {
			width: 2.25rem;
			height: 2.25rem;
		}

		.sound-toggle {
			font-size: 0.72rem;
			padding: 0.5rem 0.9rem;
		}
	}
</style>
