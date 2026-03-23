<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import {
		PaperSheetQuestionFeedback,
		type PaperSheetFeedbackThread,
		type PaperSheetQuestionReview
	} from '$lib/components/paper-sheet/index.js';
	import { cn } from '$lib/utils.js';
	import SheetPreviewNav from '../SheetPreviewNav.svelte';

	type RuntimeStatus = 'connecting' | 'thinking' | 'responding' | null;

	type FeedbackDemoCard = {
		id: string;
		title: string;
		description: string;
		review: PaperSheetQuestionReview;
		thread: PaperSheetFeedbackThread | null;
		processing?: boolean;
		runtimeStatus?: RuntimeStatus;
		thinkingText?: string | null;
		assistantDraftText?: string | null;
		showComposer?: boolean;
		showFollowUpButton?: boolean;
		showComposerTools?: boolean;
		resolvedFollowUpMode?: boolean;
		draft?: string;
		open?: boolean;
	};

	const sampleThoughtLines = [
		'I can keep the divisor idea and just fix the count.',
		'The condition is n > 43, so 44 is allowed.',
		'I should recount the factors of 1980 in order and compare with the student list.'
	] as const;

	const sampleResponse = [
		'Your setup is right: remainder 43 means **n | 1980** and **n > 43**.',
		'',
		'The count is the part that slipped. The missing factors are **44**, **45**, **396**, **660**, and **1980**.',
		'',
		'So the corrected conclusion is: **there are 19 possible values of n**.'
	].join('\n');

	const reviewNeedsRevision: PaperSheetQuestionReview = {
		status: 'teacher-review',
		label: 'Review note',
		statusLabel: 'reflection prompt',
		note: 'Your setup is right, but your final count does not match the divisor list. Recount the factors bigger than 43 and check whether 44 should be included.',
		replyPlaceholder: 'Explain how you would fix the divisor count.',
		followUp: 'Good. Now write the corrected final sentence clearly and check the list one more time.'
	};

	const reviewCorrect: PaperSheetQuestionReview = {
		status: 'correct',
		label: 'Strong move',
		statusLabel: 'optional reply',
		note: 'The corrected count is complete and the final statement now matches the divisor list.',
		replyPlaceholder: 'Optional reply...',
		followUp: 'If you want to polish it further, you can say why 44 is the smallest valid factor.'
	};

	const galleryCards: FeedbackDemoCard[] = [
		{
			id: 'pending',
			title: 'Pending',
			description: 'Fresh teacher-review card before any student reply arrives.',
			review: reviewNeedsRevision,
			thread: null,
			showComposer: true,
			draft: ''
		},
		{
			id: 'open',
			title: 'Conversation open',
			description: 'Student replied and the thread stays open for another pass.',
			review: reviewNeedsRevision,
			thread: {
				status: 'open',
				turns: [
					{
						id: 'open-student',
						speaker: 'student',
						text: 'I think I counted 14 because I forgot some divisors near the top of the list.'
					},
					{
						id: 'open-tutor',
						speaker: 'tutor',
						text: 'That is the right place to look. Recount in increasing order so you can see which values are missing.'
					}
				]
			},
			showComposer: true,
			draft: 'I want to try the recount again.'
		},
		{
			id: 'connecting',
			title: 'Connecting',
			description: 'The runtime spinner is active before the live stream starts.',
			review: reviewNeedsRevision,
			thread: {
				status: 'open',
				turns: [
					{
						id: 'connecting-student',
						speaker: 'student',
						text: 'Can you check whether 44 should be included?'
					}
				]
			},
			processing: true,
			showComposer: true
		},
		{
			id: 'thinking',
			title: 'Thinking',
			description: 'Thought stream is visible while the tutor is reasoning.',
			review: reviewNeedsRevision,
			thread: {
				status: 'responding',
				turns: [
					{
						id: 'thinking-student',
						speaker: 'student',
						text: 'I think 44 might be valid, but I am not sure.'
					}
				]
			},
			runtimeStatus: 'thinking',
			thinkingText: sampleThoughtLines.join('\n'),
			showComposer: true
		},
		{
			id: 'responding',
			title: 'Responding',
			description: 'The assistant draft is being streamed before the final turn is committed.',
			review: reviewNeedsRevision,
			thread: {
				status: 'responding',
				turns: [
					{
						id: 'responding-student',
						speaker: 'student',
						text: 'Please check the full corrected count.'
					}
				]
			},
			runtimeStatus: 'responding',
			thinkingText: sampleThoughtLines.join('\n'),
			assistantDraftText: sampleResponse,
			showComposer: true
		},
		{
			id: 'optional',
			title: 'Optional reply',
			description: 'Correct solution with no thread yet.',
			review: reviewCorrect,
			thread: null,
			showComposer: true,
			draft: ''
		},
		{
			id: 'shared',
			title: 'Shared',
			description: 'Correct question with an extra student/tutor exchange already recorded.',
			review: reviewCorrect,
			thread: {
				status: 'open',
				turns: [
					{
						id: 'shared-student',
						speaker: 'student',
						text: 'I fixed the count to 19.'
					},
					{
						id: 'shared-tutor',
						speaker: 'tutor',
						text: 'Yes. That corrected final line matches the divisor list.'
					}
				]
			},
			showComposer: true
		},
		{
			id: 'resolved-collapsed',
			title: 'Resolved collapsed',
			description: 'Resolved threads default to a compact closed state.',
			review: reviewNeedsRevision,
			thread: {
				status: 'resolved',
				turns: [
					{
						id: 'resolved-student',
						speaker: 'student',
						text: 'I recounted the divisors and the answer is 19.'
					},
					{
						id: 'resolved-tutor',
						speaker: 'tutor',
						text: 'That resolves the issue. Your final conclusion now matches the divisor list.'
					}
				]
			},
			showComposer: false,
			showFollowUpButton: true,
			open: false
		}
	];

	type PhaseIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

	const progressionLabels = [
		'Pending',
		'Conversation open',
		'Connecting',
		'Thinking',
		'Responding',
		'Resolved',
		'Ask followup'
	] as const;

	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	let galleryDrafts = $state<Record<string, string>>(
		Object.fromEntries(galleryCards.map((card) => [card.id, card.draft ?? '']))
	);
	let galleryOpenStates = $state<Record<string, boolean>>(
		Object.fromEntries(galleryCards.map((card) => [card.id, card.open ?? true]))
	);
	let galleryFollowUpModes = $state<Record<string, boolean>>({});

	let phaseIndex = $state<PhaseIndex>(0);
	let playing = $state(false);
	let playAbort = $state<AbortController | null>(null);
	let thoughtText = $state('');
	let responseText = $state('');
	let progressionDraft = $state('');
	let progressionOpen = $state(true);

	function clampPhase(value: number): PhaseIndex {
		if (value <= 0) {
			return 0;
		}
		if (value === 1) {
			return 1;
		}
		if (value === 2) {
			return 2;
		}
		if (value === 3) {
			return 3;
		}
		if (value === 4) {
			return 4;
		}
		if (value === 5) {
			return 5;
		}
		return 6;
	}

	function applyPhase(next: PhaseIndex): void {
		phaseIndex = next;
		if (playing) {
			return;
		}
		if (next <= 2) {
			thoughtText = '';
			responseText = '';
		} else if (next === 3) {
			thoughtText = sampleThoughtLines.join('\n');
			responseText = '';
		} else {
			thoughtText = sampleThoughtLines.join('\n');
			responseText = sampleResponse;
		}
		if (next <= 4) {
			progressionDraft = next <= 1 ? 'I think the count should be larger than 14.' : '';
		}
		if (next === 6) {
			progressionDraft = 'Can you check my new final sentence once more?';
		}
	}

	function handlePhaseInput(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}
		applyPhase(clampPhase(Number(target.value)));
	}

	async function runSimulation(): Promise<void> {
		if (playing) {
			return;
		}
		const abortController = new AbortController();
		playAbort = abortController;
		playing = true;
		phaseIndex = 0;
		thoughtText = '';
		responseText = '';
		progressionDraft = 'I think the count should be larger than 14.';

		try {
			await sleep(450);
			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 1;

			await sleep(500);
			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 2;
			progressionDraft = '';

			await sleep(550);
			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 3;
			for (const line of sampleThoughtLines) {
				if (abortController.signal.aborted) {
					return;
				}
				thoughtText = thoughtText ? `${thoughtText}\n${line}` : line;
				await sleep(260);
			}

			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 4;
			const responseChunks = sampleResponse.split(/(\s+)/u);
			for (const chunk of responseChunks) {
				if (!chunk) {
					continue;
				}
				if (abortController.signal.aborted) {
					return;
				}
				responseText += chunk;
				await sleep(28);
			}

			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 5;

			await sleep(650);
			if (abortController.signal.aborted) {
				return;
			}
			phaseIndex = 6;
			progressionDraft = 'Can you check my new final sentence once more?';
		} finally {
			playing = false;
			playAbort = null;
		}
	}

	function stopSimulation(): void {
		playAbort?.abort();
		playAbort = null;
		playing = false;
	}

	function buildProgressionThread(): PaperSheetFeedbackThread | null {
		if (phaseIndex === 0) {
			return null;
		}
		if (phaseIndex <= 4) {
			return {
				status: phaseIndex >= 2 ? 'responding' : 'open',
				turns: [
					{
						id: 'progression-student',
						speaker: 'student',
						text: 'I think I missed some divisors, but I am not sure which ones.'
					}
				]
			};
		}
		return {
			status: 'resolved',
			turns: [
				{
					id: 'progression-student',
					speaker: 'student',
					text: 'I recounted them and the corrected answer is 19.'
				},
				{
					id: 'progression-tutor',
					speaker: 'tutor',
					text: 'Yes. That resolves the thread because your final count now matches the factor list.'
				}
			]
		};
	}

	const progressionPhaseLabel = $derived(progressionLabels[phaseIndex]);
	const progressionThread = $derived.by(() => buildProgressionThread());
	const progressionProcessing = $derived(phaseIndex === 2);
	const progressionRuntimeStatus = $derived.by(() => {
		if (phaseIndex === 3) {
			return 'thinking' as const;
		}
		if (phaseIndex === 4) {
			return 'responding' as const;
		}
		return null;
	});
