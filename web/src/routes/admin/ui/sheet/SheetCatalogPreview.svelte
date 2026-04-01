<script lang="ts">
	import {
		AnnotatedTextPanel,
		sampleAnnotatedTextDocument
	} from '$lib/components/annotated-text/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import {
		PaperSheet,
		PaperSheetQuestionFeedback,
		samplePaperSheets,
		type PaperSheetAnswers,
		type PaperSheetData,
		type PaperSheetFeedbackAttachment,
		type PaperSheetFeedbackThread,
		type PaperSheetQuestionReview,
		type PaperSheetReview
	} from '$lib/components/paper-sheet/index.js';
	import { cn } from '$lib/utils.js';
	import type { SheetCatalogItem } from './catalog-data';

	type RuntimeStage = 'pending' | 'thinking' | 'responding' | 'resolved';
	type ReviewMode = 'none' | 'live' | 'mock';

	type SheetPreviewConfig = {
		sheet: PaperSheetData;
		heightClass: string;
		reviewMode?: ReviewMode;
		answers?: PaperSheetAnswers;
		review?: PaperSheetReview | null;
		editable?: boolean;
		showFooter?: boolean;
		scrollToBottom?: boolean;
	};

	const SAMPLE_IMAGE_PREVIEW_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">
			<rect width="320" height="220" fill="#f5eee1"/>
			<rect x="22" y="22" width="276" height="176" rx="20" fill="#fffdfa" stroke="#cfbfa5" stroke-width="4"/>
			<rect x="54" y="48" width="212" height="104" rx="12" fill="#e7f0ea"/>
			<circle cx="94" cy="84" r="18" fill="#f3b35a"/>
			<path d="M72 152l40-34 34 22 38-42 50 54H72z" fill="#4d8d70"/>
			<text x="160" y="182" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#6a5646">working photo</text>
		</svg>`
	)}`;

	const SAMPLE_TEXT_FILE_URL = `data:text/plain;charset=utf-8,${encodeURIComponent(
		[
			'Divisor recount',
			'44, 45, 55, 60, 66, 90, 99, 110, 132, 165, 180, 198, 220, 330, 396, 495, 660, 990, 1980'
		].join('\n')
	)}`;

	const baseReview: PaperSheetQuestionReview = {
		status: 'teacher-review',
		label: 'Review note',
		statusLabel: 'reflection prompt',
		note: 'Your method is on the right track, but the final count slips. Recount the values above 43 and check whether 44 belongs in the list.',
		replyPlaceholder: 'Explain what you would fix.',
		followUp: 'Good. Now rewrite the final sentence so the count and the list agree.'
	};

	const sharedThread: PaperSheetFeedbackThread = {
		status: 'open',
		turns: [
			{
				id: 'student-reply',
				speaker: 'student',
				text: 'I think I forgot to include some larger factor pairs.'
			},
			{
				id: 'tutor-reply',
				speaker: 'tutor',
				text: 'That is the right place to look. Recount them in order so the missing values stand out.'
			}
		]
	};

	function createAttachment(kind: 'image' | 'text'): PaperSheetFeedbackAttachment {
		if (kind === 'image') {
			return {
				id: 'preview-image',
				filename: 'divisor-working.png',
				contentType: 'image/png',
				sizeBytes: 248_000,
				url: SAMPLE_IMAGE_PREVIEW_URL
			};
		}

		return {
			id: 'preview-text',
			filename: 'divisor-list.txt',
			contentType: 'text/plain',
			sizeBytes: 1_280,
			url: SAMPLE_TEXT_FILE_URL
		};
	}

	function createPreviewSheet(config: {
		id: string;
		title?: string;
		subtitle?: string;
		subject?: string;
		level?: string;
		sections: PaperSheetData['sections'];
		initialAnswers?: PaperSheetAnswers;
		mockReview?: PaperSheetReview;
	}): PaperSheetData {
		return {
			id: config.id,
			subject: config.subject ?? 'Science',
			level: config.level ?? 'KS3',
			title: config.title ?? 'Sheet preview',
			subtitle: config.subtitle ?? 'Catalog specimen',
			color: '#1A3A5C',
			accent: '#2E6DA4',
			light: '#F0F4F9',
			border: '#B0C8E4',
			sections: config.sections,
			...(config.initialAnswers ? { initialAnswers: config.initialAnswers } : {}),
			...(config.mockReview ? { mockReview: config.mockReview } : {})
		};
	}

	function buildQuestionSheet(kind: SheetCatalogItem['previewKind']): SheetPreviewConfig {
		if (kind === 'fill') {
			return {
				sheet: createPreviewSheet({
					id: 'catalog-fill',
					title: 'Iron preview',
					sections: [
						{
							id: 'A',
							label: 'Rusting',
							theory:
								'Rusting is a chemical reaction where iron reacts with **oxygen** and **water**.',
							questions: [
								{
									id: 'fill-1',
									type: 'fill',
									marks: 1,
									prompt: 'For iron to rust, it must be in contact with both',
									blanks: [{ placeholder: 'first reactant' }, { placeholder: 'second reactant' }],
									conjunction: 'and',
									after: '.'
								}
							]
						}
					],
					initialAnswers: {
						'fill-1': {
							'0': 'oxygen',
							'1': 'water'
						}
					}
				}),
				heightClass: 'h-[24rem]'
			};
		}

		if (kind === 'group') {
			return {
				sheet: createPreviewSheet({
					id: 'catalog-group',
					title: 'Interest preview',
					subject: 'Mathematics',
					level: 'Secondary',
					sections: [
						{
							id: 'C',
							label: 'Questions that require solutions',
							questions: [
								{
									id: 'q9',
									type: 'calc',
									displayNumber: '9',
									marks: 1,
									prompt:
										'Lily deposited £20 000 in a bank for a period of one year. The annual interest rate was 2.25% and the tax rate was 20% on the interest earned. How much is the accrued amount of money Lily received after tax at the end of one year?',
									inputLabel: 'Answer',
									unit: '£'
								},
								{
									id: 'q10',
									type: 'group',
									displayNumber: '10',
									prompt:
										'For Question 10, use the table below.\n\n| Duration of deposit | Before | After |\n| --- | ---: | ---: |\n| 1 year | 3.60% | 2.52% |\n| 2 years | 4.14% | 3.06% |\n| 3 years | 4.77% | 3.60% |\n| 5 years | 5.13% | 3.87% |',
									questions: [
										{
											id: 'q10a',
											type: 'fill',
											displayNumber: '10(a)',
											badgeLabel: 'a',
											marks: 1,
											prompt:
												'For a three-year fixed deposit of £10 000, the interest earned under the new interest rate will be £',
											blanks: [{ minWidth: 120 }],
											after:
												' less than the interest that would be earned under the original interest rate.'
										},
										{
											id: 'q10b',
											type: 'lines',
											displayNumber: '10(b)',
											badgeLabel: 'b',
											marks: 1,
											prompt:
												'Lee’s family would like to deposit £50 000 for a period of two years. Lee suggests opening a two-year fixed deposit account for the money. His brother suggests opening a one-year fixed deposit first and at the end of one year, withdrawing the accrued amount and then re-depositing the total amount for a second year. Whose suggestion will earn more interest? By how much is it more? (Round your answer to integers.)',
											lines: 4
										}
									]
								}
							]
						}
					]
				}),
				heightClass: 'h-[34rem]'
			};
		}

		if (kind === 'mcq') {
			return {
				sheet: createPreviewSheet({
					id: 'catalog-mcq',
					title: 'Iron preview',
					sections: [
						{
							id: 'A',
							label: 'Properties & Uses',
							questions: [
								{
									id: 'mcq-1',
									type: 'mcq',
									marks: 1,
									prompt: 'What is iron combined with to make steel?',
									options: ['Copper', 'Aluminium', 'Carbon', 'Zinc']
								}
							]
						}
					],
					initialAnswers: {
						'mcq-1': 'Carbon'
					}
				}),
				heightClass: 'h-[24rem]'
			};
		}

		if (kind === 'lines') {
			return {
				sheet: createPreviewSheet({
					id: 'catalog-lines',
					title: 'Romans preview',
					subject: 'History',
					level: 'KS2',
					sections: [
						{
							id: 'A',
							label: 'Roman Life in Britain',
							questions: [
								{
									id: 'lines-1',
									type: 'lines',
									marks: 3,
									prompt:
										'Describe THREE ways the Romans changed life in Britain. Use evidence from the theory above.',
									lines: 5
								}
							]
						}
					],
					initialAnswers: {
						'lines-1':
							'The Romans built roads, bathhouses, and villas. They also changed food and transport across Britain.'
					}
				}),
				heightClass: 'h-[24rem]'
			};
		}

		if (kind === 'calc') {
			return {
				sheet: createPreviewSheet({
					id: 'catalog-calc',
					title: 'Iron preview',
					sections: [
						{
							id: 'A',
							label: 'Properties & Uses',
							questions: [
								{
									id: 'calc-1',
									type: 'calc',
									marks: 1,
									prompt:
										'Iron has a density of 7.88 g/cm³. Calculate the mass of an iron nail with a volume of 2 cm³.',
									hint: 'Mass = Density × Volume',
									inputLabel: 'Mass =',
									unit: 'g'
								}
							]
						}
					],
					initialAnswers: {
						'calc-1': '15.76'
					}
				}),
				heightClass: 'h-[24rem]'
			};
		}

		if (kind === 'match') {
			return {
				sheet: createPreviewSheet({
					id: 'catalog-match',
					title: 'Romans preview',
					subject: 'History',
					level: 'KS2',
					sections: [
						{
							id: 'A',
							label: 'Roman Life in Britain',
							questions: [
								{
									id: 'match-1',
									type: 'match',
									marks: 2,
									prompt: 'Match each Roman word to its correct meaning.',
									pairs: [
										{ term: 'Villa', match: 'A large Roman country house' },
										{ term: 'Hypocaust', match: 'Underfloor heating system' },
										{ term: 'Mosaic', match: 'A picture made from small tiles' }
									]
								}
							]
						}
					],
					initialAnswers: {
						'match-1': {
							Villa: 'A large Roman country house',
							Hypocaust: 'Underfloor heating system'
						}
					}
				}),
				heightClass: 'h-[24rem]'
			};
		}

		return {
			sheet: createPreviewSheet({
				id: 'catalog-spelling',
				title: 'English preview',
				subject: 'English',
				level: 'KS2',
				sections: [
					{
						id: 'A',
						label: 'Warm-up: Word Forms',
						questions: [
							{
								id: 'spelling-1',
								type: 'spelling',
								marks: 2,
								prompt: 'Correct the spelling of these words.',
								words: [{ wrong: 'threatning' }, { wrong: 'deafning' }]
							}
						]
					}
				],
				initialAnswers: {
					'spelling-1': {
						'0': 'threatening',
						'1': 'deafening'
					}
				}
			}),
			heightClass: 'h-[24rem]'
		};
	}

	const rootSheet = samplePaperSheets.find((sheet) => sheet.id === 'iron') ?? samplePaperSheets[0];

	const reviewSummarySheet = createPreviewSheet({
		id: 'catalog-review-summary',
		title: 'Iron preview',
		sections: [
			{
				id: 'A',
				label: 'Rusting',
				questions: [
					{
						id: 'review-1',
						type: 'lines',
						marks: 4,
						prompt: 'Explain why coating iron with zinc prevents rusting.',
						lines: 4
					}
				]
			}
		]
	});

	const reviewSummaryReview: PaperSheetReview = {
		score: {
			got: 3,
			total: 4
		},
		label: 'Marked worksheet',
		message: 'One longer answer still needs teacher review before the final score is complete.',
		note: 'Catalog preview review payload.',
		questions: {
			'review-1': baseReview
		},
		teacherReviewMarks: 4,
		teacherReviewQuestionCount: 1
	};

	const reviewSummaryAnswers: PaperSheetAnswers = {
		'review-1':
			'Zinc is more reactive than iron, so it reacts first and protects the iron underneath.'
	};

	let { item }: { item: SheetCatalogItem } = $props();

	let feedbackOpen = $state(true);
	let feedbackDraft = $state('');
	let attachmentPreviewOpen = $state(true);
	let attachmentDraft = $state('');
	let runtimeStage = $state<RuntimeStage>('thinking');
	let runtimeOpen = $state(true);
	let runtimeDraft = $state('');
	let annotatedTheme = $state<'light' | 'dark'>('light');
	let sheetScrollContainer = $state<HTMLDivElement | null>(null);

	const runtimeReview = $derived.by((): PaperSheetQuestionReview => {
		if (runtimeStage === 'resolved') {
			return {
				status: 'correct',
				label: 'Strong move',
				statusLabel: 'optional reply',
				note: 'The corrected count is now complete and the final line matches the divisor list.',
				replyPlaceholder: 'Optional reply...',
				followUp: 'If you want to stretch it further, explain why 44 is the smallest valid factor.'
			};
		}

		return baseReview;
	});

	const runtimeThread = $derived.by((): PaperSheetFeedbackThread | null => {
		if (runtimeStage === 'pending') {
			return null;
		}
		if (runtimeStage === 'thinking') {
			return {
				status: 'responding',
				turns: [
					{
						id: 'runtime-thinking-student',
						speaker: 'student',
						text: 'Can you check whether 44 should be included?'
					}
				]
			};
		}
		if (runtimeStage === 'responding') {
			return {
				status: 'responding',
				turns: [
					{
						id: 'runtime-responding-student',
						speaker: 'student',
						text: 'Please check the corrected count.'
					}
				]
			};
		}
		return {
			status: 'resolved',
			turns: [
				{
					id: 'runtime-resolved-student',
					speaker: 'student',
					text: 'I recounted the divisors and changed the answer to 19.'
				},
				{
					id: 'runtime-resolved-tutor',
					speaker: 'tutor',
					text: 'That resolves the issue. The final conclusion now matches the divisor list.'
				}
			]
		};
	});

	const runtimeProcessing = $derived(runtimeStage === 'pending');
	const runtimeStatus = $derived.by(() => {
		if (runtimeStage === 'thinking') {
			return 'thinking';
		}
		if (runtimeStage === 'responding') {
			return 'responding';
		}
		return null;
	});

	const runtimeThinkingText = $derived(
		runtimeStage === 'thinking' || runtimeStage === 'responding'
			? [
					'I can keep the divisor idea.',
					'The count is the part that slipped.',
					'I should recount from 44 upward.'
				].join('\n')
			: null
	);

	const runtimeAssistantDraftText = $derived(
		runtimeStage === 'responding'
			? [
					'Your setup is right: remainder 43 means **n | 1980** and **n > 43**.',
					'',
					'The missing factors are **44**, **45**, **396**, **660**, and **1980**.',
					'',
					'So there are **19 possible values of n**.'
				].join('\n')
			: null
	);

	const attachmentThread = {
		status: 'open',
		turns: [
			{
				id: 'attachment-student',
				speaker: 'student',
				text: 'Here is the part of my working where I counted the divisors.',
				attachments: [createAttachment('image'), createAttachment('text')]
			}
		]
	} satisfies PaperSheetFeedbackThread;

	const sheetPreview = $derived.by((): SheetPreviewConfig | null => {
		switch (item.previewKind) {
			case 'sheet-root':
				return {
					sheet: rootSheet,
					heightClass: 'h-[30rem]',
					showFooter: false
				};
			case 'sheet-header':
				return {
					sheet: createPreviewSheet({
						id: 'catalog-header',
						title: 'Hamilton 2023',
						subtitle: 'Andrew Hamilton · sample student submission',
						subject: 'Mathematics',
						level: 'Olympiad',
						sections: [
							{
								type: 'hook',
								text: 'Sample worksheet seeded from a combined grading file.'
							}
						]
					}),
					heightClass: 'h-[14rem]',
					showFooter: false
				};
			case 'hook':
				return {
					sheet: createPreviewSheet({
						id: 'catalog-hook',
						title: 'Roman preview',
						subtitle: 'Year 4 · History',
						subject: 'History',
						level: 'KS2',
						sections: [
							{
								type: 'hook',
								text: 'Over 2,000 years ago, one of the greatest empires the world has ever seen stretched across three continents.'
							},
							{
								id: 'A',
								label: 'Know Your Romans'
							}
						]
					}),
					heightClass: 'h-[18rem]',
					showFooter: false
				};
			case 'content-section':
				return {
					sheet: createPreviewSheet({
						id: 'catalog-content-section',
						title: 'Iron preview',
						sections: [
							{
								id: 'A',
								label: 'Rusting',
								theory:
									'Rusting is a chemical reaction where iron reacts with **oxygen** and **water**.',
								infoBox: {
									icon: '⚗️',
									title: 'Key Equation',
									text: 'iron + oxygen + water → hydrated iron(III) oxide'
								},
								questions: [
									{
										id: 'content-section-q1',
										type: 'fill',
										marks: 1,
										prompt: 'For iron to rust, it must be in contact with',
										blanks: [{}],
										after: '.'
									}
								]
							}
						]
					}),
					heightClass: 'h-[24rem]',
					showFooter: false
				};
			case 'theory':
				return {
					sheet: createPreviewSheet({
						id: 'catalog-theory',
						title: 'Romans preview',
						subject: 'History',
						level: 'KS2',
						sections: [
							{
								id: 'A',
								label: 'Know Your Romans',
								theory:
									'The Roman Empire was ruled from the city of Rome in Italy. The Romans first tried to invade Britain in **55 BC** under Julius Caesar, but the full conquest came in **43 AD** under Emperor Claudius.'
							}
						]
					}),
					heightClass: 'h-[20rem]',
					showFooter: false
				};
			case 'info-box':
				return {
					sheet: createPreviewSheet({
						id: 'catalog-info-box',
						title: 'Romans preview',
						subject: 'History',
						level: 'KS2',
						sections: [
							{
								id: 'A',
								label: "Hadrian's Wall",
								infoBox: {
									icon: '🧱',
									title: 'Fast Fact',
									text: 'Hadrian’s Wall took about 6 years to build and parts of it still stand today.'
								}
							}
						]
					}),
					heightClass: 'h-[20rem]',
					showFooter: false
				};
			case 'footer':
				return {
					sheet: createPreviewSheet({
						id: 'catalog-footer',
						title: 'Grammar & Vocabulary',
						subtitle: 'Year 5 · English Skills',
						subject: 'English',
						level: 'KS2',
						sections: [
							{
								type: 'hook',
								text: 'Strong writers understand how language works.'
							},
							{
								id: 'A',
								label: 'Sentence work',
								questions: [
									{
										id: 'footer-q1',
										type: 'lines',
										marks: 1,
										prompt: 'Rewrite the sentence with the subordinate clause first.',
										lines: 2
									}
								]
							}
						]
					}),
					heightClass: 'h-[18rem]',
					showFooter: true,
					scrollToBottom: true
				};
			case 'fill':
			case 'group':
			case 'mcq':
			case 'lines':
			case 'calc':
			case 'match':
			case 'spelling':
				return buildQuestionSheet(item.previewKind);
			case 'review-summary':
				return {
					sheet: reviewSummarySheet,
					heightClass: 'h-[28rem]',
					reviewMode: 'live',
					review: reviewSummaryReview,
					answers: reviewSummaryAnswers,
					editable: false,
					showFooter: false
				};
			default:
				return null;
		}
	});

	$effect(() => {
		if (!sheetPreview?.scrollToBottom || !sheetScrollContainer || typeof window === 'undefined') {
			return;
		}

		window.requestAnimationFrame(() => {
			sheetScrollContainer?.scrollTo({
				top: sheetScrollContainer.scrollHeight
			});
		});
	});
