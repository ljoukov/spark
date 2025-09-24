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
		opacity: 0.9;
	}

	.app-content {
		position: relative;
		z-index: 1;
		max-width: 36rem;
		text-align: center;
		padding: clamp(2.5rem, 5vw, 3.5rem);
		border-radius: 1.75rem;
		background: rgba(255, 255, 255, 0.72);
		border: 1px solid rgba(255, 255, 255, 0.55);
		box-shadow:
			0 40px 120px -50px rgba(15, 23, 42, 0.5),
			0 25px 60px -45px rgba(15, 23, 42, 0.35);
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
		color: var(--text-secondary, rgba(15, 23, 42, 0.65));
	}

	@media (prefers-color-scheme: dark) {
		.app-page {
			--app-surface: hsl(226 74% 7%);
			--app-halo: hsla(257 96% 64% / 0.28);
			--blob-gold: hsla(257 100% 76% / 0.35);
			--blob-pink: hsla(234 82% 72% / 0.32);
			--blob-yellow: hsla(275 70% 38% / 0.45);
			--blob-yellow-soft: hsla(199 92% 60% / 0.32);
			--blob-blue: hsla(162 84% 40% / 0.28);
			color: var(--foreground);
		}

		.blob-field {
			opacity: 0.82;
			background:
				radial-gradient(64% 64% at 18% 18%, var(--blob-gold), transparent 70%),
				radial-gradient(60% 60% at 78% 18%, var(--blob-yellow-soft), transparent 72%),
				radial-gradient(56% 56% at 24% 82%, var(--blob-yellow), transparent 76%),
				radial-gradient(62% 62% at 82% 78%, var(--blob-blue), transparent 78%),
				radial-gradient(70% 70% at 52% 48%, var(--blob-pink), transparent 80%);
		}

		.app-content {
			background: rgba(2, 6, 23, 0.74);
			border: 1px solid rgba(129, 140, 248, 0.3);
			box-shadow:
				0 48px 140px -60px rgba(2, 6, 23, 0.9),
				0 40px 110px -70px rgba(15, 23, 42, 0.6);
		}

		.app-subtitle {
			color: rgba(226, 232, 240, 0.78);
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
