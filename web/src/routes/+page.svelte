<script lang="ts">
	import { onMount } from 'svelte';

	type Theme = 'light' | 'dark';

	const STORAGE_KEY = 'gcsespark.theme';
	const APP_STORE_URL = 'https://apps.apple.com';

	let theme: Theme = 'light';
	let isMuted = true;
	let shouldAutoPlay = true;
	let videoReady = false;
	let videoEl: HTMLVideoElement | null = null;

	function applyTheme(next: Theme) {
		if (typeof document === 'undefined') {
			return;
		}
		document.documentElement.dataset.theme = next;
	}

	onMount(() => {
		const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
		const prefersReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

		shouldAutoPlay = !prefersReduceMotion.matches;

		const initialTheme = stored ?? (prefersDark.matches ? 'dark' : 'light');
		theme = initialTheme;
		applyTheme(initialTheme);

		const handleThemeChange = (event: MediaQueryListEvent) => {
			if (window.localStorage.getItem(STORAGE_KEY)) {
				return;
			}
			theme = event.matches ? 'dark' : 'light';
			applyTheme(theme);
		};

		const handleMotionChange = (event: MediaQueryListEvent) => {
			shouldAutoPlay = !event.matches;
			if (!shouldAutoPlay && videoEl) {
				videoEl.pause();
			}
		};

		prefersDark.addEventListener('change', handleThemeChange);
		prefersReduceMotion.addEventListener('change', handleMotionChange);

		return () => {
			prefersDark.removeEventListener('change', handleThemeChange);
			prefersReduceMotion.removeEventListener('change', handleMotionChange);
		};
	});

	function toggleTheme() {
		const next = theme === 'dark' ? 'light' : 'dark';
		theme = next;
		applyTheme(next);
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, next);
		}
	}

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
		videoReady = true;
	}
</script>

