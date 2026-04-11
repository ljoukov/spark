<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import SheetPreviewNav from '../SheetPreviewNav.svelte';

	type ThumbnailStateTone = 'ready' | 'graded' | 'grading';

	type ThumbnailTheme = {
		color: string;
		accent: string;
		light: string;
		border: string;
	};

	type ThumbnailCard = {
		id: string;
		eyebrow: string;
		title: string;
		subtitle: string;
		marksValue: string;
		marksDetail?: string;
		statusLabel: string;
		statusTone: ThumbnailStateTone;
		updatedAt: string;
		summary: string;
		footer: string;
		theme: ThumbnailTheme;
	};

	type ThumbnailExploration = {
		id: string;
		label: string;
		title: string;
		description: string;
		recommendation?: string;
		keep: string[];
		strip: string[];
		cards: ThumbnailCard[];
	};

	const principles = [
		'Header owns identity: level, subject, and worksheet title should not repeat in the footer.',
		'Marks box owns the score: ratio first, percentage second, no extra status sentence inside it.',
		'Main text should answer one question only: what is this sheet, what happened, or what happens next.',
		'Footer should earn its space with provenance, topics, or retrieval cues instead of title repetition.'
	] as const;

	const physicsTheme: ThumbnailTheme = {
		color: '#315b8b',
		accent: '#4d7aa5',
		light: '#eef5fc',
		border: '#c8d9ea'
	};

	const uploadTheme: ThumbnailTheme = {
		color: '#5d7188',
		accent: '#7f95ad',
		light: '#edf3fa',
		border: '#c9d6e3'
	};

	const mathTheme: ThumbnailTheme = {
		color: '#456d90',
		accent: '#5f8fb8',
		light: '#eff6fc',
		border: '#cadaeb'
	};

	const explorations: ThumbnailExploration[] = [
		{
			id: 'signal-first',
			label: 'Recommended',
			title: 'Signal-first summary',
			description:
				'Best balance for the real list page. Header handles identity, body carries one outcome sentence, and the footer becomes provenance instead of a repeated title.',
			recommendation: 'Strongest default for production list cards.',
			keep: [
				'One clean sentence in the body, tuned to the current state.',
				'Footer as provenance: board, paper, source.',
				'Marks box limited to ratio plus percent.'
			],
			strip: [
				'Repeated title or subject in the footer.',
				'Multiple explanatory sentences in the card body.',
				'Any second score row below the summary.'
			],
			cards: [
				{
					id: 'signal-ready',
					eyebrow: 'GCSE Higher · Combined Science: Trilogy Physics',
					title: 'AQA GCSE Combined Science: Trilogy Physics Paper 1H',
					subtitle: 'June 2024 handwritten responses matched to the uploaded paper',
					marksValue: '— / 70',
					statusLabel: 'Ready to solve',
					statusTone: 'ready',
					updatedAt: 'Apr 1, 2026, 10:49 PM',
					summary:
						'Ready to solve across six sections covering energy stores, power equations, circuit components, and graph interpretation.',
					footer: 'AQA · Paper 1H · uploaded paper + notebook pages',
					theme: physicsTheme
				},
				{
					id: 'signal-graded',
					eyebrow: 'GCSE Higher · Combined Science: Trilogy Physics',
					title: 'AQA GCSE Combined Science Trilogy Physics Paper 1H',
					subtitle: 'June 2024 handwritten responses graded against the uploaded paper',
					marksValue: '60 / 70',
					marksDetail: '85.7%',
					statusLabel: 'Graded',
					statusTone: 'graded',
					updatedAt: 'Apr 1, 2026, 10:55 PM',
					summary:
						'Strong on calculation questions; most dropped marks came from explanation detail, the unfinished graph, and the final 06.4 response.',
					footer: 'AQA · Paper 1H · uploaded paper + notebook pages',
					theme: physicsTheme
				},
				{
					id: 'signal-grading',
					eyebrow: 'Worksheet · Submission',
					title: 'Uploaded worksheet',
					subtitle: 'Scanned handwritten answers from a mixed worksheet upload',
					marksValue: 'Not graded',
					statusLabel: 'Grading',
					statusTone: 'grading',
					updatedAt: 'Apr 1, 2026, 10:58 PM',
					summary:
						'Grader is still assembling marks and feedback from the uploaded worksheet before publishing the review.',
					footer: 'Uploaded worksheet · handwritten answers',
					theme: uploadTheme
				}
			]
		},
		{
			id: 'topic-strip',
			label: 'Alternative',
			title: 'Topic-strip footer',
			description:
				'Good when the list is used as a revision shelf. The footer stops behaving like provenance and instead turns into a compact retrieval cue for what is inside the sheet.',
			keep: [
				'Footer as revision topics for faster scanning.',
				'Body summary shortened to one line of status or performance.',
				'Title kept fully intact for exam specificity.'
			],
			strip: [
				'Board/paper/source detail from the footer.',
				'Long narrative summaries that bury the topic signal.',
				'Redundant "worksheet" wording in the subtitle.'
			],
			cards: [
				{
					id: 'topic-ready',
					eyebrow: 'Secondary · Mathematics',
					title: '1.13 Calculating interest and percentage',
					subtitle: 'Worksheet 1.13 reconstructed from the uploaded page set',
					marksValue: '— / 11',
					statusLabel: 'Ready to solve',
					statusTone: 'ready',
					updatedAt: 'Apr 1, 2026, 10:07 PM',
					summary:
						'Ready to solve with mixed multiple-choice, fill-in, and written-solution questions.',
					footer: 'simple interest · tax · accrued amount · percentages',
					theme: mathTheme
				},
				{
					id: 'topic-graded',
					eyebrow: 'Secondary · Mathematics',
					title: 'Calculating interest and percentage',
					subtitle: 'Marked from the uploaded worksheet and saved answers',
					marksValue: '8 / 11',
					marksDetail: '72.7%',
					statusLabel: 'Graded',
					statusTone: 'graded',
					updatedAt: 'Mar 29, 2026, 9:47 PM',
					summary:
						'Secure on short percentage questions; the main slip was separating interest, after-tax interest, and accrued amount in longer problems.',
					footer: 'simple interest · tax · accrued amount · percentages',
					theme: mathTheme
				},
				{
					id: 'topic-grading',
					eyebrow: 'Secondary · Mathematics',
					title: 'Calculating interest and percentage',
					subtitle: 'Handwritten responses are still being parsed for marking',
					marksValue: 'Not graded',
					statusLabel: 'Grading',
					statusTone: 'grading',
					updatedAt: 'Apr 1, 2026, 10:38 PM',
					summary:
						'Waiting on the grader report for the long-response workings and the final summary note.',
					footer: 'simple interest · tax · accrued amount · percentages',
					theme: mathTheme
				}
			]
		},
		{
			id: 'next-step',
			label: 'Alternative',
			title: 'Next-step guidance',
			description:
				'Most tutor-like. The card body is optimized around what the student should do next, while the footer keeps the source context light and factual.',
			keep: [
				'Body copy written as an actionable next move.',
				'Footer stays factual and quiet.',
				'Best fit for graded cards when the list doubles as a revision queue.'
			],
			strip: [
				'Performance recap that does not change what the learner should do.',
				'Footer topic strips if the page already shows many similar sheets.',
				'Any extra "awaiting grading" language in the marks box.'
			],
			cards: [
				{
					id: 'next-ready',
					eyebrow: 'GCSE Higher · Combined Science: Trilogy Physics',
					title: 'AQA GCSE Combined Science: Trilogy Physics Paper 1H',
					subtitle: 'June 2024 handwritten responses from the uploaded paper',
					marksValue: '— / 70',
					statusLabel: 'Ready to solve',
					statusTone: 'ready',
					updatedAt: 'Apr 1, 2026, 10:49 PM',
					summary:
						'Next: open the worksheet and work through the six sections in order before sending it for grading.',
					footer: 'AQA · Paper 1H · uploaded paper',
					theme: physicsTheme
				},
				{
					id: 'next-graded',
					eyebrow: 'GCSE Higher · Combined Science: Trilogy Physics',
					title: 'AQA GCSE Combined Science Trilogy Physics Paper 1H',
					subtitle: 'June 2024 handwritten responses graded against the uploaded paper',
					marksValue: '60 / 70',
					marksDetail: '85.7%',
					statusLabel: 'Graded',
					statusTone: 'graded',
					updatedAt: 'Apr 1, 2026, 10:55 PM',
					summary:
						'Next focus: tighten explanation detail, finish the graph question, and revisit the final 06.4 long response.',
					footer: 'AQA · Paper 1H · uploaded paper',
					theme: physicsTheme
				},
				{
					id: 'next-grading',
					eyebrow: 'Worksheet · Submission',
					title: 'Uploaded worksheet',
					subtitle: 'Mixed handwritten responses from a scanned upload',
					marksValue: 'Not graded',
					statusLabel: 'Grading',
					statusTone: 'grading',
					updatedAt: 'Apr 1, 2026, 10:58 PM',
					summary:
						'Next: wait for the grader report to land, then reopen the card for marks and a single review sentence.',
					footer: 'Uploaded worksheet · scanned handwriting',
					theme: uploadTheme
				}
			]
		}
	];

	function buildCardStyle(theme: ThumbnailTheme): string {
		return [
			`--thumb-color:${theme.color}`,
			`--thumb-accent:${theme.accent}`,
			`--thumb-light:${theme.light}`,
			`--thumb-border:${theme.border}`
		].join('; ');
	}
