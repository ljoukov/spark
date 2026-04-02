<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import {
		SheetFeedbackCard as PaperSheetQuestionFeedback,
		type SheetComposerAttachmentDraft as PaperSheetComposerAttachmentDraft,
		type SheetFeedbackAttachment as PaperSheetFeedbackAttachment,
		type SheetFeedbackThreadData as PaperSheetFeedbackThread,
		type SheetQuestionReview as PaperSheetQuestionReview
	} from '@ljoukov/sheet';
	import { cn } from '$lib/utils.js';
	import SheetPreviewNav from '../SheetPreviewNav.svelte';

	type RuntimeStatus = 'connecting' | 'thinking' | 'responding' | null;

	type FeedbackComposerPreset = {
		initialDraft?: string;
		initialAttachments?: PaperSheetComposerAttachmentDraft[];
		show?: boolean;
		allowAttachments?: boolean;
		allowTakePhoto?: boolean;
		resolvedFollowUpMode?: boolean;
	};

	type FeedbackComposerState = {
		draft: string;
		attachments: PaperSheetComposerAttachmentDraft[];
		show: boolean;
		allowAttachments: boolean;
		allowTakePhoto: boolean;
		resolvedFollowUpMode: boolean;
	};

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
		showFollowUpButton?: boolean;
		composer?: FeedbackComposerPreset;
		open?: boolean;
	};

	type FeedbackResponseCard = {
		id: string;
		title: string;
		description: string;
		thread: PaperSheetFeedbackThread;
	};

	type ProgressionPreviewState = {
		thread: PaperSheetFeedbackThread | null;
		processing: boolean;
		runtimeStatus: RuntimeStatus;
		showFollowUpButton: boolean;
		composer: FeedbackComposerState;
	};

	const SAMPLE_IMAGE_PREVIEW_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
			<rect width="320" height="240" fill="#f6efe1"/>
			<rect x="22" y="22" width="276" height="196" rx="18" fill="#fffdfa" stroke="#d6c7aa" stroke-width="4"/>
			<rect x="48" y="48" width="224" height="120" rx="12" fill="#dfeee4"/>
			<circle cx="92" cy="86" r="18" fill="#f4b860"/>
			<path d="M64 160l44-42 38 30 38-48 52 60H64z" fill="#4f8c6f"/>
			<path d="M60 188h200" stroke="#8a7b66" stroke-width="8" stroke-linecap="round"/>
			<text x="50%" y="206" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#5c4b3e">working photo</text>
		</svg>`
	)}`;

	const SAMPLE_TEXT_FILE_URL = `data:text/plain;charset=utf-8,${encodeURIComponent(
		['Divisors above 43:', '44, 45, 55, 60, 66, 90, 99, 110, 132, 165, 180, 198, 220, 330, 396, 495, 660, 990, 1980'].join(
			'\n'
		)
	)}`;

	function createThreadAttachment(kind: 'image' | 'text-file'): PaperSheetFeedbackAttachment {
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
			id: 'preview-text-file',
			filename: 'divisor-list.txt',
			contentType: 'text/plain',
			sizeBytes: 1_280,
			url: SAMPLE_TEXT_FILE_URL
		};
	}

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

	const responseContentCards: FeedbackResponseCard[] = [
		{
			id: 'reply-text-only',
			title: 'Text only',
			description: 'Student reply renders as the current text-only bubble.',
			thread: {
				status: 'open',
				turns: [
					{
						id: 'reply-text-only-student',
						speaker: 'student',
						text: 'I think I forgot to include 44 and some of the larger factor pairs.'
					}
				]
			}
		},
		{
			id: 'reply-text-file-only',
			title: 'Text file only',
			description: 'Student reply with no typed text, only an attached text file.',
			thread: {
				status: 'open',
				turns: [
					{
						id: 'reply-text-file-student',
						speaker: 'student',
						text: '',
						attachments: [createThreadAttachment('text-file')]
					}
				]
			}
		},
		{
			id: 'reply-image-only',
			title: 'Image file only',
			description: 'Student reply with no typed text, only an attached working photo.',
			thread: {
				status: 'open',
				turns: [
					{
						id: 'reply-image-only-student',
						speaker: 'student',
						text: '',
						attachments: [createThreadAttachment('image')]
					}
				]
			}
		},
		{
			id: 'reply-image-and-text',
			title: 'Image + text',
			description: 'Student reply includes a short note plus an attached image.',
			thread: {
				status: 'open',
				turns: [
					{
						id: 'reply-image-text-student',
						speaker: 'student',
						text: 'Here is the part of my working where I counted the divisors.',
						attachments: [createThreadAttachment('image')]
					}
				]
			}
		}
	];

	const galleryCards: FeedbackDemoCard[] = [
		{
			id: 'pending',
			title: 'Pending',
			description: 'Fresh teacher-review card before any student reply arrives.',
			review: reviewNeedsRevision,
			thread: null,
			composer: {
				show: true
			}
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
			composer: {
				show: true
			}
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
			composer: {
				show: true
			}
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
			composer: {
				show: true
			}
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
			composer: {
				show: true
			}
		},
		{
			id: 'optional',
			title: 'Optional reply',
			description: 'Correct solution with no thread yet.',
			review: reviewCorrect,
			thread: null,
			composer: {
				show: true
			}
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
			composer: {
				show: true
			}
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
			composer: {
				show: false
			},
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

	function hasPersistedThread(thread: PaperSheetFeedbackThread | null): boolean {
		return (thread?.turns.length ?? 0) > 0;
	}

	function getInitialComposerDraft(
		thread: PaperSheetFeedbackThread | null,
		composer: FeedbackComposerPreset | undefined
	): string {
		if (hasPersistedThread(thread) && !(composer?.resolvedFollowUpMode ?? false)) {
			return '';
		}
		return composer?.initialDraft ?? '';
	}

	function getInitialComposerAttachments(
		thread: PaperSheetFeedbackThread | null,
		composer: FeedbackComposerPreset | undefined
	): PaperSheetComposerAttachmentDraft[] {
		if (hasPersistedThread(thread) && !(composer?.resolvedFollowUpMode ?? false)) {
			return [];
		}
		return composer?.initialAttachments ?? [];
	}

	let galleryComposerDrafts = $state<Record<string, string>>(
		Object.fromEntries(
			galleryCards.map((card) => [
				card.id,
				getInitialComposerDraft(card.thread, card.composer)
			])
		)
	);
	let galleryOpenStates = $state<Record<string, boolean>>(
		Object.fromEntries(galleryCards.map((card) => [card.id, card.open ?? true]))
	);
	let galleryFollowUpModes = $state<Record<string, boolean>>({});
	let galleryComposerAttachments = $state<Record<string, PaperSheetComposerAttachmentDraft[]>>(
		Object.fromEntries(
			galleryCards.map((card) => [
				card.id,
				getInitialComposerAttachments(card.thread, card.composer)
			])
		)
	);

	let phaseIndex = $state<PhaseIndex>(0);
	let playing = $state(false);
	let playAbort = $state<AbortController | null>(null);
	let thoughtText = $state('');
	let responseText = $state('');
	let progressionComposerDraft = $state('');
	let progressionOpen = $state(true);
	let progressionComposerAttachments = $state<PaperSheetComposerAttachmentDraft[]>([]);
	let progressionIncludeImage = $state(false);
	let progressionIncludeTextFile = $state(false);
	const progressionFollowUpDraft = 'Can you check my new final sentence once more?';

	function createDraftAttachments(files: File[]): PaperSheetComposerAttachmentDraft[] {
		return files.map((file, index) => ({
			localId:
				typeof crypto !== 'undefined' && 'randomUUID' in crypto
					? crypto.randomUUID()
					: `preview-${Date.now().toString()}-${index.toString()}`,
			file,
			filename: file.name,
			contentType: file.type || 'application/octet-stream',
			sizeBytes: file.size,
			...(file.type.startsWith('image/') ? { previewUrl: URL.createObjectURL(file) } : {})
		}));
	}

	function buildPresetThreadAttachments(): PaperSheetFeedbackAttachment[] {
		const attachments: PaperSheetFeedbackAttachment[] = [];
		if (progressionIncludeImage) {
			attachments.push(createThreadAttachment('image'));
		}
		if (progressionIncludeTextFile) {
			attachments.push(createThreadAttachment('text-file'));
		}
		return attachments;
	}

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

	function resetProgressionComposer(next: PhaseIndex): void {
		progressionComposerDraft = next === 6 ? progressionFollowUpDraft : '';
		progressionComposerAttachments = [];
	}

	function setProgressionPhase(next: PhaseIndex): void {
		phaseIndex = next;
		resetProgressionComposer(next);
	}

	function buildGalleryComposerState(card: FeedbackDemoCard): FeedbackComposerState {
		const followUpMode = galleryFollowUpModes[card.id] ?? false;
		return {
			draft:
				galleryComposerDrafts[card.id] ??
				getInitialComposerDraft(card.thread, card.composer),
			attachments:
				galleryComposerAttachments[card.id] ??
				getInitialComposerAttachments(card.thread, card.composer),
			show: followUpMode || (card.composer?.show ?? true),
			allowAttachments: card.composer?.allowAttachments ?? true,
			allowTakePhoto: card.composer?.allowTakePhoto ?? false,
			resolvedFollowUpMode: followUpMode || (card.composer?.resolvedFollowUpMode ?? false)
		};
	}

	function applyPhase(next: PhaseIndex): void {
		setProgressionPhase(next);
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
		setProgressionPhase(0);
		thoughtText = '';
		responseText = '';

		try {
			await sleep(450);
			if (abortController.signal.aborted) {
				return;
			}
			setProgressionPhase(1);

			await sleep(500);
			if (abortController.signal.aborted) {
				return;
			}
			setProgressionPhase(2);

			await sleep(550);
			if (abortController.signal.aborted) {
				return;
			}
			setProgressionPhase(3);
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
			setProgressionPhase(4);
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
			setProgressionPhase(5);

			await sleep(650);
			if (abortController.signal.aborted) {
				return;
			}
			setProgressionPhase(6);
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
		const presetAttachments = buildPresetThreadAttachments();
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
						text: 'I think I missed some divisors, but I am not sure which ones.',
						...(presetAttachments.length > 0 ? { attachments: presetAttachments } : {})
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
					text: 'I recounted them and the corrected answer is 19.',
					...(presetAttachments.length > 0 ? { attachments: presetAttachments } : {})
				},
				{
					id: 'progression-tutor',
					speaker: 'tutor',
					text: 'Yes. That resolves the thread because your final count now matches the factor list.'
				}
			]
		};
	}

	function buildProgressionPreviewState(): ProgressionPreviewState {
		const runtimeStatus = (() => {
			if (phaseIndex === 3) {
				return 'thinking' as const;
			}
			if (phaseIndex === 4) {
				return 'responding' as const;
			}
			return null;
		})();

		return {
			thread: buildProgressionThread(),
			processing: phaseIndex === 2,
			runtimeStatus,
			showFollowUpButton: phaseIndex === 5,
			composer: {
				draft: progressionComposerDraft,
				attachments: progressionComposerAttachments,
				show: phaseIndex <= 4 || phaseIndex === 6,
				allowAttachments: true,
				allowTakePhoto: false,
				resolvedFollowUpMode: phaseIndex === 6
			}
		};
	}

	const progressionPhaseLabel = $derived(progressionLabels[phaseIndex]);
	const progressionPreviewState = $derived.by(() => buildProgressionPreviewState());
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

			<div class="feedback-options">
				<label class="feedback-option">
					<input type="checkbox" bind:checked={progressionIncludeImage} disabled={playing} />
					<span>with image</span>
				</label>
				<label class="feedback-option">
					<input
						type="checkbox"
						bind:checked={progressionIncludeTextFile}
						disabled={playing}
					/>
					<span>with text file</span>
				</label>
			</div>

			<div class="feedback-preview-surface feedback-preview-surface--sheet-width">
				<PaperSheetQuestionFeedback
					review={reviewNeedsRevision}
					open={progressionOpen}
					draft={progressionPreviewState.composer.draft}
					thread={progressionPreviewState.thread}
					processing={progressionPreviewState.processing}
					runtimeStatus={progressionPreviewState.runtimeStatus}
					thinkingText={thoughtText || null}
					assistantDraftText={responseText || null}
					showComposer={progressionPreviewState.composer.show}
					showFollowUpButton={progressionPreviewState.showFollowUpButton}
					draftAttachments={progressionPreviewState.composer.attachments}
					allowAttachments={progressionPreviewState.composer.allowAttachments}
					allowTakePhoto={progressionPreviewState.composer.allowTakePhoto}
					resolvedFollowUpMode={progressionPreviewState.composer.resolvedFollowUpMode}
					questionLabel="question 1"
					onToggle={() => {
						progressionOpen = !progressionOpen;
					}}
					onRequestFollowUp={() => {
						progressionOpen = true;
						applyPhase(6);
					}}
					onDraftChange={(value) => {
						progressionComposerDraft = value;
					}}
					onAttachFiles={(files) => {
						progressionComposerAttachments = [
							...progressionComposerAttachments,
							...createDraftAttachments(files)
						];
					}}
					onRemoveDraftAttachment={(localId) => {
						progressionComposerAttachments = progressionComposerAttachments.filter(
							(attachment) => attachment.localId !== localId
						);
					}}
					onReply={() => {
						progressionComposerDraft = '';
						progressionComposerAttachments = [];
					}}
				/>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Reply content states</Card.Title>
			<Card.Description>
				Focused previews for how student replies render with text-only, file-only, and mixed content.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4 xl:grid-cols-2">
			{#each responseContentCards as card (card.id)}
				<div class="space-y-3 rounded-xl border border-border/70 p-4">
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{card.title}</p>
						<p class="text-xs text-muted-foreground">{card.description}</p>
					</div>

					<div class="feedback-preview-surface">
						<PaperSheetQuestionFeedback
							review={reviewNeedsRevision}
							open={true}
							draft=""
							thread={card.thread}
							showComposer={false}
							questionLabel={card.id}
							onToggle={() => {}}
							onDraftChange={() => {}}
							onReply={() => {}}
						/>
					</div>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>State gallery</Card.Title>
			<Card.Description>Static reference cards for each major feedback status.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4 xl:grid-cols-2">
			{#each galleryCards as card (card.id)}
				{@const composerState = buildGalleryComposerState(card)}
				<div class="space-y-3 rounded-xl border border-border/70 p-4">
					<div class="space-y-1">
						<p class="text-sm font-semibold text-foreground">{card.title}</p>
						<p class="text-xs text-muted-foreground">{card.description}</p>
					</div>

					<div class="feedback-preview-surface">
						<PaperSheetQuestionFeedback
							review={card.review}
							open={galleryOpenStates[card.id] ?? (card.open ?? true)}
							draft={composerState.draft}
							thread={card.thread}
							processing={card.processing ?? false}
							runtimeStatus={card.runtimeStatus ?? null}
							thinkingText={card.thinkingText ?? null}
							assistantDraftText={card.assistantDraftText ?? null}
							showComposer={composerState.show}
							showFollowUpButton={Boolean(card.showFollowUpButton && !(galleryFollowUpModes[card.id] ?? false))}
							draftAttachments={composerState.attachments}
							allowAttachments={composerState.allowAttachments}
							allowTakePhoto={composerState.allowTakePhoto}
							resolvedFollowUpMode={composerState.resolvedFollowUpMode}
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
								galleryComposerDrafts = {
									...galleryComposerDrafts,
									[card.id]: value
								};
							}}
							onAttachFiles={(files) => {
								galleryComposerAttachments = {
									...galleryComposerAttachments,
									[card.id]: [
										...(galleryComposerAttachments[card.id] ?? []),
										...createDraftAttachments(files)
									]
								};
							}}
							onRemoveDraftAttachment={(localId) => {
								galleryComposerAttachments = {
									...galleryComposerAttachments,
									[card.id]: (galleryComposerAttachments[card.id] ?? []).filter(
										(attachment) => attachment.localId !== localId
									)
								};
							}}
							onReply={() => {
								galleryComposerDrafts = {
									...galleryComposerDrafts,
									[card.id]: ''
								};
								galleryComposerAttachments = {
									...galleryComposerAttachments,
									[card.id]: []
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
	.feedback-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: center;
	}

	.feedback-option {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--foreground);
	}

	.feedback-option input {
		width: 1rem;
		height: 1rem;
		accent-color: #214a3a;
	}

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

	.feedback-preview-surface--sheet-width {
		width: min(100%, 1024px);
		max-width: 1024px;
		margin: 0 auto;
	}

	@media (max-width: 900px) {
		.feedback-progress-labels {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