<svelte:head>
	<title>GCSE Spark - Study that sparks</title>
	<meta
		name="description"
		content="GCSE Spark turns your science notes into Grade 9 mastery — download now on the App Store."
	/>
	<meta property="og:title" content="GCSE Spark" />
	<meta property="og:description" content="Ignite GCSE science brilliance with the iOS app designed for fast mastery." />
	<meta property="og:image" content="/intro.jpg" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="page">
	<header class="top-bar">
		<div class="brand">
			<img class="brand__icon" src="/favicon.png" alt="GCSE Spark icon" loading="lazy" />
			<span class="brand__name">GCSE Spark</span>
		</div>
		<button
			type="button"
			class="theme-toggle"
			on:click={toggleTheme}
			aria-label={`Activate ${theme === 'dark' ? 'light' : 'dark'} mode`}
		>
			{#if theme === 'dark'}
				<svg viewBox="0 0 24 24" role="img" aria-hidden="true">
					<path
						d="M12 4.25a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 12 4.25Zm6.364 1.386a.75.75 0 0 1 1.06 1.061l-.707.707a.75.75 0 1 1-1.06-1.06Zm-12.728 0a.75.75 0 0 1 1.06 1.061l-.707.707a.75.75 0 0 1-1.06-1.06ZM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 3.25a.75.75 0 0 1 0 1.5h-1a.75.75 0 0 1 0-1.5Zm-15 0a.75.75 0 0 1 0 1.5h-1a.75.75 0 1 1 0-1.5Zm12.728 6.114.707.707a.75.75 0 0 1-1.06 1.06l-.707-.706a.75.75 0 1 1 1.06-1.061Zm-10.607 0a.75.75 0 0 1 1.06 1.06l-.707.707a.75.75 0 1 1-1.06-1.06ZM12 17.25a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1a.75.75 0 0 1 .75-.75Z"
					/>
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" role="img" aria-hidden="true">
					<path
						d="M19.017 15.796a7.5 7.5 0 0 1-10.813-9.94.75.75 0 0 0-.93-.989A8.999 8.999 0 1 0 20.02 16.726a.75.75 0 0 0-1.003-.93Z"
					/>
				</svg>
			{/if}
		</button>
	</header>

	<main class="hero">
	<section class="hero__copy" aria-label="GCSE Spark introduction">
		<div class="cta">
			<a class="cta__link" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
				<img
					src={theme === 'dark' ? '/appstore-dark.svg' : '/appstore-light.svg'}
					alt="Download GCSE Spark on the App Store"
					width="200"
					height="64"
					/>
			</a>
		</div>
		<h1 class="slogan">
			<span class="slogan__primary">GCSE Spark</span>
			<span class="slogan__secondary">Scan. Learn. Spark.</span>
		</h1>
		<span class="pill">Now on the App Store</span>
	</section>

		<section class="hero__media" aria-label="App preview">
			<div class="video-shell">
				<div class="video-shell__glow" aria-hidden="true"></div>
				{#if !videoReady}
					<img class="video-shell__fallback" src="/intro.jpg" alt="GCSE Spark preview" />
				{/if}
				<video
					bind:this={videoEl}
					autoplay={shouldAutoPlay}
					loop
					playsinline
					muted={isMuted}
					preload="auto"
					poster="/intro.jpg"
					on:canplay={handleCanPlay}
				>
					<source src="/intro.webm" type="video/webm" />
					<source src="/intro.mp4" type="video/mp4" />
					<img src="/intro.jpg" alt="GCSE Spark video preview" loading="lazy" />
				</video>

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

<style>
	.page {
		width: min(1160px, 100%);
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1.25rem, 6vw, 3.75rem) clamp(2.5rem, 8vw, 4rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2.25rem, 5vw, 3.75rem);
	}

	.top-bar {
		display: flex;
		justify-content: space-between;
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

	.theme-toggle {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 999px;
		border: 1px solid var(--surface-border);
		background: var(--surface-color);
		display: grid;
		place-items: center;
		box-shadow: 0 12px 32px var(--shadow-color);
		cursor: pointer;
		transition: transform 150ms ease, box-shadow 150ms ease;
	}

	.theme-toggle:hover {
		transform: translateY(-2px);
		box-shadow: 0 18px 50px var(--shadow-color);
	}

	.theme-toggle svg {
		width: 1.35rem;
		height: 1.35rem;
		fill: var(--text-primary);
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

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
	}

	.cta__link {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		filter: drop-shadow(0 22px 44px var(--shadow-color));
		transition: transform 180ms ease, filter 180ms ease;
		padding: 0;
		width: min(100%, clamp(190px, 28vw, 250px));
	}

	.cta__link:hover {
		transform: translateY(-2px) scale(1.01);
		filter: drop-shadow(0 28px 56px var(--shadow-color));
	}

	.cta__link img {
		display: block;
		width: 100%;
		height: auto;
	}

	.hero__media {
		display: flex;
		justify-content: center;
	}

	.video-shell {
		position: relative;
		width: min(440px, 100%);
		aspect-ratio: 1 / 1;
		border-radius: 1.6rem;
		padding: clamp(0.7rem, 1.8vw, 1rem);
		background: radial-gradient(circle at 30% 20%, rgba(126, 58, 236, 0.65), rgba(22, 10, 45, 0.95));
		border: 0.55px solid var(--surface-border);
		box-shadow: 0 30px 72px var(--shadow-color);
		overflow: hidden;
	}

	.video-shell__glow {
		position: absolute;
		inset: 10%;
		border-radius: 1.2rem;
		background: radial-gradient(circle, rgba(91, 33, 182, 0.32), transparent 70%);
		filter: blur(55px);
		mix-blend-mode: screen;
		pointer-events: none;
	}

	:global([data-theme='dark'] .video-shell__glow) {
		background: radial-gradient(circle, rgba(249, 115, 22, 0.38), transparent 70%);
	}

	.video-shell video {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 1rem;
		background: #000;
		z-index: 1;
	}

	.video-shell__fallback {
		position: absolute;
		inset: clamp(0.7rem, 1.8vw, 1rem);
		object-fit: cover;
		border-radius: 1rem;
		z-index: 1;
	}

	.sound-toggle {
		position: absolute;
		bottom: 1.1rem;
		right: 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--surface-border);
		background: rgba(7, 18, 38, 0.45);
		backdrop-filter: blur(12px);
		color: var(--accent-contrast);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 0.55rem 1.1rem;
		z-index: 2;
		cursor: pointer;
		transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
	}

	:global([data-theme='dark'] .sound-toggle) {
		background: rgba(2, 6, 23, 0.55);
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

		.cta__link {
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

		.theme-toggle {
			width: 2.4rem;
			height: 2.4rem;
		}

			.sound-toggle {
				font-size: 0.72rem;
				padding: 0.5rem 0.9rem;
			}
	}
</style>