</script>

<svelte:head>
	<title>Sheet thumbnail explorations · Spark admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">
				Sheet thumbnail explorations
			</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Thumbnail studies for the <code>/spark/sheets</code> list. These keep the same card
				structure as production while testing leaner content outputs before touching any
				generation prompts.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
			<a href="/admin/ui/sheet" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Sheet overview
			</a>
		</div>

		<SheetPreviewNav current="thumbnails" />
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Thumbnail rules</Card.Title>
			<Card.Description>
				The goal is to keep the card shape users already recognize while making every region earn
				its space.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			{#each principles as principle}
				<div class="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
					{principle}
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	{#each explorations as exploration (exploration.id)}
		<Card.Root class="border-border/70 bg-card/95 shadow-sm">
			<Card.Header class="gap-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
							>
								{exploration.label}
							</span>
							{#if exploration.recommendation}
								<span class="text-xs font-medium text-emerald-700">
									{exploration.recommendation}
								</span>
							{/if}
						</div>
						<Card.Title>{exploration.title}</Card.Title>
						<Card.Description>{exploration.description}</Card.Description>
					</div>
				</div>
			</Card.Header>
			<Card.Content class="space-y-5">
				<div class="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
					<div class="space-y-4">
						<div class="space-y-2">
							<p class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
								Keep
							</p>
							<div class="space-y-2">
								{#each exploration.keep as item}
									<p class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
										{item}
									</p>
								{/each}
							</div>
						</div>

						<div class="space-y-2">
							<p class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
								Strip
							</p>
							<div class="space-y-2">
								{#each exploration.strip as item}
									<p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
										{item}
									</p>
								{/each}
							</div>
						</div>
					</div>

					<div class="thumbnail-grid">
						{#each exploration.cards as item (item.id)}
							<article class="thumbnail-card" style={buildCardStyle(item.theme)}>
								<header class="thumbnail-card__header">
									<div class="thumbnail-card__header-inner">
										<div class="thumbnail-card__marks">
											<p class="thumbnail-card__marks-label">Marks</p>
											<p class="thumbnail-card__marks-value">{item.marksValue}</p>
											{#if item.marksDetail}
												<p class="thumbnail-card__marks-detail">{item.marksDetail}</p>
											{/if}
										</div>

										<p class="thumbnail-card__eyebrow">{item.eyebrow}</p>
										<h3 class="thumbnail-card__title">{item.title}</h3>
										<p class="thumbnail-card__subtitle">{item.subtitle}</p>
									</div>
								</header>

								<div class="thumbnail-card__body">
									<div class="thumbnail-card__meta">
										<span class="thumbnail-card__status" data-tone={item.statusTone}>
											{item.statusLabel}
										</span>
										<span>{item.updatedAt}</span>
									</div>
									<p class="thumbnail-card__summary">{item.summary}</p>
								</div>

								<footer class="thumbnail-card__footer">{item.footer}</footer>
							</article>
						{/each}
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	{/each}
</div>

<style lang="postcss">
	.thumbnail-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(16.75rem, 1fr));
	}

	.thumbnail-card {
		overflow: hidden;
		border-radius: 1.15rem;
		border: 1px solid var(--thumb-border);
		background: white;
		box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
	}

	.thumbnail-card__header {
		padding: 1rem 1rem 0.9rem;
		background:
			radial-gradient(circle at 92% 16%, color-mix(in srgb, var(--thumb-accent) 18%, transparent) 0 18%, transparent 19%),
			radial-gradient(circle at 82% 6%, color-mix(in srgb, var(--thumb-color) 8%, transparent) 0 16%, transparent 17%),
			linear-gradient(135deg, var(--thumb-light) 0%, white 100%);
		border-bottom: 1px solid var(--thumb-border);
	}

	.thumbnail-card__header-inner {
		display: flow-root;
	}

	.thumbnail-card__marks {
		float: right;
		width: 6.8rem;
		min-width: 6.8rem;
		margin: 0 0 0.55rem 0.75rem;
		padding: 0.52rem 0.66rem;
		text-align: center;
		border-radius: 0.9rem;
		background: white;
		border: 1px solid var(--thumb-border);
	}

	.thumbnail-card__marks-label {
		margin: 0;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--thumb-color) 60%, transparent);
	}

	.thumbnail-card__marks-value {
		margin: 0.16rem 0 0;
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.05;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		color: var(--thumb-color);
	}

	.thumbnail-card__marks-detail {
		margin: 0.12rem 0 0;
		font-size: 0.68rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, var(--thumb-color) 66%, transparent);
	}

	.thumbnail-card__eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: var(--thumb-accent);
	}

	.thumbnail-card__title {
		margin: 0.42rem 0 0;
		font-size: 1.2rem;
		line-height: 1.08;
		color: var(--thumb-color);
	}

	.thumbnail-card__subtitle {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
		line-height: 1.35;
		color: color-mix(in srgb, var(--thumb-color) 74%, transparent);
	}

	.thumbnail-card__body {
		display: flex;
		flex-direction: column;
		gap: 0.72rem;
		padding: 0.9rem 1rem 1rem;
	}

	.thumbnail-card__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		align-items: center;
		font-size: 0.76rem;
		color: color-mix(in srgb, black 48%, transparent);
	}

	.thumbnail-card__status {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.16rem 0.52rem;
		font-size: 0.69rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.thumbnail-card__status[data-tone='ready'] {
		background: color-mix(in srgb, #16a34a 14%, transparent);
		color: color-mix(in srgb, #166534 88%, black 8%);
	}

	.thumbnail-card__status[data-tone='graded'] {
		background: color-mix(in srgb, #14b8a6 14%, transparent);
		color: color-mix(in srgb, #0f766e 88%, black 8%);
	}

	.thumbnail-card__status[data-tone='grading'] {
		background: color-mix(in srgb, #0ea5e9 14%, transparent);
		color: color-mix(in srgb, #075985 88%, black 8%);
	}

	.thumbnail-card__summary {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.48;
		color: #1f2937;
	}

	.thumbnail-card__footer {
		border-top: 1px solid var(--thumb-border);
		padding: 0.8rem 1rem 0.85rem;
		font-size: 0.76rem;
		line-height: 1.35;
		color: color-mix(in srgb, var(--thumb-color) 72%, transparent);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, var(--thumb-light) 150%);
	}

	@media (max-width: 700px) {
		.thumbnail-card__marks {
			width: 6.35rem;
			min-width: 6.35rem;
			margin-left: 0.6rem;
		}
	}
</style>
