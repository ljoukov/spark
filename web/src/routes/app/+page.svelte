<script lang="ts">
	import { onMount } from 'svelte';

	type DemoQuiz = {
		id: string;
		subject: 'Biology' | 'Chemistry' | 'Physics';
		title: string;
		scenario: string;
		teaser: string;
		highlight: string;
	};

	const demoQuizzes: DemoQuiz[] = [
		{
			id: 'bio-microgravity',
			subject: 'Biology',
			title: 'Orbit Lettuce Lab',
			scenario:
				'Astronauts pulse deep-red and blue LEDs to grow lettuce on the ISS, then mist the leaves to keep them hydrated.',
			teaser:
				'Explain why those wavelengths best drive photosynthesis, and how microgravity alters transpiration control in the stomata.',
			highlight: 'Ties together light-dependent reactions, gas exchange, and plant adaptations.'
		},
		{
			id: 'chem-battery-bus',
			subject: 'Chemistry',
			title: 'Hydrogen Bus Depot',
			scenario:
				'A city trial swaps diesel buses for hydrogen fuel-cell models that reuse waste heat to warm passengers.',
			teaser:
				'Balance the half-equations for the cell, then calculate the water produced on a 40 km route delivering 12.0 kWh of electrical energy.',
			highlight: 'Redox, stoichiometry, and energy changes in a single commuter story.'
		},
		{
			id: 'phys-maglev',
			subject: 'Physics',
			title: 'Maglev Rescue Track',
			scenario:
				'Engineers design an evacuation cart that floats 6 mm above a superconducting guideway during power cuts.',
			teaser:
				'Predict how induced currents keep the cart levitating as it slows, and estimate the kinetic energy change over 120 m.',
			highlight: 'Electromagnetic induction meets motion graphs and energy transfers.'
		}
	];

	const helperNotes = [
		'We accept sharp photos (JPG/PNG) and PDFs up to 15 MB each.',
		'Spark detects whether it is a Q&A page or a summary sheet, then tags it to GCSE triple science topics.',
		'Once uploaded, you can keep revisiting the generated quizzes — nothing disappears after one use.'
	];

	let isTouchDevice = false;
	let lastInteraction = '';
	let fileInput: HTMLInputElement | null = null;

	onMount(() => {
		const coarsePointer = window.matchMedia('(pointer: coarse)');
		const evaluate = () => {
			isTouchDevice = coarsePointer.matches || navigator.maxTouchPoints > 1;
		};
		evaluate();
		const handler = (event: MediaQueryListEvent) => {
			isTouchDevice = event.matches || navigator.maxTouchPoints > 1;
		};
		coarsePointer.addEventListener('change', handler);
		return () => {
			coarsePointer.removeEventListener('change', handler);
		};
	});

	function openFilePicker() {
		fileInput?.click();
	}

	function handleFiles(fileList: FileList | null) {
		if (!fileList || fileList.length === 0) {
			return;
		}
		const samples = Array.from(fileList)
			.slice(0, 2)
			.map((file) => `“${file.name}”`)
			.join(', ');
		lastInteraction = samples
			? `Ready to scan ${samples}${fileList.length > 2 ? ` and ${fileList.length - 2} more` : ''}.`
			: 'Files ready to scan.';
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		handleFiles(event.dataTransfer?.files ?? null);
	}

	function handleInputChange(event: Event) {
		const target = event.currentTarget as HTMLInputElement | null;
		handleFiles(target?.files ?? null);
	}
</script>

<svelte:head>
	<title>GCSE Spark — App Home</title>
	<meta
		name="description"
		content="Upload or snap your GCSE science notes, then jump straight into Spark's practice sets."
	/>
</svelte:head>

