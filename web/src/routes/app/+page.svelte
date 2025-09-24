<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	type DemoQuiz = {
		id: string;
		subject: string;
		title: string;
		description: string;
		teasers: string[];
		cta: string;
		wrapperClass: string;
		subjectAccent: string;
	};

	const demoQuizzes: DemoQuiz[] = [
		{
			id: 'biology-arctic-reflexes',
			subject: 'Biology',
			title: 'Bio demo · Reflexes vs hormones in cold snaps',
			description:
				'Lifted from an Edexcel Arctic survival worksheet—Spark still maps it to the GCSE nervous and endocrine spec.',
			teasers: [
				'A student plunges one hand into icy water before a sprint: explain the dual nervous and hormonal responses that stop blood glucose crashing.',
				'Describe the reflex arc that protects the eye when wind-blown grit hits during a blizzard practice drill.',
				'Plan a quick experiment to prove auxins bend woodland seedlings around a fallen log without damaging them.'
			],
			cta: 'Play the Biology sample',
			wrapperClass: 'demo-card--bio',
			subjectAccent: 'subject-tag--bio'
		},
		{
			id: 'chemistry-lunch-hall-fizz',
			subject: 'Chemistry',
			title: 'Chem demo · Forensic fizz in the lunch hall',
			description:
				'Spark reframes an AQA rates practical after a mystery spill, so learners apply collision theory without memorising lab scripts.',
			teasers: [
				'The caretaker finds cola etched into a limestone step—predict the gas released and how you would collect it safely.',
				'Explain why powdered marble chips from the art room make the neutralisation roar compared with the intact step.',
				'The pH probe keeps drifting mid-investigation: outline two GCSE fixes before trusting the titration curve.'
			],
			cta: 'Play the Chemistry sample',
			wrapperClass: 'demo-card--chem',
			subjectAccent: 'subject-tag--chem'
		},
		{
			id: 'physics-microwave-bake-sale',
			subject: 'Physics',
			title: 'Physics demo · Microwave standing-wave bake sale',
			description:
				'Borrowed from an OCR waves worksheet, Spark turns melted chocolate experiments into quantitative practice.',
			teasers: [
				'Use the melted stripes in a tray of marshmallows to estimate the speed of light within GCSE-required precision.',
				'Explain how rotating the tray changes the hotspot pattern using nodes, antinodes, and energy transfer.',
				'Predict how swapping chocolate for salty caramel sauce alters the convection pattern inside the oven.'
			],
			cta: 'Play the Physics sample',
			wrapperClass: 'demo-card--phys',
			subjectAccent: 'subject-tag--phys'
		}
	];

	let isTouch = false;
	let isDragging = false;
	let selectedFileNames: string[] = [];
	let totalSelected = 0;
	let fileInput: HTMLInputElement | null = null;
	let dragDepth = 0;

	onMount(() => {
		const pointerQuery = window.matchMedia('(pointer: coarse)');
		const updatePointer = () => {
			isTouch = pointerQuery.matches;
		};

		updatePointer();
		pointerQuery.addEventListener('change', updatePointer);

		return () => {
			pointerQuery.removeEventListener('change', updatePointer);
		};
	});

	function handleFiles(files: FileList) {
		totalSelected = files.length;
		selectedFileNames = Array.from(files)
			.slice(0, 3)
			.map((file) => file.name);
	}

	function handleInputChange(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		if (target.files) {
			handleFiles(target.files);
		}
	}

	function triggerFileDialog() {
		if (!fileInput) {
			return;
		}
		fileInput.click();
	}

	function handleAreaClick() {
		if (!fileInput) {
			return;
		}

		if (isTouch) {
			fileInput.setAttribute('capture', 'environment');
		} else {
			fileInput.removeAttribute('capture');
		}

		triggerFileDialog();
	}

	function handleAreaKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleAreaClick();
		}
	}

	function openFromDevice(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (!fileInput) {
			return;
		}
		fileInput.removeAttribute('capture');
		triggerFileDialog();
	}

	function openCamera(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (!fileInput) {
			return;
		}
		fileInput.setAttribute('capture', 'environment');
		triggerFileDialog();
	}

	function handleDragEnter(event: DragEvent) {
		if (isTouch) {
			return;
		}
		event.preventDefault();
		dragDepth += 1;
		isDragging = true;
	}

	function handleDragOver(event: DragEvent) {
		if (isTouch) {
			return;
		}
		event.preventDefault();
	}

	function handleDragLeave(event: DragEvent) {
		if (isTouch) {
			return;
		}
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) {
			isDragging = false;
		}
	}

	function handleDrop(event: DragEvent) {
		if (isTouch) {
			return;
		}
		event.preventDefault();
		dragDepth = 0;
		isDragging = false;
		const files = event.dataTransfer?.files;
		if (files?.length) {
			handleFiles(files);
		}
	}

	$: extraFileCount = Math.max(0, totalSelected - selectedFileNames.length);
	$: hasSelection = totalSelected > 0;
