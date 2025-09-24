<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardFooter,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { UploadCloud, Camera, FileUp, Dna, FlaskConical, Atom } from '@lucide/svelte';

	type DemoQuiz = {
		subject: string;
		board: string;
		minutes: string;
		blurb: string;
		questions: string[];
		gradient: string;
		highlight: string;
		Icon: typeof Dna;
	};

	const demoQuizzes: DemoQuiz[] = [
		{
			subject: 'Biology',
			board: 'AQA Biology • Cells & Immunity',
			minutes: '6 min demo',
			blurb: 'Track how immune cells and organelles team up under pressure.',
			questions: [
				'Why does a neutrophil reshape itself before leaving a capillary, and which GCSE transport process powers the squeeze?',
				'A measles booster goes in the right arm but the next morning the left armpit is tender — which lymph nodes reacted first and why?'
			],
			gradient: 'from-emerald-500/30 via-emerald-500/0 to-transparent',
			highlight: 'text-emerald-200',
			Icon: Dna
		},
		{
			subject: 'Chemistry',
			board: 'Edexcel Chemistry • Rates & Quantitative',
			minutes: '7 min demo',
			blurb: 'Spot where reactions race ahead and when equations keep score.',
			questions: [
				'Magnesium ribbon kept under oil is finally weighed hours later — how would the oxidation it dodged have wrecked the mass-change calculation?',
				'Blowing through limewater turns it cloudy then clear again; which equilibrium expression proves carbon dioxide is still in charge?'
			],
			gradient: 'from-cyan-400/35 via-cyan-500/0 to-transparent',
			highlight: 'text-cyan-200',
			Icon: FlaskConical
		},
		{
			subject: 'Physics',
			board: 'OCR Physics • Circuits & Waves',
			minutes: '5 min demo',
			blurb: 'Connect curious phenomena back to the core circuit and wave rules.',
			questions: [
				'A rolled-up LED strip suddenly dims halfway along — which GCSE circuit law predicts the fading segment when the bend boosts resistance?',
				'During a lunar eclipse the Moon glows copper-red instead of vanishing; which wave phenomenon and GCSE equation explain the glow?'
			],
			gradient: 'from-indigo-500/30 via-indigo-500/0 to-transparent',
			highlight: 'text-indigo-200',
			Icon: Atom
		}
	];
</script>

<svelte:head>
	<title>GCSE Spark — App home</title>
	<meta
		name="description"
		content="Start in the Spark app by snapping or uploading GCSE science notes, then explore ready-made Biology, Chemistry, and Physics demos."
	/>
</svelte:head>