</script>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Feedback states preview</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Gallery and progression simulator for the extracted sheet feedback chat, including pending,
				live runtime, resolved, and follow-up states.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a href="/admin/ui" class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
				Back to UI previews
			</a>
		</div>

		<SheetPreviewNav current="feedback" />
	</div>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>State progression</Card.Title>
			<Card.Description>Move the slider or run the simulation to step through the full lifecycle.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-5">
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-sm font-semibold text-foreground">Phase</p>
					<p class="text-xs font-medium text-muted-foreground">{progressionPhaseLabel}</p>
				</div>
				<input
					type="range"
					min="0"
					max="6"
					step="1"
					value={phaseIndex}
					oninput={handlePhaseInput}
					disabled={playing}
					class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted outline-none disabled:cursor-not-allowed disabled:opacity-60"
				/>
				<div class="feedback-progress-labels">
					{#each progressionLabels as label}
						<span>{label.toLowerCase()}</span>
					{/each}
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					onclick={() => void runSimulation()}
					disabled={playing}
				>
					Run simulation
				</Button>
				<Button variant="outline" size="sm" onclick={stopSimulation} disabled={!playing}>
					Stop
				</Button>
			</div>

			<div class="feedback-preview-surface">
				<PaperSheetQuestionFeedback
					review={reviewNeedsRevision}
					open={progressionOpen}
					draft={progressionDraft}
					thread={progressionThread}
					processing={progressionProcessing}
					runtimeStatus={progressionRuntimeStatus}
					thinkingText={thoughtText || null}
					assistantDraftText={responseText || null}
					showComposer={phaseIndex <= 4 || phaseIndex === 6}
					showFollowUpButton={phaseIndex === 5}
					showComposerTools={true}
					resolvedFollowUpMode={phaseIndex === 6}
					questionLabel="question 1"
					onToggle={() => {
						progressionOpen = !progressionOpen;
					}}
					onRequestFollowUp={() => {
						progressionOpen = true;
						applyPhase(6);
					}}
					onDraftChange={(value) => {
						progressionDraft = value;
					}}
					onReply={() => {
						progressionDraft = '';
					}}
				/>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>State gallery</Card.Title>
			<Card.Description>Static reference cards for each major feedback status.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4 xl:grid-cols-2">
			{#each galleryCards as card (card.id)}
				<div class="space-y-3 rounded-xl border border-border/70 p-4">
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{card.title}</p>
						<p class="text-xs text-muted-foreground">{card.description}</p>
					</div>

					<div class="feedback-preview-surface">
						<PaperSheetQuestionFeedback
							review={card.review}
							open={galleryOpenStates[card.id] ?? (card.open ?? true)}
							draft={galleryDrafts[card.id] ?? (card.draft ?? '')}
							thread={card.thread}
							processing={card.processing ?? false}
							runtimeStatus={card.runtimeStatus ?? null}
							thinkingText={card.thinkingText ?? null}
							assistantDraftText={card.assistantDraftText ?? null}
							showComposer={(card.showComposer ?? true) || (galleryFollowUpModes[card.id] ?? false)}
							showFollowUpButton={Boolean(card.showFollowUpButton && !(galleryFollowUpModes[card.id] ?? false))}
							showComposerTools={card.showComposerTools ?? true}
							resolvedFollowUpMode={Boolean(card.resolvedFollowUpMode || (galleryFollowUpModes[card.id] ?? false))}
							questionLabel={card.id}
							onToggle={() => {
								galleryOpenStates = {
									...galleryOpenStates,
									[card.id]: !(galleryOpenStates[card.id] ?? (card.open ?? true))
								};
							}}
							onRequestFollowUp={() => {
								galleryOpenStates = {
									...galleryOpenStates,
									[card.id]: true
								};
								galleryFollowUpModes = {
									...galleryFollowUpModes,
									[card.id]: true
								};
							}}
							onDraftChange={(value) => {
								galleryDrafts = {
									...galleryDrafts,
									[card.id]: value
								};
							}}
							onReply={() => {
								galleryDrafts = {
									...galleryDrafts,
									[card.id]: ''
								};
							}}
						/>
					</div>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>

<style>
	.feedback-progress-labels {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.4rem;
		font-size: 10px;
		font-weight: 600;
		color: var(--muted-foreground);
		text-transform: lowercase;
	}

	.feedback-preview-surface {
		border-radius: 18px;
		background: linear-gradient(180deg, #f7f4ea 0%, #efe9dc 100%);
		padding: 1rem;
		--sheet-color: #214a3a;
		--sheet-color-30: rgba(33, 74, 58, 0.3);
		--paper-surface: #ffffff;
		--paper-surface-elevated: #ffffff;
		--paper-border: rgba(33, 74, 58, 0.18);
		--paper-text: #1a1a1a;
		--paper-text-soft: #555555;
		--paper-text-subtle: #888888;
		--paper-placeholder: #999999;
		--paper-card-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
		--paper-review-correct-bg: #edfdf6;
		--paper-review-correct-border: #22a66e;
		--paper-review-correct-text: #1a8c5b;
		--paper-review-incorrect-bg: #fbefe3;
		--paper-review-incorrect-border: #c66317;
		--paper-review-incorrect-text: #c66317;
		--paper-review-teacher-bg: #fff6d8;
		--paper-review-teacher-border: #d6a11e;
		--paper-review-teacher-text: #b07a00;
	}

	@media (max-width: 900px) {
		.feedback-progress-labels {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