</script>

{#if sheetPreview}
	<div class="rounded-xl border border-border/70 bg-muted/20 p-3">
		<div
			bind:this={sheetScrollContainer}
			class={cn('overflow-auto rounded-lg', sheetPreview.heightClass)}
		>
			<div class="mx-auto w-full max-w-[1024px]">
				<PaperSheet
					sheet={sheetPreview.sheet}
					reviewMode={sheetPreview.reviewMode ?? 'none'}
					answers={sheetPreview.answers}
					review={sheetPreview.review}
					editable={sheetPreview.editable ?? true}
					showFooter={sheetPreview.showFooter ?? false}
				/>
			</div>
		</div>
	</div>
{:else if item.previewKind === 'question-feedback'}
	<div class="rounded-xl border border-border/70 bg-muted/20 p-3">
		<PaperSheetQuestionFeedback
			review={baseReview}
			questionLabel="question 4"
			open={feedbackOpen}
			draft={feedbackDraft}
			thread={sharedThread}
			onToggle={() => {
				feedbackOpen = !feedbackOpen;
			}}
			onDraftChange={(value) => {
				feedbackDraft = value;
			}}
			onReply={() => {}}
		/>
	</div>
{:else if item.previewKind === 'attachment-output'}
	<div class="rounded-xl border border-border/70 bg-muted/20 p-3">
		<PaperSheetQuestionFeedback
			review={baseReview}
			questionLabel="question 1"
			open={attachmentPreviewOpen}
			draft={attachmentDraft}
			thread={attachmentThread}
			showComposer={false}
			onToggle={() => {
				attachmentPreviewOpen = !attachmentPreviewOpen;
			}}
			onDraftChange={(value) => {
				attachmentDraft = value;
			}}
			onReply={() => {}}
		/>
	</div>
{:else if item.previewKind === 'runtime-feedback'}
	<div class="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
		<div class="flex flex-wrap gap-2">
			{#each ['pending', 'thinking', 'responding', 'resolved'] as stage}
				<button
					type="button"
					class={cn(
						buttonVariants({
							variant: runtimeStage === stage ? 'default' : 'secondary',
							size: 'sm'
						})
					)}
					onclick={() => {
						runtimeStage = stage as RuntimeStage;
					}}
				>
					{stage}
				</button>
			{/each}
		</div>

		<PaperSheetQuestionFeedback
			review={runtimeReview}
			questionLabel="question 2"
			open={runtimeOpen}
			draft={runtimeDraft}
			thread={runtimeThread}
			processing={runtimeProcessing}
			{runtimeStatus}
			thinkingText={runtimeThinkingText}
			assistantDraftText={runtimeAssistantDraftText}
			showComposer={runtimeStage !== 'resolved'}
			showFollowUpButton={runtimeStage === 'resolved'}
			onToggle={() => {
				runtimeOpen = !runtimeOpen;
			}}
			onRequestFollowUp={() => {
				runtimeStage = 'thinking';
			}}
			onDraftChange={(value) => {
				runtimeDraft = value;
			}}
			onReply={() => {}}
		/>
	</div>
{:else}
	<div class="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class={cn(
					buttonVariants({
						variant: annotatedTheme === 'light' ? 'default' : 'secondary',
						size: 'sm'
					})
				)}
				onclick={() => {
					annotatedTheme = 'light';
				}}
			>
				Light
			</button>
			<button
				type="button"
				class={cn(
					buttonVariants({
						variant: annotatedTheme === 'dark' ? 'default' : 'secondary',
						size: 'sm'
					})
				)}
				onclick={() => {
					annotatedTheme = 'dark';
				}}
			>
				Dark
			</button>
		</div>

		<div class="max-h-[28rem] overflow-auto rounded-lg border border-border/70">
			<AnnotatedTextPanel document={sampleAnnotatedTextDocument} theme={annotatedTheme} />
		</div>
	</div>
{/if}
