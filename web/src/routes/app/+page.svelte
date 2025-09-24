<svelte:head>
	<title>Spark App</title>
</svelte:head>

<div class="app-page">
	<div class="blob-field" aria-hidden="true"></div>
	<main class="app-content">
		<h1 class="app-title">Welcome back to Spark</h1>
		<p class="app-subtitle">
			Your personalised study flow will live here. Sign in to start creating quizzes, notes and
			review plans.
		</p>
	</main>
</div>

<style>
	/* Align app landing glows with marketing page and drive them off theme tokens. */
	.app-page {
		position: relative;
		min-height: 100vh;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(2.5rem, 5vw, 4rem);
		overflow: hidden;
		background:
			radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
			var(--app-surface);
		color: var(--text-primary, var(--foreground));
		--app-surface: hsl(38 82% 97%);
		--app-halo: hsla(45 87% 90% / 0.65);
		--blob-gold: hsla(42 96% 84% / 0.9);
		--blob-yellow: hsla(38 95% 82% / 0.88);
		--blob-yellow-soft: hsla(38 92% 91% / 0.88);
		--blob-pink: hsla(332 85% 86% / 0.92);
		--blob-blue: hsla(184 95% 91% / 0.82);
		--blob-opacity: 0.9;
		--app-content-bg: rgba(255, 255, 255, 0.72);
		--app-content-border: rgba(255, 255, 255, 0.55);
		--app-content-shadow-primary: 0 40px 120px -50px rgba(15, 23, 42, 0.5);
		--app-content-shadow-secondary: 0 25px 60px -45px rgba(15, 23, 42, 0.35);
		--app-subtitle-color: var(--text-secondary, rgba(15, 23, 42, 0.65));
	}

	.blob-field {
		position: absolute;
		inset: -40%;
		pointer-events: none;
		filter: blur(90px);
		transform: translateZ(0);
		background:
			radial-gradient(68% 68% at 12% 2%, var(--blob-gold), transparent 68%),
			radial-gradient(58% 58% at 22% 26%, var(--blob-yellow), transparent 70%),
			radial-gradient(54% 54% at 72% 18%, var(--blob-pink), transparent 72%),
			radial-gradient(60% 60% at 24% 80%, var(--blob-blue), transparent 74%),
			radial-gradient(50% 50% at 86% 86%, var(--blob-yellow-soft), transparent 76%);
		opacity: var(--blob-opacity);
	}

	.app-content {
		position: relative;
		z-index: 1;
		max-width: 36rem;
		text-align: center;
		padding: clamp(2.5rem, 5vw, 3.5rem);
		border-radius: 1.75rem;
		background: var(--app-content-bg);
		border: 1px solid var(--app-content-border);
		box-shadow: var(--app-content-shadow-primary), var(--app-content-shadow-secondary);
		backdrop-filter: blur(28px);
	}

	.app-title {
		font-family:
			'Outfit',
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		font-weight: 600;
		font-size: clamp(2.25rem, 5vw, 3rem);
		margin-bottom: clamp(1rem, 2vw, 1.5rem);
	}

	.app-subtitle {
		font-family:
			'Outfit',
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		font-size: clamp(1rem, 2.2vw, 1.25rem);
		line-height: 1.7;
		color: var(--app-subtitle-color);
	}

	:global([data-theme='dark'] .app-page) {
		--app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
		--app-halo: rgba(129, 140, 248, 0.36);
		--blob-gold: rgba(129, 140, 248, 0.45);
		--blob-yellow: rgba(88, 28, 135, 0.4);
		--blob-yellow-soft: rgba(56, 189, 248, 0.28);
		--blob-pink: rgba(129, 140, 248, 0.38);
		--blob-blue: rgba(56, 189, 248, 0.26);
		--blob-opacity: 0.78;
		--app-content-bg: rgba(6, 11, 25, 0.78);
		--app-content-border: rgba(148, 163, 184, 0.26);
		--app-content-shadow-primary: 0 48px 140px -60px rgba(2, 6, 23, 0.9);
		--app-content-shadow-secondary: 0 40px 110px -70px rgba(15, 23, 42, 0.6);
		--app-subtitle-color: rgba(226, 232, 240, 0.78);
		color: var(--foreground);
	}

	:global([data-theme='dark'] .blob-field) {
		background:
			radial-gradient(64% 64% at 16% 20%, var(--blob-gold), transparent 72%),
			radial-gradient(58% 58% at 78% 24%, var(--blob-blue), transparent 74%),
			radial-gradient(56% 56% at 24% 78%, var(--blob-yellow-soft), transparent 76%),
			radial-gradient(60% 60% at 82% 70%, var(--blob-pink), transparent 80%),
			radial-gradient(70% 70% at 50% 50%, var(--blob-yellow), transparent 82%);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .app-page) {
			--app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
			--app-halo: rgba(129, 140, 248, 0.36);
			--blob-gold: rgba(129, 140, 248, 0.45);
			--blob-yellow: rgba(88, 28, 135, 0.4);
			--blob-yellow-soft: rgba(56, 189, 248, 0.28);
			--blob-pink: rgba(129, 140, 248, 0.38);
			--blob-blue: rgba(56, 189, 248, 0.26);
			--blob-opacity: 0.78;
			--app-content-bg: rgba(6, 11, 25, 0.78);
			--app-content-border: rgba(148, 163, 184, 0.26);
			--app-content-shadow-primary: 0 48px 140px -60px rgba(2, 6, 23, 0.9);
			--app-content-shadow-secondary: 0 40px 110px -70px rgba(15, 23, 42, 0.6);
			--app-subtitle-color: rgba(226, 232, 240, 0.78);
			color: var(--foreground);
		}

		:global(:root:not([data-theme='light']) .blob-field) {
			background:
				radial-gradient(64% 64% at 16% 20%, var(--blob-gold), transparent 72%),
				radial-gradient(58% 58% at 78% 24%, var(--blob-blue), transparent 74%),
				radial-gradient(56% 56% at 24% 78%, var(--blob-yellow-soft), transparent 76%),
				radial-gradient(60% 60% at 82% 70%, var(--blob-pink), transparent 80%),
				radial-gradient(70% 70% at 50% 50%, var(--blob-yellow), transparent 82%);
		}

	}

	@media (max-width: 40rem) {
		.app-page {
			padding: clamp(1.75rem, 8vw, 2.75rem);
		}

		.app-content {
			padding: clamp(2rem, 7vw, 2.75rem);
			border-radius: 1.5rem;
		}
	}
</style>