</script>

<svelte:head>
	<title>GCSE Spark — App mock</title>
	<meta
		name="description"
		content="Mock up of the GCSE Spark web app flow: scan or upload your own GCSE Triple Science materials and try sample quizzes."
	/>
</svelte:head>

<div class="page">
	<header class="top-bar">
		<a class="brand" href={resolve('/')} aria-label="Back to GCSE Spark marketing site">
			<img class="brand__icon" src="/favicon.png" alt="GCSE Spark icon" loading="lazy" />
			<span class="brand__name">GCSE Spark</span>
		</a>
		<span class="app-label">Student app mock</span>
	</header>

	<main class="layout">
		<section class="intro" aria-label="Spark purpose">
			<span class="pill">Your schoolwork. Sparked.</span>
			<h1 class="intro__title">Turn every sheet into a five-minute Triple Science workout.</h1>
			<p class="intro__lead">
				Spark reads your photos or PDFs, decides whether they are mark-scheme Q&amp;A or teacher
				summaries, and builds board-aware Biology, Chemistry, or Physics practice.
			</p>
			<ul class="intro__points">
				<li>
					Under 15&nbsp;MB per file — perfect for snapped worksheets or exported revision PDFs.
				</li>
				<li>Auto-detects subject, topic, and exam board hints before you even tap start.</li>
				<li>Every set ends with calm feedback and one next action instead of fireworks.</li>
			</ul>
			<p class="intro__meta">Prototype only: uploads stay in your browser for this demo.</p>
		</section>

		<section class="capture" aria-label="Upload your study material">
			<div
				class:upload-area--dragging={isDragging}
				class:upload-area--touch={isTouch}
				class="upload-area"
				role="button"
				tabindex="0"
				aria-describedby="upload-hint"
				on:click={handleAreaClick}
				on:keydown={handleAreaKeydown}
				on:dragenter={handleDragEnter}
				on:dragover={handleDragOver}
				on:dragleave={handleDragLeave}
				on:drop={handleDrop}
			>
				<div class="upload-area__glow" aria-hidden="true"></div>
				<img class="upload-area__icon" src="/favicon.png" alt="" aria-hidden="true" />
				<div class="upload-area__text">
					<h2>Tap to scan or bring in your notes</h2>
					<p>
						Spark tidies lighting, straightens pages, and keeps your board-specific language intact
						so the questions feel familiar.
					</p>
				</div>
				<div class="upload-area__actions">
					<Button class="upload-area__button" on:click={openFromDevice}>Upload from device</Button>
					<Button class="upload-area__button" variant="outline" on:click={openCamera}>
						Use camera
					</Button>
				</div>
				<p id="upload-hint" class="upload-area__hint">
					{#if isTouch}
						Works brilliantly on your phone — we will open the rear camera for a crisp capture.
					{:else}
						Prefer drag &amp; drop? Drop JPEG, PNG, or PDF files straight from Finder or File
						Explorer.
					{/if}
				</p>
				<p class="upload-area__disclaimer">
					Nothing uploads yet — this is a mock interface for exploration.
				</p>
				<input
					bind:this={fileInput}
					class="sr-only"
					id="study-upload"
					type="file"
					accept="image/*,.pdf"
					capture="environment"
					multiple
					on:change={handleInputChange}
				/>
			</div>

			{#if hasSelection}
				<div class="upload-summary" aria-live="polite">
					<span class="upload-summary__label">Ready to generate from:</span>
					<ul class="upload-summary__list">
						{#each selectedFileNames as name, index (`${name}-${index}`)}
							<li>{name}</li>
						{/each}
						{#if extraFileCount > 0}
							<li>+{extraFileCount} more</li>
						{/if}
					</ul>
				</div>
			{/if}
		</section>
	</main>

	<section class="demo-quizzes" aria-label="Sample Spark quizzes">
		<header class="demo-quizzes__header">
			<h2>Try a pre-built practice set</h2>
			<p>
				These demos preview the kind of unexpected-but-on-spec prompts Spark delivers so you can
				feel the difference before uploading anything real.
			</p>
		</header>
		<div class="demo-quizzes__grid">
			{#each demoQuizzes as quiz (quiz.id)}
				<Card.Root class={`demo-card ${quiz.wrapperClass}`}>
					<Card.Header class="demo-card__header">
						<span class={`subject-tag ${quiz.subjectAccent}`}>{quiz.subject}</span>
						<Card.Title class="demo-card__title">{quiz.title}</Card.Title>
						<Card.Description class="demo-card__description">
							{quiz.description}
						</Card.Description>
					</Card.Header>
					<Card.Content class="demo-card__content">
						<ul class="demo-card__list">
							{#each quiz.teasers as teaser, teaserIndex (`${quiz.id}-teaser-${teaserIndex}`)}
								<li>{teaser}</li>
							{/each}
						</ul>
					</Card.Content>
					<Card.Footer class="demo-card__footer">
						<Button variant="secondary" class="demo-card__button" type="button">
							{quiz.cta}
						</Button>
					</Card.Footer>
				</Card.Root>
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
		--page-width: min(1180px, var(--viewport-inline));
		--page-inline-gutter: max(0px, calc((var(--viewport-inline) - var(--page-width)) / 2));
		--halo-before-width: min(clamp(18rem, 40vw, 28rem), 100%);
		--halo-after-width: min(clamp(18rem, 46vw, 32rem), 100%);
		width: min(1180px, 100%);
		margin: 0 auto;
		padding: clamp(1.75rem, 4vw, 3.25rem) clamp(1.5rem, 6vw, 4rem) clamp(3rem, 8vw, 4.5rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2.5rem, 6vw, 4rem);
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
		filter: blur(68px);
		opacity: 0.6;
		pointer-events: none;
	}

	.page::before {
		inset: clamp(-6rem, -12vw, -2rem) auto auto 0;
		width: var(--halo-before-width);
		height: clamp(14rem, 38vw, 22rem);
		background: radial-gradient(circle at 25% 45%, rgba(129, 140, 248, 0.5), transparent 75%);
		transform: translateX(min(var(--page-inline-gutter), calc(var(--halo-before-width) * 0.25)));
	}

	.page::after {
		inset: auto 0 clamp(-9rem, -16vw, -3rem) auto;
		width: var(--halo-after-width);
		height: clamp(16rem, 44vw, 28rem);
		background: radial-gradient(circle at 60% 60%, rgba(16, 185, 129, 0.22), transparent 80%);
		transform: translateX(-min(var(--page-inline-gutter), calc(var(--halo-after-width) * 0.28)));
	}

	:global([data-theme='dark'] .page::before) {
		background: radial-gradient(circle at 25% 45%, rgba(79, 70, 229, 0.42), transparent 78%);
	}

	:global([data-theme='dark'] .page::after) {
		background: radial-gradient(circle at 60% 60%, rgba(45, 212, 191, 0.22), transparent 78%);
	}

	@media (prefers-color-scheme: dark) {
		.page::before {
			background: radial-gradient(circle at 25% 45%, rgba(79, 70, 229, 0.42), transparent 78%);
		}

		.page::after {
			background: radial-gradient(circle at 60% 60%, rgba(45, 212, 191, 0.22), transparent 78%);
		}
	}

	.top-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		text-decoration: none;
	}

	.brand__icon {
		width: clamp(2.5rem, 5vw, 3rem);
		height: clamp(2.5rem, 5vw, 3rem);
		border-radius: 0.85rem;
		box-shadow: 0 16px 44px var(--shadow-color);
		object-fit: cover;
	}

	.brand__name {
		font-size: clamp(1.05rem, 2.5vw, 1.45rem);
		font-weight: 600;
		color: var(--text-primary);
	}

	.app-label {
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--surface-border);
		background: var(--surface-color);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.layout {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(2rem, 5vw, 3.5rem);
		align-items: stretch;
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 4vw, 2rem);
	}

	.pill {
		align-self: flex-start;
		padding: 0.45rem 0.95rem;
		border-radius: 999px;
		background: var(--surface-color);
		border: 1px solid var(--surface-border);
		box-shadow: 0 12px 32px var(--shadow-color);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.intro__title {
		margin: 0;
		font-size: clamp(2.4rem, 5.4vw, 3.8rem);
		line-height: 1.04;
		letter-spacing: -0.01em;
		font-weight: 700;
	}

	.intro__lead {
		margin: 0;
		font-size: clamp(1.1rem, 2.4vw, 1.35rem);
		line-height: 1.6;
		color: var(--text-secondary);
	}

	.intro__points {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.intro__points li {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		font-size: 1rem;
		line-height: 1.55;
	}

	.intro__points li::before {
		content: '•';
		color: rgba(99, 102, 241, 0.8);
		font-size: 1.3rem;
		line-height: 1;
	}

	.intro__meta {
		margin: 0;
		font-size: 0.95rem;
		color: rgba(100, 116, 139, 0.9);
	}

	.capture {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.upload-area {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: clamp(2rem, 5vw, 3rem);
		border-radius: 1.6rem;
		border: 1.5px dashed rgba(99, 102, 241, 0.25);
		background: linear-gradient(140deg, rgba(255, 255, 255, 0.9), rgba(241, 245, 255, 0.7));
		color: var(--text-primary);
		box-shadow: 0 24px 64px rgba(15, 23, 42, 0.12);
		cursor: pointer;
		overflow: hidden;
		transition:
			border-color 180ms ease,
			box-shadow 180ms ease,
			transform 180ms ease;
	}

	:global([data-theme='dark'] .upload-area) {
		background: linear-gradient(150deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.82));
		border-color: rgba(129, 140, 248, 0.28);
		box-shadow: 0 32px 80px rgba(2, 6, 23, 0.6);
	}

	@media (prefers-color-scheme: dark) {
		.upload-area {
			background: linear-gradient(150deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.82));
			border-color: rgba(129, 140, 248, 0.28);
			box-shadow: 0 32px 80px rgba(2, 6, 23, 0.6);
		}
	}

	.upload-area:hover {
		border-color: rgba(99, 102, 241, 0.45);
		box-shadow: 0 28px 70px rgba(30, 64, 175, 0.18);
		transform: translateY(-2px);
	}

	.upload-area--dragging {
		border-style: solid;
		border-color: rgba(129, 140, 248, 0.7);
	}

	.upload-area--touch {
		border-style: solid;
		border-color: rgba(45, 212, 191, 0.35);
	}

	.upload-area__glow {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(circle at 50% 20%, rgba(129, 140, 248, 0.25), transparent 65%),
			radial-gradient(circle at 20% 80%, rgba(45, 212, 191, 0.18), transparent 70%);
		pointer-events: none;
		opacity: 0.8;
	}

	.upload-area__icon {
		width: clamp(3.25rem, 6vw, 4rem);
		height: clamp(3.25rem, 6vw, 4rem);
		border-radius: 1rem;
		box-shadow: 0 18px 52px rgba(129, 140, 248, 0.25);
	}

	.upload-area__text {
		max-width: 30rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.upload-area__text h2 {
		margin: 0;
		font-size: clamp(1.5rem, 3vw, 2rem);
	}

	.upload-area__text p {
		margin: 0;
		font-size: 1rem;
		line-height: 1.6;
		color: var(--text-secondary);
	}

	.upload-area__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
	}

	.upload-area__button {
		min-width: clamp(8rem, 20vw, 11rem);
	}

	.upload-area__hint {
		margin: 0;
		font-size: 0.95rem;
		color: rgba(71, 85, 105, 0.95);
	}

	.upload-area__disclaimer {
		margin: 0;
		font-size: 0.85rem;
		color: rgba(100, 116, 139, 0.8);
	}

	.upload-summary {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: rgba(255, 255, 255, 0.72);
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.4);
		padding: 1rem 1.25rem;
		font-size: 0.95rem;
	}

	:global([data-theme='dark'] .upload-summary) {
		background: rgba(15, 23, 42, 0.72);
		border-color: rgba(148, 163, 184, 0.32);
	}

	@media (prefers-color-scheme: dark) {
		.upload-summary {
			background: rgba(15, 23, 42, 0.72);
			border-color: rgba(148, 163, 184, 0.32);
		}
	}

	.upload-summary__label {
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.upload-summary__list {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.demo-quizzes {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.5rem);
	}

	.demo-quizzes__header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.demo-quizzes__header h2 {
		margin: 0;
		font-size: clamp(1.8rem, 3.6vw, 2.5rem);
	}

	.demo-quizzes__header p {
		margin: 0;
		max-width: 46ch;
		font-size: 1rem;
		line-height: 1.6;
		color: var(--text-secondary);
	}

	.demo-quizzes__grid {
		display: grid;
		gap: clamp(1.5rem, 3vw, 2.25rem);
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	@media (max-width: 1024px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.intro {
			text-align: center;
		}

		.pill {
			align-self: center;
		}

		.demo-quizzes__grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 720px) {
		.demo-quizzes__grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.upload-area {
			padding: clamp(1.75rem, 6vw, 2.5rem);
		}

		.upload-summary {
			font-size: 0.9rem;
		}
	}

	.demo-card {
		position: relative;
		overflow: hidden;
		border-radius: 1.4rem;
		gap: clamp(1.25rem, 3vw, 1.9rem);
		border-color: rgba(148, 163, 184, 0.32);
		background: linear-gradient(150deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 255, 0.82));
		box-shadow: 0 20px 54px rgba(15, 23, 42, 0.12);
	}

	:global([data-theme='dark'] .demo-card) {
		background: linear-gradient(155deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.82));
		border-color: rgba(148, 163, 184, 0.22);
		box-shadow: 0 30px 70px rgba(2, 6, 23, 0.65);
	}

	@media (prefers-color-scheme: dark) {
		.demo-card {
			background: linear-gradient(155deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.82));
			border-color: rgba(148, 163, 184, 0.22);
			box-shadow: 0 30px 70px rgba(2, 6, 23, 0.65);
		}
	}

	.demo-card::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		mix-blend-mode: screen;
		opacity: 0.7;
	}

	.demo-card--bio::after {
		background:
			radial-gradient(circle at 25% 25%, rgba(16, 185, 129, 0.25), transparent 60%),
			radial-gradient(circle at 80% 70%, rgba(56, 189, 248, 0.18), transparent 70%);
	}

	.demo-card--chem::after {
		background:
			radial-gradient(circle at 20% 30%, rgba(14, 165, 233, 0.22), transparent 60%),
			radial-gradient(circle at 85% 75%, rgba(244, 114, 182, 0.16), transparent 70%);
	}

	.demo-card--phys::after {
		background:
			radial-gradient(circle at 30% 20%, rgba(99, 102, 241, 0.28), transparent 60%),
			radial-gradient(circle at 80% 80%, rgba(59, 130, 246, 0.22), transparent 70%);
	}

	.demo-card__header {
		gap: 1.1rem;
	}

	.subject-tag {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.subject-tag--bio {
		background: rgba(16, 185, 129, 0.15);
		color: rgba(5, 122, 85, 0.95);
		border: 1px solid rgba(16, 185, 129, 0.3);
	}

	.subject-tag--chem {
		background: rgba(14, 165, 233, 0.15);
		color: rgba(6, 95, 140, 0.95);
		border: 1px solid rgba(14, 165, 233, 0.3);
	}

	.subject-tag--phys {
		background: rgba(99, 102, 241, 0.18);
		color: rgba(55, 48, 163, 0.95);
		border: 1px solid rgba(99, 102, 241, 0.35);
	}

	:global([data-theme='dark'] .subject-tag--bio) {
		background: rgba(16, 185, 129, 0.18);
		color: rgba(190, 242, 211, 0.9);
		border-color: rgba(45, 212, 191, 0.35);
	}

	:global([data-theme='dark'] .subject-tag--chem) {
		background: rgba(56, 189, 248, 0.18);
		color: rgba(191, 219, 254, 0.92);
		border-color: rgba(96, 165, 250, 0.35);
	}

	:global([data-theme='dark'] .subject-tag--phys) {
		background: rgba(99, 102, 241, 0.22);
		color: rgba(199, 210, 254, 0.92);
		border-color: rgba(129, 140, 248, 0.36);
	}

	.demo-card__title {
		margin: 0;
		font-size: clamp(1.3rem, 2.4vw, 1.7rem);
		line-height: 1.3;
	}

	.demo-card__description {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--text-secondary);
	}

	.demo-card__content {
		padding-bottom: 0.5rem;
	}

	.demo-card__list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.demo-card__list li {
		position: relative;
		padding-left: 1.4rem;
		font-size: 0.95rem;
		line-height: 1.6;
	}

	.demo-card__list li::before {
		content: '✶';
		position: absolute;
		left: 0;
		top: 0.15rem;
		font-size: 0.8rem;
		color: rgba(99, 102, 241, 0.75);
	}

	.demo-card__footer {
		padding-bottom: 0.5rem;
	}

	.demo-card__button {
		width: 100%;
		justify-content: center;
	}

	@media (max-width: 960px) {
		.intro__points li::before {
			display: none;
		}

		.intro__points li {
			justify-content: center;
			text-align: left;
		}
	}
</style>