<div class="app-surface">
	<div class="app-page">
		<header class="app-header">
			<div class="brand" aria-label="GCSE Spark">
				<img src="/favicon.png" alt="GCSE Spark logo" width="36" height="36" loading="lazy" />
				<span class="brand__name">GCSE Spark</span>
			</div>
			<p class="app-status">Beta preview</p>
		</header>

		<main class="app-main" aria-label="Spark capture home">
			<section class="intro">
				<span class="intro__pill">Turn class notes into calm practice</span>
				<h1 class="intro__title">One button, and your science notes become exam-ready practice</h1>
				<p class="intro__lead">
					Snap tonight's worksheet or drop a PDF. Spark recognises the board, maps the topic, and
					builds a ten-question warm-up with explanations in under a minute.
				</p>
				<ul class="intro__points" aria-label="Why Spark feels different">
					<li>
						<span class="intro__points-label">Understands your context</span>
						Auto-detects AQA, Edexcel, or OCR plus the exact GCSE triple science topic.
					</li>
					<li>
						<span class="intro__points-label">Fast, focused sets</span>
						Each practice burst lasts 4–7 minutes with live progress updates.
					</li>
					<li>
						<span class="intro__points-label">Gentle guidance</span>
						Calm summaries show what's solid and where to focus next—no noisy streaks.
					</li>
				</ul>
			</section>

			<section class="capture" aria-label="Upload or capture study material">
				<Button class="capture__button" type="button">
					<div class="capture__halo" aria-hidden="true"></div>
					<div class="capture__content">
						<div class="capture__headline">
							<div class="capture__icon">
								<UploadCloud aria-hidden="true" />
							</div>
							<div class="capture__text">
								<h2>Scan or upload your study materials</h2>
								<p>
									Tap to take a photo, choose images or PDFs up to 15&nbsp;MB, or drag a file
									straight onto this space when you're on a desktop.
								</p>
							</div>
						</div>
						<div class="capture__actions" aria-label="Capture options">
							<span class="capture__chip">
								<Camera aria-hidden="true" />
								Snap a page
							</span>
							<span class="capture__chip">
								<FileUp aria-hidden="true" />
								Upload PDF or image
							</span>
							<span class="capture__chip">
								<UploadCloud aria-hidden="true" />
								Drag &amp; drop (desktop)
							</span>
						</div>
						<ul class="capture__tips" aria-label="Helpful capture tips">
							<li>Bright, even lighting keeps text crisp for OCR.</li>
							<li>Multiple pages? We'll keep them in order automatically.</li>
							<li>Include mark-scheme answers to unlock instant self-check mode.</li>
						</ul>
					</div>
				</Button>
			</section>

			<section class="demo" aria-label="Try a ready-made quiz">
				<div class="demo__header">
					<h2>Try a Spark demo set</h2>
					<p>
						Explore three pre-built practice runs that mix multiple choice, short answer, and
						explanation reveals—each grounded in real GCSE science scenarios.
					</p>
				</div>
				<div class="demo__grid">
					{#each demoQuizzes as quiz (quiz.subject)}
						<Card class="quiz-card">
							<div
								class={`quiz-card__glow bg-gradient-to-br ${quiz.gradient}`}
								aria-hidden="true"
							></div>
							<CardHeader class="quiz-card__header">
								<span class="quiz-card__subject">
									<svelte:component this={quiz.Icon} aria-hidden="true" />
									{quiz.subject}
								</span>
								<CardTitle>{quiz.board}</CardTitle>
								<CardDescription>{quiz.blurb}</CardDescription>
							</CardHeader>
							<CardContent class="quiz-card__content">
								<p class={`quiz-card__teaser ${quiz.highlight}`}>
									{quiz.minutes}
								</p>
								<ul>
									{#each quiz.questions as question, index (index)}
										<li>{question}</li>
									{/each}
								</ul>
							</CardContent>
							<CardFooter class="quiz-card__footer">
								<Button variant="secondary" class="quiz-card__cta"
									>Play the {quiz.subject} demo</Button
								>
							</CardFooter>
						</Card>
					{/each}
				</div>
			</section>
		</main>
	</div>
</div>

<style>
	:global(:root) {
		--app-surface-light:
			radial-gradient(circle at top left, rgba(56, 189, 248, 0.08), transparent 60%),
			radial-gradient(circle at top right, rgba(124, 58, 237, 0.1), transparent 55%),
			linear-gradient(150deg, #030712 0%, #050b1f 48%, #0b1735 100%);
		--app-surface-dark:
			radial-gradient(circle at top left, rgba(56, 189, 248, 0.04), transparent 60%),
			radial-gradient(circle at top right, rgba(124, 58, 237, 0.08), transparent 55%),
			linear-gradient(150deg, #01030a 0%, #040a1a 45%, #060f26 100%);
	}

	.app-surface {
		min-height: 100vh;
		background: var(--app-surface-light);
		color: var(--foreground);
		display: flex;
		justify-content: center;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1.5rem, 5vw, 3.75rem);
		box-sizing: border-box;
	}

	:global(.dark) .app-surface {
		background: var(--app-surface-dark);
	}

	.app-page {
		--halo-before-width: min(clamp(18rem, 42vw, 26rem), 100%);
		--halo-after-width: min(clamp(20rem, 52vw, 32rem), 100%);
		width: min(1160px, 100%);
		display: flex;
		flex-direction: column;
		gap: clamp(2.5rem, 5vw, 3.75rem);
		position: relative;
		isolation: isolate;
	}

	.app-page::before,
	.app-page::after {
		content: '';
		position: absolute;
		z-index: -1;
		border-radius: 50%;
		filter: blur(64px);
		opacity: 0.55;
		pointer-events: none;
	}

	.app-page::before {
		inset: clamp(2rem, 6vw, 4rem) auto auto clamp(1rem, 8vw, 5rem);
		width: var(--halo-before-width);
		aspect-ratio: 1;
		background: radial-gradient(circle, rgba(56, 189, 248, 0.22), transparent 70%);
	}

	.app-page::after {
		inset: auto clamp(1rem, 7vw, 4.5rem) clamp(1.5rem, 8vw, 5.5rem) auto;
		width: var(--halo-after-width);
		aspect-ratio: 1;
		background: radial-gradient(circle, rgba(129, 140, 248, 0.24), transparent 70%);
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: rgba(248, 250, 252, 0.94);
	}

	.brand__name {
		font-size: clamp(1.15rem, 2vw, 1.35rem);
	}

	.app-status {
		font-size: 0.875rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: rgba(226, 232, 240, 0.72);
	}

	.app-main {
		display: flex;
		flex-direction: column;
		gap: clamp(2.5rem, 6vw, 4.5rem);
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 44rem;
	}

	.intro__pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: rgba(226, 232, 240, 0.9);
	}

	.intro__title {
		font-size: clamp(2.1rem, 4vw, 3rem);
		line-height: 1.1;
		font-weight: 600;
		color: rgba(248, 250, 252, 0.96);
	}

	.intro__lead {
		font-size: clamp(1.075rem, 2vw, 1.25rem);
		line-height: 1.6;
		color: rgba(226, 232, 240, 0.88);
	}

	.intro__points {
		display: grid;
		gap: 1.25rem;
		font-size: 0.95rem;
		line-height: 1.6;
		color: rgba(226, 232, 240, 0.85);
	}

	.intro__points li {
		display: grid;
		gap: 0.25rem;
	}

	.intro__points-label {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(148, 163, 184, 0.88);
	}

	.capture {
		display: grid;
	}

	.capture__button {
		position: relative;
		overflow: hidden;
		border-radius: 1.5rem;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: rgba(15, 23, 42, 0.42);
		color: rgba(241, 245, 249, 0.96);
		padding: clamp(1.75rem, 4vw, 2.75rem);
		text-align: left;
		align-items: stretch;
		justify-content: flex-start;
		box-shadow: 0 24px 48px -24px rgba(15, 23, 42, 0.5);
	}

	.capture__button:hover,
	.capture__button:focus-visible {
		transform: translateY(-2px);
		border-color: rgba(148, 163, 184, 0.36);
	}

	.capture__halo {
		position: absolute;
		inset: -20%;
		background: radial-gradient(circle, rgba(59, 130, 246, 0.28), transparent 70%);
		opacity: 0.7;
		transition: opacity 200ms ease;
	}

	.capture__button:hover .capture__halo,
	.capture__button:focus-visible .capture__halo {
		opacity: 0.9;
	}

	.capture__content {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 3vw, 1.75rem);
	}

	.capture__headline {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	@media (min-width: 720px) {
		.capture__headline {
			flex-direction: row;
			align-items: flex-start;
			gap: 1.75rem;
		}
	}

	.capture__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: clamp(3.25rem, 8vw, 3.75rem);
		height: clamp(3.25rem, 8vw, 3.75rem);
		border-radius: 50%;
		background: rgba(14, 165, 233, 0.18);
		color: rgba(125, 211, 252, 0.95);
	}

	.capture__text h2 {
		font-size: clamp(1.45rem, 3vw, 1.85rem);
		font-weight: 600;
		line-height: 1.25;
		color: rgba(248, 250, 252, 0.94);
	}

	.capture__text p {
		margin-top: 0.5rem;
		font-size: 1.05rem;
		line-height: 1.6;
		color: rgba(226, 232, 240, 0.85);
	}

	.capture__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		color: rgba(241, 245, 249, 0.92);
	}

	.capture__chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.5);
		border: 1px solid rgba(148, 163, 184, 0.25);
		font-size: 0.95rem;
	}

	.capture__chip svg {
		width: 1.1rem;
		height: 1.1rem;
	}

	.capture__tips {
		display: grid;
		gap: 0.6rem;
		font-size: 0.9rem;
		line-height: 1.55;
		color: rgba(203, 213, 225, 0.85);
	}

	.demo {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.25rem);
	}

	.demo__header {
		max-width: 44rem;
		display: grid;
		gap: 0.75rem;
	}

	.demo__header h2 {
		font-size: clamp(1.75rem, 3vw, 2.25rem);
		font-weight: 600;
		color: rgba(248, 250, 252, 0.94);
	}

	.demo__header p {
		font-size: 1rem;
		line-height: 1.6;
		color: rgba(203, 213, 225, 0.86);
	}

	.demo__grid {
		display: grid;
		gap: clamp(1.5rem, 3vw, 2rem);
	}

	@media (min-width: 960px) {
		.demo__grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (min-width: 640px) and (max-width: 959px) {
		.demo__grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.quiz-card {
		position: relative;
		overflow: hidden;
		border-radius: 1.25rem;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: rgba(15, 23, 42, 0.45);
		color: rgba(241, 245, 249, 0.95);
		min-height: 100%;
	}

	.quiz-card__glow {
		position: absolute;
		inset: -18% -5% auto -5%;
		height: 68%;
		border-radius: 50%;
		filter: blur(48px);
		opacity: 0.75;
		pointer-events: none;
	}

	.quiz-card__header {
		position: relative;
		display: grid;
		gap: 0.6rem;
	}

	.quiz-card__subject {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: rgba(226, 232, 240, 0.88);
	}

	.quiz-card__subject svg {
		width: 1.1rem;
		height: 1.1rem;
	}

	.quiz-card__header h3 {
		font-size: 1.25rem;
		line-height: 1.35;
	}

	.quiz-card__header p {
		font-size: 0.95rem;
		line-height: 1.6;
		color: rgba(203, 213, 225, 0.85);
	}

	.quiz-card__content {
		position: relative;
		display: grid;
		gap: 1rem;
		font-size: 0.95rem;
		line-height: 1.6;
		color: rgba(226, 232, 240, 0.88);
	}

	.quiz-card__teaser {
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.quiz-card__content ul {
		display: grid;
		gap: 0.75rem;
	}

	.quiz-card__content li {
		position: relative;
		padding-left: 1rem;
	}

	.quiz-card__content li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.65rem;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.45;
	}

	.quiz-card__footer {
		position: relative;
	}

	.quiz-card__cta {
		width: 100%;
		justify-content: center;
		background: rgba(226, 232, 240, 0.15);
		color: rgba(248, 250, 252, 0.95);
	}

	.quiz-card__cta:hover,
	.quiz-card__cta:focus-visible {
		background: rgba(226, 232, 240, 0.25);
	}

	@media (max-width: 640px) {
		.app-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.app-status {
			align-self: flex-end;
		}

		.intro__points {
			gap: 1rem;
		}

		.capture__actions {
			flex-direction: column;
			align-items: flex-start;
		}

		.quiz-card__cta {
			justify-content: flex-start;
		}
	}
</style>
