<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import PaperSheetQuestionFeedback from './paper-sheet-question-feedback.svelte';
	import type {
		PaperSheetAnswers,
		PaperSheetBlank,
		PaperSheetContentSection,
		PaperSheetData,
		PaperSheetFeedbackThread,
		PaperSheetHookSection,
		PaperSheetMockReview,
		PaperSheetQuestion,
		PaperSheetQuestionReview,
		PaperSheetQuestionReviewStatus,
		PaperSheetLinesQuestion,
		PaperSheetReview,
		PaperSheetScore
	} from './types';

	type PaperSheetQuestionEntry = {
		sectionId: string;
		question: PaperSheetQuestion;
	};

	type PaperSheetReviewMode = 'none' | 'mock' | 'live';

	function isHookSection(
		section: PaperSheetData['sections'][number]
	): section is PaperSheetHookSection {
		return 'type' in section && section.type === 'hook';
	}

	function isContentSection(
		section: PaperSheetData['sections'][number]
	): section is PaperSheetContentSection {
		return 'id' in section;
	}

	function buildQuestionKey(_sectionId: string, questionId: string): string {
		return questionId;
	}

	function getQuestionEntries(sheet: PaperSheetData): PaperSheetQuestionEntry[] {
		const questions: PaperSheetQuestionEntry[] = [];
		for (const section of sheet.sections) {
			if (!isContentSection(section) || !section.questions) {
				continue;
			}
			for (const question of section.questions) {
				questions.push({
					sectionId: section.id,
					question
				});
			}
		}
		return questions;
	}

	function totalMarks(sheet: PaperSheetData): number {
		let total = 0;
		for (const entry of getQuestionEntries(sheet)) {
			total += entry.question.marks;
		}
		return total;
	}

	function sectionMarks(section: PaperSheetContentSection): number {
		let total = 0;
		for (const question of section.questions ?? []) {
			total += question.marks;
		}
		return total;
	}

	function buildQuestionNumbers(sheet: PaperSheetData): Record<string, number> {
		const numbers: Record<string, number> = {};
		let counter = 1;
		for (const entry of getQuestionEntries(sheet)) {
			numbers[buildQuestionKey(entry.sectionId, entry.question.id)] = counter;
			counter += 1;
		}
		return numbers;
	}

	function createOpenSections(sheet: PaperSheetData): Record<string, boolean> {
		const open: Record<string, boolean> = {};
		for (const section of sheet.sections) {
			if (isContentSection(section)) {
				open[section.id] = true;
			}
		}
		return open;
	}

	function rgbaFromHex(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '');
		const red = Number.parseInt(normalized.slice(0, 2), 16);
		const green = Number.parseInt(normalized.slice(2, 4), 16);
		const blue = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}

	function buildPaperThemeStyle(sheet: PaperSheetData): string {
		return [
			`--sheet-color:${sheet.color}`,
			`--sheet-accent:${sheet.accent}`,
			`--sheet-light:${sheet.light}`,
			`--sheet-border:${sheet.border}`,
			`--sheet-color-08:${rgbaFromHex(sheet.color, 0.08)}`,
			`--sheet-color-10:${rgbaFromHex(sheet.color, 0.1)}`,
			`--sheet-color-14:${rgbaFromHex(sheet.color, 0.14)}`,
			`--sheet-color-15:${rgbaFromHex(sheet.color, 0.15)}`,
			`--sheet-color-25:${rgbaFromHex(sheet.color, 0.25)}`,
			`--sheet-color-30:${rgbaFromHex(sheet.color, 0.3)}`,
			`--sheet-color-40:${rgbaFromHex(sheet.color, 0.4)}`,
			`--sheet-color-60:${rgbaFromHex(sheet.color, 0.6)}`,
			`--sheet-accent-12:${rgbaFromHex(sheet.accent, 0.12)}`,
			`--sheet-accent-18:${rgbaFromHex(sheet.accent, 0.18)}`,
			`--sheet-accent-24:${rgbaFromHex(sheet.accent, 0.24)}`,
			`--sheet-accent-30:${rgbaFromHex(sheet.accent, 0.3)}`
		].join('; ');
	}

	function cloneAnswers(source: PaperSheetAnswers | undefined): PaperSheetAnswers {
		if (!source) {
			return {};
		}

		const next: PaperSheetAnswers = {};
		for (const [key, value] of Object.entries(source)) {
			next[key] = typeof value === 'string' ? value : { ...value };
		}
		return next;
	}

	function removeQuestionKey<T extends Record<string, boolean | number | string>>(value: T, questionKey: string): T {
		const { [questionKey]: _removed, ...rest } = value;
		return rest as T;
	}

	function shouldRenderLinesAnswerAsMarkdown(question: PaperSheetLinesQuestion): boolean {
		return question.renderMode === 'markdown' || areInputsLocked();
	}

	function shouldShowLinesMarkdownRow(question: PaperSheetQuestion): boolean {
		return question.type === 'lines' && shouldRenderLinesAnswerAsMarkdown(question);
	}

	function createScoreTone(score: PaperSheetScore): {
		background: string;
		border: string;
		text: string;
		message: string;
	} {
		const ratio = score.total > 0 ? score.got / score.total : 0;
		if (ratio >= 0.7) {
			return {
				background: 'var(--paper-review-correct-bg)',
				border: 'var(--paper-review-correct-border)',
				text: 'var(--paper-review-correct-text)',
				message: 'Mock success state for the preview.'
			};
		}
		if (ratio >= 0.5) {
			return {
				background: 'var(--paper-review-teacher-bg)',
				border: 'var(--paper-review-teacher-border)',
				text: 'var(--paper-review-teacher-text)',
				message: 'Mock mixed-result state for the preview.'
			};
		}
		return {
			background: 'var(--paper-review-incorrect-bg)',
			border: 'var(--paper-review-incorrect-border)',
			text: 'var(--paper-review-incorrect-text)',
			message: 'Mock revision-needed state for the preview.'
		};
	}

	function createQuestionReview(
		question: PaperSheetQuestion,
		status: PaperSheetQuestionReviewStatus
	): PaperSheetQuestionReview {
		if (status === 'teacher-review') {
			return {
				status,
				label: 'Response space',
				statusLabel: 'reflection prompt',
				note: 'This is a longer written answer, so the demo keeps it open for **teacher review**. Reply with what you would improve, and the next note will nudge you toward a stronger final version.',
				replyPlaceholder: 'Write your reply here...',
				followUp:
					'Good. When you redraft, keep one clear point per sentence and pull in one exact detail from the theory box so the explanation feels anchored.'
			};
		}

		if (status === 'correct') {
			switch (question.type) {
				case 'fill':
					return {
						status,
						label: 'Strong move',
						statusLabel: 'optional reply',
						note: 'Nice. You landed the key fact cleanly here. If you want to stretch yourself, reply with **how** you found the answer so the next note can suggest a faster checking strategy.',
						replyPlaceholder: 'Optional reply...',
						followUp:
							'That method works. On similar retrieval questions, scan for the bold detail in the theory box first, then copy it exactly.'
					};
				case 'mcq':
					return {
						status,
						label: 'Strong move',
						statusLabel: 'optional reply',
						note: 'You chose the strongest option here. If you reply, the next note will turn that choice into a one-sentence explanation you could use in a written answer.',
						replyPlaceholder: 'Optional reply...',
						followUp:
							'Good instinct. The next step is saying **why** that answer fits, not just spotting it in the list.'
					};
				case 'calc':
					return {
						status,
						label: 'Strong move',
						statusLabel: 'optional reply',
						note: 'The method looks secure on this calculation. If you reply, the next note will show you how to present the same method even more clearly.',
						replyPlaceholder: 'Optional reply...',
						followUp:
							'To make it even stronger, write the formula first, then substitute the values, then finish with the unit.'
					};
				case 'match':
					return {
						status,
						label: 'Strong move',
						statusLabel: 'optional reply',
						note: 'Your matching looks settled. If you reply, the next note can turn one of those pairs into a quick memory rule.',
						replyPlaceholder: 'Optional reply...',
						followUp:
							'A good revision trick is to say each term and meaning out loud as one phrase, so the pair sticks together.'
					};
				case 'spelling':
					return {
						status,
						label: 'Strong move',
						statusLabel: 'optional reply',
						note: 'This spelling looks secure. If you reply, the next note can point out the letter pattern that made it work.',
						replyPlaceholder: 'Optional reply...',
						followUp:
							'Keep noticing the sound pattern in the middle of the word. That is often what prevents the slip on a second attempt.'
					};
				case 'lines':
					return {
						status,
						label: 'Response space',
						statusLabel: 'reflection prompt',
						note: 'This written response still needs teacher judgement in the demo.',
						replyPlaceholder: 'Write your reply here...',
						followUp:
							'When you refine it, keep your explanation tight and include one concrete piece of evidence from the sheet.'
					};
			}
		}

		switch (question.type) {
			case 'fill':
				return {
					status,
					label: 'Quick note',
					statusLabel: 'response needed',
					note: 'Have another look at the **theory section**. The exact fact for this blank is stated directly in the reading above, so slow down and copy the date or term exactly as it appears.',
					replyPlaceholder: 'Write your reply here...',
					followUp:
						'That is a better direction. Before you move on, rewrite the full sentence in your head so the blank fits the question smoothly.'
				};
			case 'mcq':
				return {
					status,
					label: 'Quick note',
					statusLabel: 'response needed',
					note: 'You are in the right topic area, but not on the **exact detail** yet. Re-read the theory box and eliminate the options that were never mentioned at all before choosing again.',
					replyPlaceholder: 'Write your reply here...',
					followUp:
						'Good. Now turn that option into a short explanation: “I chose this because...” That makes the knowledge easier to keep.'
				};
			case 'calc':
				return {
					status,
					label: 'Quick note',
					statusLabel: 'response needed',
					note: 'Set the **method** out first. Use the formula from the hint, substitute the values carefully, and only then write the final answer with the unit.',
					replyPlaceholder: 'Write your reply here...',
					followUp:
						'That plan is better. On the next attempt, keep each step on its own line so the arithmetic is easier to check.'
				};
			case 'match':
				return {
					status,
					label: 'Quick note',
					statusLabel: 'response needed',
					note: 'At least one pair has crossed over. Rebuild the matches **one term at a time** and say what each word means before you click.',
					replyPlaceholder: 'Write your reply here...',
					followUp:
						'That makes sense. Try matching the easiest term first, then use process of elimination on the final pair.'
				};
			case 'spelling':
				return {
					status,
					label: 'Quick note',
					statusLabel: 'response needed',
					note: 'Say the word aloud and listen for the **missing sound**. The mistake is usually not random, so focus on the letter pattern that should sit in the middle of the word.',
					replyPlaceholder: 'Write your reply here...',
					followUp:
						'That is the right habit. After you fix it once, write the corrected spelling again from memory so it sticks.'
				};
			case 'lines':
				return {
					status,
					label: 'Response space',
					statusLabel: 'reflection prompt',
					note: 'This answer needs teacher judgement, but the sheet can still help you improve it. Reply with what you think your strongest point was, or where you felt unsure.',
					replyPlaceholder: 'Write your reply here...',
					followUp:
						'Useful reflection. On the redraft, keep one clear idea per sentence and tie it back to the theory text.'
				};
		}
	}

	function buildMockReview(sheet: PaperSheetData): PaperSheetMockReview {
		if (sheet.mockReview) {
			return sheet.mockReview;
		}

		const questions: Record<string, PaperSheetQuestionReview> = {};
		let got = 0;
		let total = 0;
		let teacherReviewMarks = 0;
		let objectiveQuestionCount = 0;
		let teacherReviewQuestionCount = 0;
		let objectiveIndex = 0;

		for (const entry of getQuestionEntries(sheet)) {
			const questionKey = buildQuestionKey(entry.sectionId, entry.question.id);
			const question = entry.question;
			if (question.type === 'lines') {
				teacherReviewMarks += question.marks;
				teacherReviewQuestionCount += 1;
				questions[questionKey] = createQuestionReview(question, 'teacher-review');
				continue;
			}

			total += question.marks;
			objectiveQuestionCount += 1;
			const status: PaperSheetQuestionReviewStatus =
				objectiveIndex % 3 === 1 ? 'incorrect' : 'correct';
			if (status === 'correct') {
				got += question.marks;
			}
			questions[questionKey] = createQuestionReview(question, status);
			objectiveIndex += 1;
		}

		return {
			score: { got, total },
			objectiveQuestionCount,
			teacherReviewMarks,
			teacherReviewQuestionCount,
			label: 'Mock review score (objective questions only)',
			message: `Demo-only review state. ${teacherReviewMarks} teacher-reviewed marks are excluded from this mock score.`,
			note: 'Preview only. This component shows mocked review feedback for UI validation; it is not checking answer keys.',
			questions
		};
	}

	function shouldShowQuestionFeedback(review: PaperSheetQuestionReview | null): boolean {
		return review !== null;
	}

	function resolveReviewColors(status: PaperSheetQuestionReviewStatus | null): {
		border: string;
		background: string;
		text: string;
	} {
		if (status === 'correct') {
			return {
				border: 'var(--paper-review-correct-border)',
				background: 'var(--paper-review-correct-bg)',
				text: 'var(--paper-review-correct-text)'
			};
		}
		if (status === 'incorrect') {
			return {
				border: 'var(--paper-review-incorrect-border)',
				background: 'var(--paper-review-incorrect-bg)',
				text: 'var(--paper-review-incorrect-text)'
			};
		}
		if (status === 'teacher-review') {
			return {
				border: 'var(--paper-review-teacher-border)',
				background: 'var(--paper-review-teacher-bg)',
				text: 'var(--paper-review-teacher-text)'
			};
		}
		return {
			border: '',
			background: 'transparent',
			text: ''
		};
	}

	function buildTextInputStyle(
		status: PaperSheetQuestionReviewStatus | null,
		minWidth = 100
	): string {
		const colors = resolveReviewColors(status);
		return [
			`min-width:${minWidth}px`,
			`border-bottom-color:${colors.border || 'var(--paper-input-border)'}`,
			`background:${colors.background}`
		].join('; ');
	}

	function buildMcqOptionStyle(
		selected: boolean,
		status: PaperSheetQuestionReviewStatus | null
	): string {
		const colors = resolveReviewColors(selected ? status : null);
		return [
			`border-color:${colors.border || (selected ? 'var(--paper-accent-text)' : 'var(--paper-choice-border)')}`,
			`background:${colors.background || (selected ? 'var(--paper-accent-soft-bg)' : 'var(--paper-choice-surface)')}`
		].join('; ');
	}

	function buildMcqRadioStyle(
		selected: boolean,
		status: PaperSheetQuestionReviewStatus | null
	): string {
		const colors = resolveReviewColors(selected ? status : null);
		return [
			`border-color:${colors.border || (selected ? 'var(--paper-accent-text)' : 'var(--paper-radio-border)')}`,
			`background:${selected ? colors.border || 'var(--paper-accent-text)' : 'var(--paper-lines-bg)'}`
		].join('; ');
	}

	function buildMatchTermStyle(
		active: boolean,
		hasMatch: boolean,
		status: PaperSheetQuestionReviewStatus | null
	): string {
		const colors = resolveReviewColors(hasMatch ? status : null);
		return [
			`border-color:${active ? 'var(--paper-accent-text)' : colors.border || (hasMatch ? 'var(--paper-input-border)' : 'var(--paper-choice-border)')}`,
			`background:${active ? 'var(--paper-accent-soft-bg)' : colors.background || (hasMatch ? 'var(--paper-accent-softest-bg)' : 'var(--paper-choice-surface)')}`
		].join('; ');
	}

	function buildMatchValueStyle(taken: boolean, armed: boolean): string {
		const borderColor = taken
			? 'var(--paper-input-border)'
			: armed
				? 'var(--paper-accent-text)'
				: 'var(--paper-choice-border)';
		const background = taken
			? 'var(--paper-accent-softest-bg)'
			: armed
				? 'var(--paper-accent-whisper-bg)'
				: 'var(--paper-choice-surface)';
		const opacity = taken ? '0.6' : '1';
		return [`border-color:${borderColor}`, `background:${background}`, `opacity:${opacity}`].join(
			'; '
		);
	}

	function readInputValue(event: Event): string {
		const target = event.currentTarget;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			return target.value;
		}
		return '';
	}

	let {
		sheet,
		reviewMode = 'none',
		answers: initialAnswers = {},
		review: initialReview = null,
		feedbackThreads: initialFeedbackThreads = {},
		feedbackSending: initialFeedbackSending = {},
		feedbackRuntimeStatuses: initialFeedbackRuntimeStatuses = {},
		feedbackThinking: initialFeedbackThinking = {},
		feedbackAssistantDrafts: initialFeedbackAssistantDrafts = {},
		editable = true,
		allowFeedbackReplies = false,
		showFooter = true,
		onReplyToTutor = undefined
	}: {
		sheet: PaperSheetData;
		reviewMode?: PaperSheetReviewMode;
		answers?: PaperSheetAnswers;
		review?: PaperSheetReview | null;
		feedbackThreads?: Record<string, PaperSheetFeedbackThread>;
		feedbackSending?: Record<string, boolean>;
		feedbackRuntimeStatuses?: Record<string, 'connecting' | 'thinking' | 'responding'>;
		feedbackThinking?: Record<string, string>;
		feedbackAssistantDrafts?: Record<string, string>;
		editable?: boolean;
		allowFeedbackReplies?: boolean;
		showFooter?: boolean;
		onReplyToTutor?: ((questionId: string, draft: string) => void | Promise<void>) | undefined;
	} = $props();

	let localAnswers = $state<PaperSheetAnswers>({});
	let checked = $state(false);
	let mockReview = $state<PaperSheetMockReview | null>(null);
	let feedbackDrafts = $state<Record<string, string>>({});
	let mockFeedbackThreads = $state<Record<string, PaperSheetFeedbackThread>>({});
	let mockFeedbackSending = $state<Record<string, boolean>>({});
	let feedbackRequestTokens = $state<Record<string, number>>({});
	let openFeedbackCards = $state<Record<string, boolean>>({});
	let followUpComposerQuestions = $state<Record<string, boolean>>({});
	let openSections = $state<Record<string, boolean>>({});
	let activeMatchTerms = $state<Record<string, string | null>>({});
	let previousFeedbackThreadStatuses: Record<string, PaperSheetFeedbackThread['status'] | undefined> =
		{};
	let previousSheetSignature = $state<string | null>(null);

	function getSeedAnswers(): PaperSheetAnswers {
		if (Object.keys(initialAnswers).length > 0) {
			return initialAnswers;
		}
		return sheet.initialAnswers ?? {};
	}

	$effect(() => {
		const nextSheetSignature = buildSheetSignature(sheet);
		if (nextSheetSignature === previousSheetSignature) {
			return;
		}
		localAnswers = cloneAnswers(getSeedAnswers());
		checked = false;
		mockReview = null;
		feedbackDrafts = {};
		mockFeedbackThreads = {};
		mockFeedbackSending = {};
		feedbackRequestTokens = {};
		openFeedbackCards = {};
		followUpComposerQuestions = {};
		openSections = createOpenSections(sheet);
		activeMatchTerms = {};
		previousFeedbackThreadStatuses = {};
		previousSheetSignature = nextSheetSignature;
	});

	const hookSection = $derived.by((): PaperSheetHookSection | null => {
		for (const section of sheet.sections) {
			if (isHookSection(section)) {
				return section;
			}
		}
		return null;
	});

	const contentSections = $derived.by((): PaperSheetContentSection[] => {
		const sections: PaperSheetContentSection[] = [];
		for (const section of sheet.sections) {
			if (isContentSection(section)) {
				sections.push(section);
			}
		}
		return sections;
	});

	const questionNumbers = $derived(buildQuestionNumbers(sheet));
	const totalSheetMarks = $derived(totalMarks(sheet));
	const paperStyle = $derived(buildPaperThemeStyle(sheet));
	const currentAnswers = $derived.by(() =>
		reviewMode === 'mock' || editable ? localAnswers : getSeedAnswers()
	);
	const currentReview = $derived.by(() => (reviewMode === 'mock' ? mockReview : initialReview));
	const currentFeedbackThreads = $derived.by(() =>
		reviewMode === 'mock' ? mockFeedbackThreads : initialFeedbackThreads
	);
	const currentFeedbackSending = $derived.by(() =>
		reviewMode === 'mock' ? mockFeedbackSending : initialFeedbackSending
	);
	const currentFeedbackRuntimeStatuses = $derived.by(() =>
		reviewMode === 'mock' ? {} : initialFeedbackRuntimeStatuses
	);
	const currentFeedbackThinking = $derived.by(() =>
		reviewMode === 'mock' ? {} : initialFeedbackThinking
	);
	const currentFeedbackAssistantDrafts = $derived.by(() =>
		reviewMode === 'mock' ? {} : initialFeedbackAssistantDrafts
	);
	const scoreTone = $derived(currentReview ? createScoreTone(currentReview.score) : null);
	const feedbackRepliesEnabled = $derived(allowFeedbackReplies || reviewMode === 'mock');

	function areInputsLocked(): boolean {
		return !editable || checked || reviewMode === 'live';
	}

	function handleCheck(): void {
		if (reviewMode !== 'mock') {
			return;
		}
		mockReview = buildMockReview(sheet);
		feedbackDrafts = {};
		mockFeedbackThreads = {};
		mockFeedbackSending = {};
		feedbackRequestTokens = {};
		openFeedbackCards = {};
		followUpComposerQuestions = {};
		checked = true;
	}

	function handleReset(): void {
		localAnswers = cloneAnswers(getSeedAnswers());
		activeMatchTerms = {};
		checked = false;
		mockReview = null;
		feedbackDrafts = {};
		mockFeedbackThreads = {};
		mockFeedbackSending = {};
		feedbackRequestTokens = {};
		openFeedbackCards = {};
		followUpComposerQuestions = {};
		openSections = createOpenSections(sheet);
	}

	function isFeedbackCardOpen(questionKey: string): boolean {
		const explicit = openFeedbackCards[questionKey];
		if (explicit !== undefined) {
			return explicit;
		}
		return getFeedbackThread(questionKey)?.status !== 'resolved';
	}

	function toggleFeedbackCard(questionKey: string): void {
		const nextOpen = !isFeedbackCardOpen(questionKey);
		openFeedbackCards = {
			...openFeedbackCards,
			[questionKey]: nextOpen
		};
		if (!nextOpen && followUpComposerQuestions[questionKey]) {
			followUpComposerQuestions = removeQuestionKey(followUpComposerQuestions, questionKey);
		}
	}

	function updateFeedbackDraft(questionKey: string, value: string): void {
		feedbackDrafts = {
			...feedbackDrafts,
			[questionKey]: value
		};
	}

	function getFeedbackDraft(questionKey: string): string {
		return feedbackDrafts[questionKey] ?? '';
	}

	function getFeedbackThread(questionKey: string): PaperSheetFeedbackThread | null {
		return currentFeedbackThreads[questionKey] ?? null;
	}

	function isFeedbackSending(questionKey: string): boolean {
		return currentFeedbackSending[questionKey] ?? false;
	}

	function getFeedbackThinking(questionKey: string): string | null {
		return currentFeedbackThinking[questionKey] ?? null;
	}

	function getFeedbackRuntimeStatus(
		questionKey: string
	): 'connecting' | 'thinking' | 'responding' | null {
		return currentFeedbackRuntimeStatuses[questionKey] ?? null;
	}

	function getFeedbackAssistantDraft(questionKey: string): string | null {
		return currentFeedbackAssistantDrafts[questionKey] ?? null;
	}

	function isResolvedFeedbackThread(questionKey: string): boolean {
		return getFeedbackThread(questionKey)?.status === 'resolved';
	}

	function isFollowUpComposerOpen(questionKey: string): boolean {
		return followUpComposerQuestions[questionKey] ?? false;
	}

	function requestResolvedFollowUp(questionKey: string): void {
		openFeedbackCards = {
			...openFeedbackCards,
			[questionKey]: true
		};
		followUpComposerQuestions = {
			...followUpComposerQuestions,
			[questionKey]: true
		};
	}

	function replyToTutor(
		questionKey: string,
		questionReview: PaperSheetQuestionReview,
		draftOverride?: string
	): void {
		const draft = (draftOverride ?? getFeedbackDraft(questionKey)).trim();
		if (!draft || isFeedbackSending(questionKey)) {
			return;
		}

		if (reviewMode !== 'mock') {
			feedbackDrafts = {
				...feedbackDrafts,
				[questionKey]: ''
			};
			if (followUpComposerQuestions[questionKey]) {
				followUpComposerQuestions = removeQuestionKey(followUpComposerQuestions, questionKey);
			}
			onReplyToTutor?.(questionKey, draft);
			return;
		}

		const sentAt = Date.now();
		feedbackDrafts = {
			...feedbackDrafts,
			[questionKey]: ''
		};
		mockFeedbackSending = {
			...mockFeedbackSending,
			[questionKey]: true
		};
		feedbackRequestTokens = {
			...feedbackRequestTokens,
			[questionKey]: sentAt
		};

		window.setTimeout(() => {
			if (feedbackRequestTokens[questionKey] !== sentAt) {
				return;
			}

			mockFeedbackThreads = {
				...mockFeedbackThreads,
				[questionKey]: {
					status: 'open',
					turns: [
						...(getFeedbackThread(questionKey)?.turns ?? []),
						{
							id: `${questionKey}-student-${sentAt}`,
							speaker: 'student',
							text: draft
						},
						{
							id: `${questionKey}-tutor-${sentAt + 1}`,
							speaker: 'tutor',
							text:
								questionReview.followUp ??
								'That is a sensible next step. Use the theory box to sharpen one exact detail before you move on.'
						}
					]
				}
			};
			mockFeedbackSending = {
				...mockFeedbackSending,
				[questionKey]: false
			};
			feedbackRequestTokens = {
				...feedbackRequestTokens,
				[questionKey]: 0
			};
		}, 900);
	}

	function toggleSection(sectionId: string): void {
		openSections = {
			...openSections,
			[sectionId]: !openSections[sectionId]
		};
	}

	function isSectionOpen(sectionId: string): boolean {
		return openSections[sectionId] ?? true;
	}

	function updateTextAnswer(key: string, value: string): void {
		if (!editable || areInputsLocked()) {
			return;
		}
		localAnswers = {
			...localAnswers,
			[key]: value
		};
	}

	function updateObjectAnswer(key: string, value: Record<string, string>): void {
		if (!editable || areInputsLocked()) {
			return;
		}
		localAnswers = {
			...localAnswers,
			[key]: value
		};
	}

	function getTextAnswer(key: string): string {
		const value = currentAnswers[key];
		return typeof value === 'string' ? value : '';
	}

	function getObjectAnswer(key: string): Record<string, string> {
		const value = currentAnswers[key];
		if (!value || typeof value === 'string') {
			return {};
		}
		return value;
	}

	function updateFillAnswer(questionKey: string, index: number, value: string): void {
		const current = getObjectAnswer(questionKey);
		updateObjectAnswer(questionKey, {
			...current,
			[String(index)]: value
		});
	}

	function updateSpellingAnswer(questionKey: string, index: number, value: string): void {
		const current = getObjectAnswer(questionKey);
		updateObjectAnswer(questionKey, {
			...current,
			[String(index)]: value
		});
	}

	function selectMatchTerm(questionKey: string, term: string): void {
		if (areInputsLocked()) {
			return;
		}
		const current = activeMatchTerms[questionKey] ?? null;
		activeMatchTerms = {
			...activeMatchTerms,
			[questionKey]: current === term ? null : term
		};
	}

	function assignMatch(questionKey: string, matchValue: string): void {
		if (areInputsLocked()) {
			return;
		}
		const activeTerm = activeMatchTerms[questionKey] ?? null;
		if (!activeTerm) {
			return;
		}

		const current = getObjectAnswer(questionKey);
		const next: Record<string, string> = {};
		for (const [term, selected] of Object.entries(current)) {
			if (selected !== matchValue) {
				next[term] = selected;
			}
		}
		next[activeTerm] = matchValue;

		updateObjectAnswer(questionKey, next);
		activeMatchTerms = {
			...activeMatchTerms,
			[questionKey]: null
		};
	}

	function getBlankConfig(
		question: { blanks: [PaperSheetBlank] | [PaperSheetBlank, PaperSheetBlank] },
		index: 0 | 1
	): PaperSheetBlank | null {
		return question.blanks[index] ?? null;
	}

	function getQuestionReview(questionKey: string): PaperSheetQuestionReview | null {
		return currentReview?.questions[questionKey] ?? null;
	}

	function buildSheetSignature(value: PaperSheetData): string {
		return JSON.stringify(value);
	}

	$effect(() => {
		const nextStatuses: Record<string, PaperSheetFeedbackThread['status'] | undefined> = {};
		let nextOpenFeedbackCards = openFeedbackCards;
		let nextFollowUpComposerQuestions = followUpComposerQuestions;
		let openCardsChanged = false;
		let followUpsChanged = false;

		for (const [questionKey, thread] of Object.entries(currentFeedbackThreads)) {
			nextStatuses[questionKey] = thread.status;
			const previousStatus = previousFeedbackThreadStatuses[questionKey];
			if (thread.status === 'resolved' && previousStatus !== 'resolved') {
				if (openFeedbackCards[questionKey] !== false) {
					if (!openCardsChanged) {
						nextOpenFeedbackCards = { ...openFeedbackCards };
						openCardsChanged = true;
					}
					nextOpenFeedbackCards[questionKey] = false;
				}
				if (followUpComposerQuestions[questionKey]) {
					if (!followUpsChanged) {
						nextFollowUpComposerQuestions = { ...followUpComposerQuestions };
						followUpsChanged = true;
					}
					delete nextFollowUpComposerQuestions[questionKey];
				}
				continue;
			}
			if (thread.status !== 'resolved' && followUpComposerQuestions[questionKey]) {
				if (!followUpsChanged) {
					nextFollowUpComposerQuestions = { ...followUpComposerQuestions };
					followUpsChanged = true;
				}
				delete nextFollowUpComposerQuestions[questionKey];
			}
		}

		if (openCardsChanged) {
			openFeedbackCards = nextOpenFeedbackCards;
		}
		if (followUpsChanged) {
			followUpComposerQuestions = nextFollowUpComposerQuestions;
		}
		previousFeedbackThreadStatuses = nextStatuses;
	});