<div class="page">
	<header class="top-bar" aria-label="Spark navigation">
		<div class="brand" role="presentation">
			<img class="brand__icon" src="/favicon.png" alt="GCSE Spark icon" loading="lazy" />
			<span class="brand__name">GCSE Spark</span>
		</div>
	</header>

	<main class="hero" aria-labelledby="app-home-heading">
		<section class="hero__copy" aria-describedby="app-home-heading app-home-subheading">
			<span class="pill">Triple Science, instantly</span>
			<h1 id="app-home-heading" class="slogan">
				<span class="slogan__primary">Turn class notes into practice</span>
				<span id="app-home-subheading" class="slogan__secondary"
					>Upload, scan, and quiz — all from one calm home screen.</span
				>
			</h1>
			<p class="lead">
				Spark transforms photos and PDFs of your real GCSE Biology, Chemistry, and Physics materials
				into smart question sets. Every upload keeps the teacher wording, tags the board, and queues
				a quiz in seconds.
			</p>
			<ul class="features" aria-label="What happens after you upload">
				<li>Spot whether it's a mark scheme page or a summary sheet automatically.</li>
				<li>Map questions to AQA, Edexcel, or OCR triple science topics for accurate revision.</li>
				<li>
					Serve a 5–7 minute practice burst with calm feedback and a next-step recommendation.
				</li>
			</ul>
		</section>

		<section class="capture" aria-label="Upload or capture study materials">
			<div class="capture__panel">
				<div class="capture__header">
					<h2 class="capture__title">Scan or upload study material</h2>
					<p class="capture__subtitle">
						{isTouchDevice
							? 'Tap once to take a photo or pick from your camera roll.'
							: 'Drag in files or click anywhere to choose photos or PDFs.'}
					</p>
				</div>

				<label
					class="dropzone"
					on:click|preventDefault={openFilePicker}
					on:dragover|preventDefault
					on:drop={handleDrop}
					role="button"
					aria-label={isTouchDevice
						? 'Tap to capture or choose existing study material'
						: 'Drag and drop or click to choose study materials'}
				>
					<input
						bind:this={fileInput}
						class="dropzone__input"
						type="file"
						accept="image/jpeg,image/png,application/pdf"
						multiple
						on:change={handleInputChange}
						aria-hidden="true"
						tabindex="-1"
					/>
					<div class="dropzone__content">
						<div class="dropzone__icon" aria-hidden="true">📄</div>
						<p class="dropzone__cta">
							{isTouchDevice ? 'Tap to snap or choose a file' : 'Drop files or click to browse'}
						</p>
						<p class="dropzone__hint">
							Spark tidies orientation, crops automatically, and gets a quiz ready in under a
							minute.
						</p>
					</div>
				</label>

				<div class="helper" aria-live="polite">{lastInteraction}</div>

				<ul class="helper-list">
					{#each helperNotes as note (note)}
						<li>{note}</li>
					{/each}
				</ul>
			</div>
		</section>
	</main>

	<section class="demo" aria-labelledby="demo-heading">
		<div class="demo__intro">
			<h2 id="demo-heading">Try a ready-made practice set</h2>
			<p>
				No upload yet? Explore one of the live demos below — each pulls real GCSE-style questions
				Spark generated from unusual but exam-board aligned scenarios.
			</p>
		</div>

		<div class="demo__grid" role="list">
			{#each demoQuizzes as quiz (quiz.id)}
				<article class={`quiz-card quiz-card--${quiz.subject.toLowerCase()}`} role="listitem">
					<header class="quiz-card__header">
						<span class="quiz-card__badge">{quiz.subject}</span>
						<h3 class="quiz-card__title">{quiz.title}</h3>
					</header>
					<p class="quiz-card__scenario">{quiz.scenario}</p>
					<p class="quiz-card__teaser">{quiz.teaser}</p>
					<p class="quiz-card__highlight">{quiz.highlight}</p>
					<button type="button" class="quiz-card__cta">Open demo set</button>
				</article>
			{/each}
		</div>
	</section>
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

	.page {
		--page-width: min(1160px, var(--viewport-inline));
		--page-inline-gutter: max(0px, calc((var(--viewport-inline) - var(--page-width)) / 2));
		--halo-before-width: min(clamp(18rem, 42vw, 26rem), 100%);
		--halo-after-width: min(clamp(20rem, 52vw, 32rem), 100%);
		width: min(1160px, 100%);
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1.25rem, 6vw, 3.75rem) clamp(2.5rem, 8vw, 4rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2.25rem, 5vw, 3.75rem);
		position: relative;
		isolation: isolate;
		box-sizing: border-box;
	}

	.page::before,
	.page::after {
		content: '';
		position: absolute;
		z-index: -1;
		border-radius: 50%;
		filter: blur(64px);
		opacity: 0.6;
		pointer-events: none;
	}

	.page::before {
		inset: clamp(-8rem, -14vw, -4rem) 0 auto auto;
		height: clamp(14rem, 38vw, 20rem);
		width: var(--halo-before-width);
		background: radial-gradient(circle at 30% 40%, rgba(162, 132, 255, 0.55), transparent 70%);
		transform: translateX(min(var(--page-inline-gutter), calc(var(--halo-before-width) * 0.22)));
	}

	.page::after {
		inset: auto auto clamp(-10rem, -18vw, -4rem) 0;
		height: clamp(16rem, 46vw, 28rem);
		width: var(--halo-after-width);
		background: radial-gradient(circle at 60% 60%, rgba(16, 185, 129, 0.22), transparent 75%);
		transform: translateX(-min(var(--page-inline-gutter), calc(var(--halo-after-width) * 0.26)));
	}

	:global([data-theme='dark'] .page::before) {
		background: radial-gradient(circle at 30% 40%, rgba(129, 140, 248, 0.42), transparent 70%);
	}

	@media (prefers-color-scheme: dark) {
		.page::before {
			background: radial-gradient(circle at 30% 40%, rgba(129, 140, 248, 0.42), transparent 70%);
		}
	}

	:global([data-theme='dark'] .page::after) {
		background: radial-gradient(circle at 60% 60%, rgba(56, 189, 248, 0.26), transparent 75%);
	}

	@media (prefers-color-scheme: dark) {
		.page::after {
			background: radial-gradient(circle at 60% 60%, rgba(56, 189, 248, 0.26), transparent 75%);
		}
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
		align-items: start;
	}

	.hero__copy {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 3.8vw, 1.9rem);
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
		font-size: clamp(2.3rem, 5.5vw, 4rem);
		line-height: 1.06;
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
		.slogan__primary {
			color: rgba(248, 250, 252, 0.92);
		}
	}

	.slogan__secondary {
		font-size: clamp(1.05rem, 2.1vw, 1.65rem);
		font-weight: 400;
		color: rgba(55, 63, 86, 0.84);
		letter-spacing: 0.01em;
	}

	:global([data-theme='dark'] .slogan__secondary) {
		color: rgba(203, 213, 245, 0.78);
	}

	@media (prefers-color-scheme: dark) {
		.slogan__secondary {
			color: rgba(203, 213, 245, 0.78);
		}
	}

	.lead {
		margin: 0;
		font-size: clamp(1rem, 2.1vw, 1.2rem);
		color: rgba(33, 42, 74, 0.85);
		line-height: 1.55;
	}

	:global([data-theme='dark'] .lead) {
		color: rgba(226, 232, 255, 0.82);
	}

	@media (prefers-color-scheme: dark) {
		.lead {
			color: rgba(226, 232, 255, 0.82);
		}
	}

	.features {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		font-size: 0.98rem;
		color: rgba(55, 63, 86, 0.9);
	}

	.features li {
		position: relative;
		padding-left: 1.65rem;
		line-height: 1.5;
	}

	.features li::before {
		content: '✔';
		position: absolute;
		left: 0;
		top: 0.1rem;
		font-size: 0.9rem;
		color: rgba(22, 163, 74, 0.8);
	}

	:global([data-theme='dark'] .features),
	:global([data-theme='dark'] .features li) {
		color: rgba(226, 232, 255, 0.82);
	}

	.capture {
		display: flex;
		justify-content: center;
	}

	.capture__panel {
		width: 100%;
		padding: clamp(1.5rem, 3vw, 2rem);
		background: linear-gradient(155deg, rgba(255, 255, 255, 0.75), rgba(244, 246, 255, 0.95));
		border-radius: 1.4rem;
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 24px 64px rgba(15, 23, 42, 0.08);
		display: flex;
		flex-direction: column;
		gap: clamp(1.1rem, 2.4vw, 1.6rem);
	}

	:global([data-theme='dark'] .capture__panel) {
		background: linear-gradient(165deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.88));
		border-color: rgba(148, 163, 184, 0.3);
		box-shadow: 0 32px 80px rgba(2, 6, 23, 0.8);
	}

	@media (prefers-color-scheme: dark) {
		.capture__panel {
			background: linear-gradient(165deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.88));
			border-color: rgba(148, 163, 184, 0.3);
			box-shadow: 0 32px 80px rgba(2, 6, 23, 0.8);
		}
	}

	.capture__header {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.capture__title {
		margin: 0;
		font-size: clamp(1.35rem, 2.4vw, 1.8rem);
		font-weight: 600;
	}

	.capture__subtitle {
		margin: 0;
		font-size: 0.98rem;
		color: rgba(55, 65, 81, 0.82);
	}

	:global([data-theme='dark'] .capture__subtitle) {
		color: rgba(203, 213, 225, 0.76);
	}

	@media (prefers-color-scheme: dark) {
		.capture__subtitle {
			color: rgba(203, 213, 225, 0.76);
		}
	}

	.dropzone {
		position: relative;
		border: 2px dashed rgba(99, 102, 241, 0.4);
		border-radius: 1.15rem;
		padding: clamp(2.25rem, 5vw, 2.9rem) clamp(1.2rem, 3vw, 1.8rem);
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		cursor: pointer;
		background: rgba(255, 255, 255, 0.7);
		transition:
			border-color 180ms ease,
			transform 180ms ease,
			box-shadow 180ms ease;
	}

	.dropzone:focus,
	.dropzone:hover {
		border-color: rgba(79, 70, 229, 0.8);
		transform: translateY(-2px);
		box-shadow: 0 18px 42px rgba(79, 70, 229, 0.16);
	}

	:global([data-theme='dark'] .dropzone) {
		background: rgba(15, 23, 42, 0.6);
	}

	.dropzone__input {
		position: absolute;
		inset: 0;
		opacity: 0;
		pointer-events: none;
	}

	.dropzone__content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.85rem;
	}

	.dropzone__icon {
		font-size: clamp(2.4rem, 5vw, 3.2rem);
	}

	.dropzone__cta {
		margin: 0;
		font-weight: 600;
		font-size: clamp(1.05rem, 2.1vw, 1.35rem);
	}

	.dropzone__hint {
		margin: 0;
		font-size: 0.92rem;
		color: rgba(55, 65, 81, 0.76);
		max-width: 32ch;
	}

	:global([data-theme='dark'] .dropzone__hint) {
		color: rgba(203, 213, 225, 0.7);
	}

	.helper {
		min-height: 1.2rem;
		font-size: 0.92rem;
		color: rgba(30, 64, 175, 0.9);
	}

	:global([data-theme='dark'] .helper) {
		color: rgba(191, 219, 254, 0.85);
	}

	.helper-list {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: rgba(55, 63, 86, 0.84);
	}

	:global([data-theme='dark'] .helper-list) {
		color: rgba(226, 232, 255, 0.76);
	}

	.demo {
		display: flex;
		flex-direction: column;
		gap: clamp(1.8rem, 4vw, 2.4rem);
	}

	.demo__intro {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		max-width: 60ch;
	}

	.demo__intro h2 {
		margin: 0;
		font-size: clamp(1.6rem, 2.8vw, 2.2rem);
	}

	.demo__intro p {
		margin: 0;
		color: rgba(55, 63, 86, 0.84);
		line-height: 1.6;
	}

	:global([data-theme='dark'] .demo__intro p) {
		color: rgba(226, 232, 255, 0.78);
	}

	.demo__grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: clamp(1.25rem, 3vw, 1.8rem);
	}

	.quiz-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 1.1rem;
		padding: clamp(1.4rem, 3.2vw, 1.9rem);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
		transition:
			transform 180ms ease,
			box-shadow 180ms ease;
	}

	.quiz-card:hover {
		transform: translateY(-3px);
		box-shadow: 0 28px 64px rgba(15, 23, 42, 0.12);
	}

	:global([data-theme='dark'] .quiz-card) {
		background: rgba(15, 23, 42, 0.82);
		border-color: rgba(148, 163, 184, 0.3);
		box-shadow: 0 28px 64px rgba(2, 6, 23, 0.9);
	}

	.quiz-card__header {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.quiz-card__badge {
		align-self: flex-start;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 600;
		color: rgba(17, 24, 39, 0.85);
	}

	.quiz-card--biology .quiz-card__badge {
		background: rgba(134, 239, 172, 0.75);
	}

	.quiz-card--chemistry .quiz-card__badge {
		background: rgba(125, 211, 252, 0.75);
	}

	.quiz-card--physics .quiz-card__badge {
		background: rgba(165, 180, 252, 0.75);
	}

	.quiz-card__title {
		margin: 0;
		font-size: clamp(1.15rem, 2.2vw, 1.5rem);
		font-weight: 600;
	}

	.quiz-card__scenario,
	.quiz-card__teaser,
	.quiz-card__highlight {
		margin: 0;
		line-height: 1.5;
		color: rgba(55, 63, 86, 0.9);
		font-size: 0.95rem;
	}

	.quiz-card__teaser {
		font-weight: 600;
		color: rgba(17, 24, 39, 0.9);
	}

	.quiz-card__highlight {
		font-style: italic;
		color: rgba(30, 64, 175, 0.85);
	}

	:global([data-theme='dark'] .quiz-card__scenario),
	:global([data-theme='dark'] .quiz-card__teaser),
	:global([data-theme='dark'] .quiz-card__highlight) {
		color: rgba(226, 232, 255, 0.82);
	}

	:global([data-theme='dark'] .quiz-card__teaser) {
		color: rgba(191, 219, 254, 0.88);
	}

	:global([data-theme='dark'] .quiz-card__highlight) {
		color: rgba(129, 140, 248, 0.85);
	}

	.quiz-card__cta {
		margin-top: auto;
		align-self: flex-start;
		padding: 0.65rem 1.2rem;
		border-radius: 0.85rem;
		border: none;
		background: linear-gradient(135deg, rgba(79, 70, 229, 0.9), rgba(124, 58, 237, 0.9));
		color: white;
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease;
	}

	.quiz-card__cta:hover,
	.quiz-card__cta:focus {
		transform: translateY(-2px);
		box-shadow: 0 16px 36px rgba(79, 70, 229, 0.3);
	}

	.quiz-card__cta:focus-visible {
		outline: 3px solid rgba(129, 140, 248, 0.8);
		outline-offset: 3px;
	}

	@media (max-width: 960px) {
		.hero {
			grid-template-columns: 1fr;
		}

		.capture__panel {
			max-width: 560px;
			margin: 0 auto;
		}

		.demo__grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 680px) {
		.demo__grid {
			grid-template-columns: 1fr;
		}
	}
</style>