</script>

<div class="paper-sheet" style={paperStyle}>
	<header class="paper-sheet__header">
		<div class="paper-sheet__header-orb paper-sheet__header-orb--large"></div>
		<div class="paper-sheet__header-orb paper-sheet__header-orb--small"></div>

		<div class="paper-sheet__header-row">
			<div>
				<p class="paper-sheet__eyebrow">{sheet.level} · {sheet.subject}</p>
				<h1 class="paper-sheet__title">{sheet.title}</h1>
				<p class="paper-sheet__subtitle">{sheet.subtitle}</p>
			</div>

			<div class="paper-sheet__total-box">
				<p class="paper-sheet__total-label">Total marks</p>
				<p class="paper-sheet__total-value">{totalSheetMarks}</p>
			</div>
		</div>
	</header>

	<div class="paper-sheet__body">
		{#if hookSection}
			<MarkdownContent markdown={hookSection.text} class="paper-sheet__hook" />
		{/if}

		{#each contentSections as section (section.id)}
			<section class="paper-sheet__section">
				<button
					type="button"
					class="paper-sheet__section-header"
					aria-expanded={isSectionOpen(section.id)}
					aria-controls={`paper-sheet-section-${sheet.id}-${section.id}`}
					onclick={() => {
						toggleSection(section.id);
					}}
				>
					<span class="paper-sheet__section-id">{section.id}</span>
					<span class="paper-sheet__section-label">{section.label}</span>
					<span class="paper-sheet__section-marks">{sectionMarks(section)} marks</span>
					{#if isSectionOpen(section.id)}
						<ChevronDownIcon class="paper-sheet__section-chevron" aria-hidden="true" />
					{:else}
						<ChevronRightIcon class="paper-sheet__section-chevron" aria-hidden="true" />
					{/if}
				</button>

				<div
					id={`paper-sheet-section-${sheet.id}-${section.id}`}
					class="paper-sheet__section-body"
					hidden={!isSectionOpen(section.id)}
					aria-hidden={!isSectionOpen(section.id)}
				>
					{#if section.theory}
						<MarkdownContent markdown={section.theory} class="paper-sheet__theory" />
					{/if}

					{#if section.infoBox}
						<div class="paper-sheet__info-box">
							<div class="paper-sheet__info-icon" aria-hidden="true">{section.infoBox.icon}</div>
							<div class="paper-sheet__info-copy">
								<p class="paper-sheet__info-title">{section.infoBox.title}</p>
								<MarkdownContent markdown={section.infoBox.text} class="paper-sheet__info-text" />
							</div>
						</div>
					{/if}

					{#each section.questions ?? [] as question (`${section.id}-${question.id}`)}
						{@const questionKey = buildQuestionKey(section.id, question.id)}
						{@const questionReview = getQuestionReview(questionKey)}
						{@const reviewStatus = currentReview ? (questionReview?.status ?? null) : null}
						{@const feedbackThread = getFeedbackThread(questionKey)}
						{@const showQuestionFeedback = questionReview && shouldShowQuestionFeedback(questionReview)}
						{@const resolvedFeedback = feedbackThread?.status === 'resolved'}
						{@const showLinesMarkdown = shouldShowLinesMarkdownRow(question)}

						<div
							class={`paper-sheet__question ${showQuestionFeedback ? 'has-feedback' : ''} ${resolvedFeedback ? 'is-resolved' : ''} ${showLinesMarkdown ? 'has-lines-markdown' : ''}`}
						>
							<div class={`paper-sheet__question-number ${resolvedFeedback ? 'is-resolved' : ''}`}>
								{questionNumbers[questionKey]}
							</div>

							<div class="paper-sheet__question-body">
								{#if question.type === 'fill'}
									{@const fillAnswers = getObjectAnswer(questionKey)}
									{@const value0 = fillAnswers['0'] ?? ''}
									{@const value1 = fillAnswers['1'] ?? ''}
									{@const blank0 = getBlankConfig(question, 0)}
									{@const blank1 = getBlankConfig(question, 1)}

									<div class="paper-sheet__fill-row">
										<MarkdownContent
											inline
											markdown={question.prompt}
											class="paper-sheet__inline-markdown"
										/>
										<input
											class="paper-sheet__inline-input"
											style={buildTextInputStyle(reviewStatus, blank0?.minWidth ?? 100)}
											value={value0}
											oninput={(event) => {
												updateFillAnswer(questionKey, 0, readInputValue(event));
											}}
											placeholder={blank0?.placeholder ?? '...'}
											readonly={areInputsLocked()}
										/>

										{#if blank1}
											<MarkdownContent
												inline
												markdown={question.conjunction ?? ''}
												class="paper-sheet__inline-markdown"
											/>
											<input
												class="paper-sheet__inline-input"
												style={buildTextInputStyle(reviewStatus, blank1.minWidth ?? 100)}
												value={value1}
												oninput={(event) => {
													updateFillAnswer(questionKey, 1, readInputValue(event));
												}}
												placeholder={blank1.placeholder ?? '...'}
												readonly={areInputsLocked()}
											/>
										{/if}

										<MarkdownContent
											inline
											markdown={question.after}
											class="paper-sheet__inline-markdown"
										/>
									</div>
								{:else if question.type === 'mcq'}
									{@const selected = getTextAnswer(questionKey)}

									<MarkdownContent markdown={question.prompt} class="paper-sheet__prompt" />
									<div class="paper-sheet__mcq-grid">
										{#each question.options as option, optionIndex (`${question.id}-option-${optionIndex}`)}
											{@const selectedOption = selected === option}

											<button
												type="button"
												class={`paper-sheet__mcq-option ${selectedOption ? 'is-selected' : ''}`}
												style={buildMcqOptionStyle(selectedOption, reviewStatus)}
												disabled={areInputsLocked()}
												onclick={() => {
													updateTextAnswer(questionKey, option);
												}}
											>
												<span
													class="paper-sheet__mcq-radio"
													style={buildMcqRadioStyle(selectedOption, reviewStatus)}
												>
													{#if selectedOption}
														<span class="paper-sheet__mcq-radio-dot"></span>
													{/if}
												</span>
												<MarkdownContent inline markdown={option} class="paper-sheet__mcq-label" />
											</button>
										{/each}
									</div>
								{:else if question.type === 'lines'}
									{@const textValue = getTextAnswer(questionKey)}

									<MarkdownContent markdown={question.prompt} class="paper-sheet__prompt" />
									{#if !showLinesMarkdown}
										<textarea
											class="paper-sheet__lines-input"
											value={textValue}
											rows={question.lines}
											oninput={(event) => {
												updateTextAnswer(questionKey, readInputValue(event));
											}}
											placeholder="Write your answer here..."
											readonly={areInputsLocked()}
										></textarea>
									{/if}
								{:else if question.type === 'calc'}
									{@const calcValue = getTextAnswer(questionKey)}

									<MarkdownContent markdown={question.prompt} class="paper-sheet__prompt" />
									{#if question.hint}
										<div class="paper-sheet__hint">
											<MarkdownContent inline markdown={`Hint: ${question.hint}`} />
										</div>
									{/if}
									<div class="paper-sheet__calc-row">
										<MarkdownContent
											inline
											markdown={question.inputLabel}
											class="paper-sheet__inline-markdown"
										/>
										<input
											class="paper-sheet__inline-input paper-sheet__inline-input--compact"
											style={buildTextInputStyle(reviewStatus)}
											value={calcValue}
											oninput={(event) => {
												updateTextAnswer(questionKey, readInputValue(event));
											}}
											placeholder="..."
											readonly={areInputsLocked()}
										/>
										<MarkdownContent
											inline
											markdown={question.unit}
											class="paper-sheet__inline-markdown"
										/>
									</div>
								{:else if question.type === 'match'}
									{@const selections = getObjectAnswer(questionKey)}
									{@const activeTerm = activeMatchTerms[questionKey] ?? null}
									{@const takenMatches = Object.values(selections)}

									<div class="paper-sheet__prompt paper-sheet__prompt--with-note">
										<MarkdownContent inline markdown={question.prompt} />
										<span class="paper-sheet__prompt-note"
											>(Click a term, then click its meaning)</span
										>
									</div>

									<div class="paper-sheet__match-grid">
										<div class="paper-sheet__match-column">
											{#each question.pairs as pair, pairIndex (`${question.id}-term-${pairIndex}`)}
												{@const isActive = activeTerm === pair.term}
												{@const hasMatch = Boolean(selections[pair.term])}

												<button
													type="button"
													class="paper-sheet__match-button paper-sheet__match-button--term"
													style={buildMatchTermStyle(isActive, hasMatch, reviewStatus)}
													disabled={areInputsLocked()}
													onclick={() => {
														selectMatchTerm(questionKey, pair.term);
													}}
												>
													<MarkdownContent
														inline
														markdown={pair.term}
														class="paper-sheet__match-label"
													/>
												</button>
											{/each}
										</div>

										<div class="paper-sheet__match-column">
											{#each question.pairs as pair, pairIndex (`${question.id}-match-${pairIndex}`)}
												{@const taken = takenMatches.includes(pair.match)}

												<button
													type="button"
													class="paper-sheet__match-button"
													style={buildMatchValueStyle(taken, Boolean(activeTerm))}
													disabled={areInputsLocked() || !activeTerm}
													onclick={() => {
														assignMatch(questionKey, pair.match);
													}}
												>
													<MarkdownContent
														inline
														markdown={pair.match}
														class="paper-sheet__match-label"
													/>
												</button>
											{/each}
										</div>
									</div>
								{:else if question.type === 'spelling'}
									{@const spellingAnswers = getObjectAnswer(questionKey)}

									<MarkdownContent markdown={question.prompt} class="paper-sheet__prompt" />
									<div class="paper-sheet__spelling-list">
										{#each question.words as word, index (`${question.id}-${index}`)}
											{@const spellingValue = spellingAnswers[String(index)] ?? ''}

											<div class="paper-sheet__spelling-row">
												<MarkdownContent
													inline
													markdown={word.wrong}
													class="paper-sheet__spelling-wrong"
												/>
												<span class="paper-sheet__spelling-arrow">→</span>
												<input
													class="paper-sheet__inline-input paper-sheet__inline-input--wide"
													style={buildTextInputStyle(reviewStatus, 140)}
													value={spellingValue}
													oninput={(event) => {
														updateSpellingAnswer(questionKey, index, readInputValue(event));
													}}
													placeholder="correct spelling..."
													readonly={areInputsLocked()}
												/>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<div class={`paper-sheet__question-marks ${resolvedFeedback ? 'is-resolved' : ''}`}>
								[{question.marks}m]
							</div>

							{#if showLinesMarkdown}
								<div class="paper-sheet__lines-markdown">
									<MarkdownContent
										markdown={getTextAnswer(questionKey)}
										class="paper-sheet__answer-markdown"
									/>
								</div>
							{/if}

							{#if showQuestionFeedback}
								<div class="paper-sheet__question-feedback">
									<PaperSheetQuestionFeedback
										review={questionReview}
										questionLabel={`question ${questionNumbers[questionKey]}`}
										open={isFeedbackCardOpen(questionKey)}
										draft={getFeedbackDraft(questionKey)}
										thread={feedbackThread}
										processing={isFeedbackSending(questionKey)}
										runtimeStatus={getFeedbackRuntimeStatus(questionKey)}
										thinkingText={getFeedbackThinking(questionKey)}
										assistantDraftText={getFeedbackAssistantDraft(questionKey)}
										showComposer={
											feedbackRepliesEnabled &&
											(!resolvedFeedback || isFollowUpComposerOpen(questionKey))
										}
										showFollowUpButton={
											feedbackRepliesEnabled &&
											resolvedFeedback &&
											!isFollowUpComposerOpen(questionKey)
										}
										showComposerTools={false}
										resolvedFollowUpMode={isFollowUpComposerOpen(questionKey)}
										onToggle={() => {
											toggleFeedbackCard(questionKey);
										}}
										onRequestFollowUp={() => {
											requestResolvedFollowUp(questionKey);
										}}
										onDraftChange={(value) => {
											updateFeedbackDraft(questionKey, value);
										}}
										onReply={(value) => {
											replyToTutor(questionKey, questionReview, value);
										}}
									/>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/each}

		{#if currentReview && scoreTone}
			<div
				class="paper-sheet__score-card"
				style={`background:${scoreTone.background}; border-color:${scoreTone.border};`}
			>
				<p class="paper-sheet__score-label">{currentReview.label}</p>
				<p class="paper-sheet__score-value" style={`color:${scoreTone.text};`}>
					{currentReview.score.got} / {currentReview.score.total}
				</p>
				<p class="paper-sheet__score-message">{scoreTone.message}</p>
				<p class="paper-sheet__score-note">{currentReview.message}</p>
				<p class="paper-sheet__score-note">{currentReview.note}</p>
				{#if currentReview.objectiveQuestionCount !== undefined || currentReview.teacherReviewQuestionCount !== undefined}
					<p class="paper-sheet__score-note">
						{currentReview.objectiveQuestionCount ?? 0} objective questions ·
						{currentReview.teacherReviewQuestionCount ?? 0} teacher-reviewed responses
					</p>
				{/if}
			</div>
		{/if}

		{#if reviewMode === 'mock'}
			<div class="paper-sheet__actions">
				{#if checked}
					<button
						type="button"
						class="paper-sheet__action paper-sheet__action--secondary"
						onclick={handleReset}
					>
						Reset Demo
					</button>
				{:else}
					<button
						type="button"
						class="paper-sheet__action paper-sheet__action--primary"
						onclick={handleCheck}
					>
						Show Mock Review
					</button>
				{/if}
			</div>
		{/if}

		{#if showFooter}
			<footer class="paper-sheet__footer">
				<span>{sheet.level} · {sheet.subject} · {sheet.title}</span>
				<span>Spark Sheet</span>
			</footer>
		{/if}
	</div>
</div>

<style>
	.paper-sheet {
		position: relative;
		overflow: hidden;
		border-radius: 4px;
		background: var(--paper-surface);
		box-shadow: var(--paper-frame-shadow);
		font-family: Georgia, 'Times New Roman', serif;
		color: var(--paper-text);
		--paper-accent-text: var(--sheet-color);
		--paper-surface: #ffffff;
		--paper-surface-elevated: #ffffff;
		--paper-surface-soft: #fafafa;
		--paper-surface-subtle: #f9f9f9;
		--paper-surface-lined: #fdfdfd;
		--paper-border: var(--sheet-color-30);
		--paper-border-soft: var(--sheet-color-25);
		--paper-divider: #e0e0e0;
		--paper-text: #1a1a1a;
		--paper-text-strong: #111111;
		--paper-text-soft: #555555;
		--paper-text-muted: #666666;
		--paper-text-subtle: #888888;
		--paper-text-faint: #bbbbbb;
		--paper-placeholder: #999999;
		--paper-hook-text: #444444;
		--paper-theory-text: #222222;
		--paper-info-text: #333333;
		--paper-section-header-bg: var(--sheet-color-14);
		--paper-section-header-hover: var(--sheet-color-15);
		--paper-theory-bg: var(--sheet-color-08);
		--paper-info-bg: var(--sheet-color-10);
		--paper-choice-surface: #fafafa;
		--paper-choice-border: #d0d0d0;
		--paper-radio-border: #bbbbbb;
		--paper-input-border: var(--sheet-color-60);
		--paper-accent-soft-bg: color-mix(
			in srgb,
			var(--paper-accent-text) 8%,
			var(--paper-choice-surface)
		);
		--paper-accent-softest-bg: color-mix(
			in srgb,
			var(--paper-accent-text) 4%,
			var(--paper-choice-surface)
		);
		--paper-accent-whisper-bg: color-mix(
			in srgb,
			var(--paper-accent-text) 2%,
			var(--paper-choice-surface)
		);
		--paper-lines-bg: #ffffff;
		--paper-lines-readonly-bg: #f9f9f9;
		--paper-lines-markdown-bg: #fdfdfd;
		--paper-lines-rule: #e8e8e8;
		--paper-lines-rule-alt: #ececec;
		--paper-frame-shadow: 0 4px 30px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.1);
		--paper-card-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
		--paper-header-orb: rgba(255, 255, 255, 0.08);
		--paper-header-orb-subtle: rgba(255, 255, 255, 0.06);
		--paper-header-eyebrow: rgba(255, 255, 255, 0.72);
		--paper-header-subtitle: rgba(255, 255, 255, 0.76);
		--paper-action-secondary-bg: #ffffff;
		--paper-action-secondary-text: var(--paper-accent-text);
		--paper-action-secondary-border: var(--paper-accent-text);
		--paper-review-correct-bg: #edfdf6;
		--paper-review-correct-border: #22a66e;
		--paper-review-correct-text: #1a8c5b;
		--paper-review-incorrect-bg: #fbefe3;
		--paper-review-incorrect-border: #c66317;
		--paper-review-incorrect-text: #c66317;
		--paper-review-teacher-bg: #fff6d8;
		--paper-review-teacher-border: #d6a11e;
		--paper-review-teacher-text: #b07a00;
		--markdown-text: var(--paper-text);
		--markdown-heading: var(--paper-text);
		--markdown-strong: var(--paper-accent-text);
		--markdown-link: var(--paper-accent-text);
		--markdown-quote-border: var(--paper-border);
		--markdown-quote-text: var(--paper-text-soft);
		--markdown-inline-code-bg: color-mix(
			in srgb,
			var(--paper-accent-text) 10%,
			var(--paper-surface)
		);
		--markdown-inline-code-text: var(--paper-text);
		--markdown-table-border: var(--paper-border-soft);
		--markdown-table-head-bg: color-mix(
			in srgb,
			var(--paper-accent-text) 10%,
			var(--paper-surface)
		);
		--markdown-code-bg: #162033;
		--markdown-code-header-bg: #1f2c44;
		--markdown-code-border: rgba(180, 198, 223, 0.24);
		--markdown-code-text: #f8fafc;
		--markdown-code-muted: #94a3b8;
		--markdown-code-keyword: #c084fc;
		--markdown-code-string: #34d399;
		--markdown-code-number: #fbbf24;
		--markdown-code-function: #60a5fa;
		--markdown-code-type: #f472b6;
	}

	:global([data-theme='dark'] .paper-sheet),
	:global(:root:not([data-theme='light']) .paper-sheet) {
		--paper-accent-text: color-mix(in srgb, var(--sheet-color) 70%, #f8fafc);
		--paper-surface: #17142a;
		--paper-surface-elevated: #201c39;
		--paper-surface-soft: #1d1934;
		--paper-surface-subtle: #18152c;
		--paper-surface-lined: #1b1732;
		--paper-border: color-mix(in srgb, var(--sheet-color) 34%, #302850);
		--paper-border-soft: color-mix(in srgb, var(--sheet-color) 22%, #302850);
		--paper-divider: #3a3258;
		--paper-text: #e4dff5;
		--paper-text-strong: #f0eef8;
		--paper-text-soft: #a89ec4;
		--paper-text-muted: #9489b4;
		--paper-text-subtle: #7f739d;
		--paper-text-faint: #6b5f8a;
		--paper-placeholder: #756a92;
		--paper-hook-text: #c5bbdf;
		--paper-theory-text: #ddd6f2;
		--paper-info-text: #d7cfe9;
		--paper-section-header-bg: color-mix(in srgb, var(--sheet-color) 18%, #1f1a37);
		--paper-section-header-hover: color-mix(in srgb, var(--sheet-color) 24%, #221d3d);
		--paper-theory-bg: color-mix(in srgb, var(--sheet-color) 14%, #17142a);
		--paper-info-bg: color-mix(in srgb, var(--sheet-color) 18%, #201c39);
		--paper-choice-surface: #1d1934;
		--paper-choice-border: #3a3258;
		--paper-radio-border: #6b5f8a;
		--paper-input-border: color-mix(in srgb, var(--paper-accent-text) 54%, #5c517c);
		--paper-accent-soft-bg: color-mix(in srgb, var(--paper-accent-text) 18%, #1d1934);
		--paper-accent-softest-bg: color-mix(in srgb, var(--paper-accent-text) 10%, #1d1934);
		--paper-accent-whisper-bg: color-mix(in srgb, var(--paper-accent-text) 6%, #1d1934);
		--paper-lines-bg: #1b1731;
		--paper-lines-readonly-bg: #18152c;
		--paper-lines-markdown-bg: #1b1732;
		--paper-lines-rule: #3a3258;
		--paper-lines-rule-alt: #41385e;
		--paper-frame-shadow:
			0 30px 80px -48px rgba(2, 6, 23, 0.9), 0 18px 42px -32px rgba(2, 6, 23, 0.75);
		--paper-card-shadow: 0 18px 36px -28px rgba(2, 6, 23, 0.65);
		--paper-action-secondary-bg: color-mix(in srgb, var(--paper-accent-text) 12%, #1d1934);
		--paper-action-secondary-text: var(--paper-accent-text);
		--paper-action-secondary-border: color-mix(in srgb, var(--paper-accent-text) 58%, #665b85);
		--paper-review-correct-bg: color-mix(in srgb, #22a66e 22%, #1d1934);
		--paper-review-correct-border: #4ade80;
		--paper-review-correct-text: #86efac;
		--paper-review-incorrect-bg: color-mix(in srgb, #c66317 24%, #1d1934);
		--paper-review-incorrect-border: #f59e0b;
		--paper-review-incorrect-text: #fdba74;
		--paper-review-teacher-bg: color-mix(in srgb, #d6a11e 24%, #1d1934);
		--paper-review-teacher-border: #fbbf24;
		--paper-review-teacher-text: #fde68a;
	}

	.paper-sheet__header {
		position: relative;
		overflow: hidden;
		padding: 28px 32px 24px;
		background: var(--sheet-color);
	}

	.paper-sheet__header-orb {
		position: absolute;
		border-radius: 999px;
		background: var(--paper-header-orb);
	}

	.paper-sheet__header-orb--large {
		top: -30px;
		right: -30px;
		width: 120px;
		height: 120px;
	}

	.paper-sheet__header-orb--small {
		right: 60px;
		bottom: -20px;
		width: 80px;
		height: 80px;
		background: var(--paper-header-orb-subtle);
	}

	.paper-sheet__header-row {
		position: relative;
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}

	.paper-sheet__eyebrow {
		margin: 0 0 6px;
		font-size: 11px;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: var(--paper-header-eyebrow);
	}

	.paper-sheet__title {
		margin: 0;
		font-size: 28px;
		line-height: 1.1;
		letter-spacing: -0.02em;
		font-weight: 900;
		color: #ffffff;
	}

	.paper-sheet__subtitle {
		margin: 6px 0 0;
		font-size: 12.5px;
		color: var(--paper-header-subtitle);
	}

	.paper-sheet__total-box {
		flex-shrink: 0;
		text-align: right;
	}

	.paper-sheet__total-label {
		margin: 0 0 4px;
		font-size: 11px;
		color: var(--paper-header-eyebrow);
	}

	.paper-sheet__total-value {
		margin: 0;
		font-size: 32px;
		line-height: 1;
		font-weight: 900;
		color: #ffffff;
	}

	.paper-sheet__body {
		padding: 24px 32px 32px;
	}

	.paper-sheet__hook {
		margin-bottom: 24px;
		padding-left: 16px;
		border-left: 4px solid var(--sheet-accent);
		font-size: 14px;
		line-height: 1.8;
		font-style: italic;
		color: var(--paper-hook-text);
	}

	.paper-sheet__section {
		margin-bottom: 24px;
		overflow: hidden;
		border: 1.5px solid var(--paper-border);
		border-radius: 10px;
		background: var(--paper-surface-elevated);
		box-shadow: var(--paper-card-shadow);
	}

	.paper-sheet__section-header {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 12px;
		border: 0;
		border-bottom: 1px solid transparent;
		background: var(--paper-section-header-bg);
		padding: 12px 18px;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
	}

	.paper-sheet__section-header:hover {
		background: var(--paper-section-header-hover);
	}

	.paper-sheet__section-id {
		display: flex;
		height: 28px;
		width: 28px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 14px;
		font-weight: 900;
	}

	.paper-sheet__section-label {
		flex: 1;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--paper-text);
	}

	.paper-sheet__section-marks {
		font-size: 12px;
		color: var(--paper-text-muted);
	}

	.paper-sheet__section-chevron {
		height: 16px;
		width: 16px;
		color: var(--paper-accent-text);
	}

	.paper-sheet__section-body {
		padding: 16px 18px;
	}

	.paper-sheet__theory {
		margin-bottom: 14px;
		border-left: 3px solid var(--paper-accent-text);
		border-radius: 0 6px 6px 0;
		background: var(--paper-theory-bg);
		padding: 12px 16px;
		font-size: 13.5px;
		line-height: 1.7;
		color: var(--paper-theory-text);
	}

	.paper-sheet__info-box {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		margin-bottom: 14px;
		border: 1px solid var(--paper-border-soft);
		border-radius: 8px;
		background: var(--paper-info-bg);
		padding: 10px 14px;
	}

	.paper-sheet__info-icon {
		font-size: 22px;
		line-height: 1;
	}

	.paper-sheet__info-title {
		margin: 0 0 3px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--paper-accent-text);
	}

	.paper-sheet__info-text {
		font-size: 13px;
		line-height: 1.6;
		color: var(--paper-info-text);
	}

	.paper-sheet__question {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto;
		column-gap: 12px;
		row-gap: 14px;
		align-items: start;
		padding: 14px 0;
		border-bottom: 1px dashed var(--paper-divider);
	}

	.paper-sheet__question.is-resolved {
		border-bottom-color: color-mix(in srgb, #22a66e 35%, #e0e0e0);
	}

	.paper-sheet__question:last-child {
		border-bottom: 0;
	}

	.paper-sheet__question-number {
		display: flex;
		height: 26px;
		width: 26px;
		grid-column: 1;
		grid-row: 1;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		margin-top: 1px;
		border-radius: 999px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 12px;
		font-weight: 800;
	}

	.paper-sheet__question-number.is-resolved {
		background: #22a66e;
	}

	.paper-sheet__question-body {
		grid-column: 2;
		grid-row: 1;
		flex: 1;
		min-width: 0;
	}

	.paper-sheet__question-marks {
		grid-column: 3;
		grid-row: 1;
		flex-shrink: 0;
		align-self: flex-start;
		padding-left: 8px;
		margin-top: 2px;
		font-size: 11px;
		line-height: 1;
		font-weight: 700;
		white-space: nowrap;
		color: var(--paper-accent-text);
	}

	.paper-sheet__question-marks.is-resolved {
		color: #1a8c5b;
	}

	.paper-sheet__question-feedback {
		grid-column: 2 / 4;
		grid-row: 2;
		min-width: 0;
	}

	.paper-sheet__question.has-lines-markdown .paper-sheet__question-feedback {
		grid-row: 3;
	}

	.paper-sheet__prompt {
		margin-bottom: 10px;
		font-size: 13.5px;
		line-height: 1.6;
	}

	.paper-sheet__prompt--with-note {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px;
	}

	.paper-sheet__prompt-note {
		font-size: 12px;
		font-style: italic;
		color: var(--paper-text-subtle);
	}

	.paper-sheet__inline-markdown,
	.paper-sheet__mcq-label,
	.paper-sheet__match-label,
	.paper-sheet__spelling-wrong {
		font-size: inherit;
		line-height: inherit;
	}

	.paper-sheet__fill-row,
	.paper-sheet__calc-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: 13.5px;
		line-height: 2.2;
	}

	.paper-sheet__inline-input {
		width: auto;
		border: 0;
		border-bottom: 2px solid var(--sheet-color-60);
		border-radius: 3px 3px 0 0;
		background: transparent;
		padding: 2px 6px;
		outline: none;
		font-family: inherit;
		font-size: 13.5px;
		color: var(--paper-text-strong);
		transition: border-color 0.2s;
	}

	.paper-sheet__inline-input--compact {
		width: 100px;
		min-width: 100px;
		padding: 4px 8px;
	}

	.paper-sheet__inline-input--wide {
		min-width: 140px;
		padding: 3px 8px;
	}

	.paper-sheet__inline-input::placeholder,
	.paper-sheet__lines-input::placeholder {
		color: var(--paper-placeholder);
	}

	.paper-sheet__mcq-grid,
	.paper-sheet__match-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.paper-sheet__mcq-option,
	.paper-sheet__match-button {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1.5px solid var(--paper-choice-border);
		border-radius: 6px;
		background: var(--paper-choice-surface);
		padding: 8px 12px;
		font-family: inherit;
		font-size: 13px;
		text-align: left;
		color: var(--paper-text);
	}

	.paper-sheet__mcq-option {
		cursor: pointer;
		transition: all 0.15s;
	}

	.paper-sheet__mcq-option:disabled,
	.paper-sheet__match-button:disabled {
		cursor: default;
	}

	.paper-sheet__mcq-option.is-selected {
		font-weight: 600;
	}

	.paper-sheet__mcq-radio {
		display: flex;
		height: 18px;
		width: 18px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--paper-radio-border);
		border-radius: 999px;
		background: var(--paper-lines-bg);
	}

	.paper-sheet__mcq-radio-dot {
		height: 7px;
		width: 7px;
		border-radius: 999px;
		background: #ffffff;
	}

	.paper-sheet__mcq-label {
		display: block;
		min-width: 0;
	}

	.paper-sheet__match-label {
		display: block;
		min-width: 0;
	}

	.paper-sheet__hint {
		display: inline-block;
		margin-bottom: 8px;
		border-radius: 4px;
		background: var(--paper-accent-softest-bg);
		padding: 4px 10px;
		font-size: 12px;
		font-style: italic;
		color: var(--paper-accent-text);
	}

	.paper-sheet__lines-input {
		box-sizing: border-box;
		width: 100%;
		resize: vertical;
		border: 1.5px solid var(--paper-border);
		border-radius: 6px;
		background-color: var(--paper-lines-bg);
		background-image: repeating-linear-gradient(
			transparent,
			transparent calc(1.8em - 1px),
			var(--paper-lines-rule) calc(1.8em - 1px),
			var(--paper-lines-rule) 1.8em
		);
		padding: 8px 10px;
		font-family: inherit;
		font-size: 13.5px;
		line-height: 1.8;
		color: var(--paper-text);
		outline: none;
	}

	.paper-sheet__lines-input[readonly] {
		background-color: var(--paper-lines-readonly-bg);
	}

	.paper-sheet__lines-markdown {
		grid-column: 2 / 4;
		grid-row: 2;
		min-width: 0;
		border: 1.5px solid var(--paper-border);
		border-radius: 6px;
		background:
			repeating-linear-gradient(
				transparent,
				transparent calc(1.8em - 1px),
				var(--paper-lines-rule-alt) calc(1.8em - 1px),
				var(--paper-lines-rule-alt) 1.8em
			),
			var(--paper-lines-markdown-bg);
		padding: 10px 12px;
	}

	.paper-sheet__answer-markdown {
		min-height: calc(1.8em * 3);
		font-size: 13.5px;
		line-height: 1.8;
		--markdown-strong: var(--sheet-color);
	}

	.paper-sheet__match-column {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.paper-sheet__match-button {
		justify-content: space-between;
	}

	.paper-sheet__match-button--term {
		font-weight: 700;
	}

	.paper-sheet__spelling-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.paper-sheet__spelling-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.paper-sheet__spelling-wrong {
		display: inline-block;
		width: 120px;
		font-size: 13px;
		color: var(--paper-text-subtle);
		text-decoration: line-through;
	}

	.paper-sheet__spelling-arrow {
		font-size: 13px;
	}

	.paper-sheet__score-card {
		margin: 8px 0 16px;
		border: 2px solid #22a66e;
		border-radius: 10px;
		padding: 20px 24px;
		text-align: center;
	}

	.paper-sheet__score-label {
		margin: 0 0 4px;
		font-size: 13px;
		color: var(--paper-text-muted);
	}

	.paper-sheet__score-value {
		margin: 0;
		font-size: 36px;
		line-height: 1;
		font-weight: 900;
	}

	.paper-sheet__score-message {
		margin: 6px 0 0;
		font-size: 13.5px;
		color: var(--paper-text-soft);
	}

	.paper-sheet__score-note {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--paper-text-subtle);
	}

	.paper-sheet__actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
	}

	.paper-sheet__action {
		border-radius: 8px;
		padding: 10px 24px;
		font-family: inherit;
		font-size: 13.5px;
		font-weight: 700;
		cursor: pointer;
	}

	.paper-sheet__action--primary {
		border: 0;
		background: var(--sheet-color);
		color: #ffffff;
		box-shadow: 0 3px 12px var(--sheet-color-40);
	}

	.paper-sheet__action--secondary {
		border: 2px solid var(--paper-action-secondary-border);
		background: var(--paper-action-secondary-bg);
		color: var(--paper-action-secondary-text);
	}

	.paper-sheet__footer {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		margin-top: 32px;
		padding-top: 16px;
		border-top: 1px solid var(--paper-divider);
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--paper-text-faint);
	}

	@media (max-width: 900px) {
		.paper-sheet__header,
		.paper-sheet__body {
			padding-right: 20px;
			padding-left: 20px;
		}
	}

	@media (max-width: 720px) {
		.paper-sheet__header-row,
		.paper-sheet__footer {
			flex-direction: column;
		}

		.paper-sheet__total-box {
			text-align: left;
		}

		.paper-sheet__question {
			grid-template-columns: 26px minmax(0, 1fr);
		}

		.paper-sheet__question-marks {
			grid-column: 2;
			grid-row: 2;
			padding-left: 0;
			margin-top: -4px;
		}

		.paper-sheet__question-feedback {
			grid-column: 1 / -1;
			grid-row: 3;
		}

		.paper-sheet__question.has-lines-markdown .paper-sheet__question-feedback {
			grid-row: 4;
		}

		.paper-sheet__lines-markdown {
			grid-column: 1 / -1;
			grid-row: 3;
		}

		.paper-sheet__mcq-grid,
		.paper-sheet__match-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.paper-sheet__section-header {
			flex-wrap: wrap;
		}

		.paper-sheet__section-marks {
			margin-left: 40px;
		}
	}
</style>
