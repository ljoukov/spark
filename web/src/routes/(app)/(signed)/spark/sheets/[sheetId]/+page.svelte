<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import {
		Sheet as PaperSheet,
		type SheetDocument,
		type SheetFeedbackStateMap
	} from '@ljoukov/sheet';
	import type {
		PaperSheetAnswers,
		PaperSheetFeedbackAttachment,
		PaperSheetFeedbackThread,
		PaperSheetQuestion,
		SparkGraderWorksheetReport,
		SparkSheetPageState,
		SparkSolveSheetDraft,
		SparkSolveSheetAnswers,
		SparkTutorReviewGapBand,
		SparkTutorReviewState
	} from '@spark/schemas';
	import {
		applyPaperSheetSubjectTheme,
		SparkGraderRunSchema,
		SparkSheetPageStateSchema,
		SparkAgentWorkspaceFileSchema,
		SparkGraderWorksheetReportSchema,
		SparkSolveSheetAnswersSchema,
		SparkSolveSheetDraftSchema,
		SparkTutorReviewStateSchema,
		SparkTutorSessionSchema
	} from '@spark/schemas';
	import { doc, getFirestore, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { getContext, onMount, untrack } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import CloseGapResponseModal from '$lib/components/spark/sheets/CloseGapResponseModal.svelte';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ClientUser = NonNullable<PageData['user']> | null;
	type FeedbackRuntimeStatus = 'connecting' | 'thinking' | 'responding';
	type PendingReply = {
		text: string;
		attachments: PaperSheetFeedbackAttachment[];
	};
	type PaperSheetSection = SheetDocument['sections'][number];
	type PaperSheetContentSection = Extract<PaperSheetSection, { id: string }>;
	type PaperSheetQuestionEntry = NonNullable<PaperSheetContentSection['questions']>[number];
	type PaperSheetReview = SparkGraderWorksheetReport['review'];
	type SectionScoreSummary = {
		got: number;
		total: number;
	};
	type QuestionScoreTone = 'full' | 'partial' | 'zero';
	type QuestionMarkLabel = {
		questionId: string;
		text: string;
		tone: QuestionScoreTone | null;
	};
	type CloseGapMessage = {
		id: string;
		author: 'assistant' | 'student';
		markdown: string;
		attachments?: PaperSheetFeedbackAttachment[];
	};
	type CloseGapQuestionContext = {
		questionId: string;
		questionLabel: string;
		questionPrompt: string;
		studentAnswer: string;
		reviewNote: string;
		replyPlaceholder: string;
		gapBand: SparkTutorReviewGapBand;
		messages: CloseGapMessage[];
		resolved: boolean;
	};

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);
	const initialRun = untrack(() => data.run);
	const initialDraft = untrack(() => data.draft);
	const initialDraftAnswers = untrack(() => data.draftAnswers);
	const initialReport = untrack(() => data.report);
	const initialReviewState = untrack(
		() => data.interaction?.reviewState ?? data.initialReviewState ?? null
	);
	const initialInteractionSessionId = untrack(() => data.interaction?.id ?? null);
	const initialActiveTurnQuestionId = untrack(() => data.interaction?.activeTurnQuestionId ?? null);

	let authReady = $state(false);
	let run = $state<PageData['run']>(initialRun);
	let lastSyncedDataRun = $state<PageData['run']>(initialRun);
	let draft = $state<SparkSolveSheetDraft | null>(initialDraft);
	let draftAnswers = $state<PaperSheetAnswers>(initialDraftAnswers);
	let report = $state<SparkGraderWorksheetReport | null>(initialReport);
	let reviewState = $state<SparkTutorReviewState | null>(initialReviewState);
	let interactionSessionId = $state<string | null>(initialInteractionSessionId);
	let activeTurnQuestionId = $state<string | null>(initialActiveTurnQuestionId);
	let requestError = $state<string | null>(null);
	let draftSaveError = $state<string | null>(null);
	let savingDraft = $state(false);
	let gradingDraft = $state(false);
	let submittingQuestionIds = $state<Record<string, boolean>>({});
	let pendingReplies = $state<Record<string, PendingReply>>({});
	let responseDrafts = $state<Record<string, string>>({});
	let activeResponseQuestionId = $state<string | null>(null);
	let activeResponseDraft = $state('');
	let draftSaveTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let lastSavedDraftSignature = $state(JSON.stringify(initialDraftAnswers));
	let artifactRefreshInFlight = $state(false);
	let artifactRefreshAttempts = $state(0);
	let sheetShellElement = $state<HTMLElement | null>(null);

	const ARTIFACT_REFRESH_MAX_ATTEMPTS = 120;
	const ARTIFACT_REFRESH_MAX_DELAY_MS = 5000;
	const ARTIFACT_REFRESH_REQUEST_TIMEOUT_MS = 4000;

	function resolveSnapshotSheetPhase(
		status: PageData['run']['status'],
		explicitPhase: PageData['run']['sheetPhase'] | undefined
	): PageData['run']['sheetPhase'] {
		if (explicitPhase) {
			return explicitPhase;
		}
		if (report) {
			return 'graded';
		}
		if (draft) {
			return 'solving';
		}
		if (status === 'done') {
			return 'graded';
		}
		return 'grading';
	}

	function encodeWorkspaceFileId(filePath: string): string {
		return encodeURIComponent(filePath);
	}

	function removeQuestionKey<T extends Record<string, unknown>>(value: T, questionId: string): T {
		const { [questionId]: _removed, ...rest } = value;
		return rest as T;
	}

	function cleanupPendingReply(reply: PendingReply | undefined): void {
		if (typeof URL === 'undefined') {
			return;
		}
		for (const attachment of reply?.attachments ?? []) {
			if (attachment.url?.startsWith('blob:')) {
				URL.revokeObjectURL(attachment.url);
			}
		}
	}

	function buildSheetAttachmentUrl(filePath: string, filename: string): string {
		const params = new URLSearchParams({
			path: filePath,
			filename
		});
		return `/api/spark/sheets/${run.id}/attachment?${params.toString()}`;
	}

	function buildAttachmentSignature(attachment: {
		filename: string;
		contentType: string;
		sizeBytes: number;
	}): string {
		return `${attachment.filename}::${attachment.contentType}::${attachment.sizeBytes.toString()}`;
	}

	function parseWorkspaceTextFile(
		filePath: string,
		raw: Record<string, unknown> | undefined
	): string | null {
		if (!raw) {
			return null;
		}
		const parsed = SparkAgentWorkspaceFileSchema.safeParse({
			...raw,
			path: filePath
		});
		if (!parsed.success) {
			return null;
		}
		const file = parsed.data;
		if (!('content' in file) || typeof file.content !== 'string') {
			return null;
		}
		return file.content;
	}

	function applyWorkspaceJson<T>(
		filePath: string,
		raw: Record<string, unknown> | undefined,
		parse: (value: unknown) => T,
		apply: (value: T) => void
	): void {
		const text = parseWorkspaceTextFile(filePath, raw);
		if (!text) {
			return;
		}
		try {
			apply(parse(JSON.parse(text)));
		} catch {
			// Ignore transient partial writes.
		}
	}

	function isDraftGradingInProgress(): boolean {
		if (gradingDraft) {
			return true;
		}
		if (run.sheetPhase !== 'grading') {
			return false;
		}
		return run.status !== 'failed' && run.status !== 'stopped';
	}

	function canEditDraftSheet(): boolean {
		if (!draft) {
			return false;
		}
		if (run.sheetPhase !== 'grading') {
			return true;
		}
		return run.status === 'failed' || run.status === 'stopped';
	}

	function eagerLoadSheetFigures(root: HTMLElement): void {
		for (const image of root.querySelectorAll<HTMLImageElement>('.markdown-figure__image')) {
			if (image.getAttribute('loading') !== 'eager') {
				image.setAttribute('loading', 'eager');
			}
			image.decoding = 'async';
		}
	}

	const FIGURE_REFERENCE_LABEL_PATTERN =
		/\b(?:Figure|Fig\.?|Diagram)\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/iu;
	const TABLE_REFERENCE_LABEL_PATTERN = /\bTable\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/iu;
	const ARTIFACT_REFERENCE_TEXT_PATTERN =
		/\b(?:(Figure|Fig\.?|Diagram|Table)\s+(\d+(?:\.\d+)*[A-Za-z]?))\b/giu;

	function buildArtifactAnchorId(kind: 'figure' | 'table', label: string): string {
		const normalizedLabel = label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, '-')
			.replace(/^-+|-+$/gu, '');
		return `${kind}-${normalizedLabel}`;
	}

	function resolveArtifactReference(
		value: string
	): { kind: 'figure' | 'table'; label: string } | null {
		const figureMatch = FIGURE_REFERENCE_LABEL_PATTERN.exec(value);
		if (figureMatch?.[1]) {
			return {
				kind: 'figure',
				label: figureMatch[1]
			};
		}
		const tableMatch = TABLE_REFERENCE_LABEL_PATTERN.exec(value);
		if (tableMatch?.[1]) {
			return {
				kind: 'table',
				label: tableMatch[1]
			};
		}
		return null;
	}

	function collectArtifactAnchors(root: HTMLElement): Map<string, string> {
		const anchors = new Map<string, string>();

		for (const link of root.querySelectorAll<HTMLAnchorElement>('a.markdown-figure-link')) {
			const image = link.querySelector<HTMLImageElement>('.markdown-figure__image');
			const reference = resolveArtifactReference(image?.alt ?? link.textContent ?? '');
			if (!reference) {
				continue;
			}
			const anchorId = buildArtifactAnchorId(reference.kind, reference.label);
			const key = `${reference.kind}:${reference.label.toLowerCase()}`;
			if (!anchors.has(key)) {
				anchors.set(key, anchorId);
				link.id = anchorId;
				link.dataset.sheetArtifactAnchor = key;
			} else {
				link.removeAttribute('id');
				link.dataset.sheetArtifactDuplicate = key;
			}
		}

		for (const table of root.querySelectorAll<HTMLTableElement>('.markdown-content table')) {
			const labelElement = table.previousElementSibling;
			const reference = resolveArtifactReference(labelElement?.textContent ?? '');
			if (!reference || reference.kind !== 'table') {
				continue;
			}
			const anchorId = buildArtifactAnchorId(reference.kind, reference.label);
			const key = `${reference.kind}:${reference.label.toLowerCase()}`;
			if (!anchors.has(key)) {
				anchors.set(key, anchorId);
				if (labelElement instanceof HTMLElement) {
					labelElement.id = anchorId;
					labelElement.dataset.sheetArtifactAnchor = key;
				}
			}
		}

		return anchors;
	}

	function linkArtifactReferences(root: HTMLElement, anchors: Map<string, string>): void {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentElement;
				if (!parent) {
					return NodeFilter.FILTER_REJECT;
				}
				if (
					parent.closest(
						'a, button, input, textarea, select, table, .markdown-figure, script, style'
					)
				) {
					return NodeFilter.FILTER_REJECT;
				}
				ARTIFACT_REFERENCE_TEXT_PATTERN.lastIndex = 0;
				if (!ARTIFACT_REFERENCE_TEXT_PATTERN.test(node.textContent ?? '')) {
					return NodeFilter.FILTER_REJECT;
				}
				ARTIFACT_REFERENCE_TEXT_PATTERN.lastIndex = 0;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const textNodes: Text[] = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			textNodes.push(node as Text);
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent ?? '';
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			ARTIFACT_REFERENCE_TEXT_PATTERN.lastIndex = 0;
			for (const match of text.matchAll(ARTIFACT_REFERENCE_TEXT_PATTERN)) {
				const fullMatch = match[0] ?? '';
				const rawKind = match[1]?.toLowerCase();
				const label = match[2]?.toLowerCase();
				const index = match.index ?? 0;
				if (!rawKind || !label) {
					continue;
				}
				const kind = rawKind === 'table' ? 'table' : 'figure';
				const anchorId = anchors.get(`${kind}:${label}`);
				if (!anchorId) {
					continue;
				}
				if (index > lastIndex) {
					fragment.append(document.createTextNode(text.slice(lastIndex, index)));
				}
				const anchor = document.createElement('a');
				anchor.href = `#${anchorId}`;
				anchor.className = 'paper-sheet__artifact-reference';
				anchor.textContent = fullMatch;
				fragment.append(anchor);
				lastIndex = index + fullMatch.length;
			}
			if (lastIndex === 0) {
				continue;
			}
			if (lastIndex < text.length) {
				fragment.append(document.createTextNode(text.slice(lastIndex)));
			}
			textNode.replaceWith(fragment);
		}
	}

	function relinkExistingArtifactReferenceAnchors(
		root: HTMLElement,
		anchors: Map<string, string>
	): void {
		for (const link of root.querySelectorAll<HTMLAnchorElement>('.markdown-content a')) {
			if (
				link.classList.contains('markdown-figure-link') ||
				link.querySelector('img') ||
				link.dataset.sheetArtifactAnchor ||
				link.dataset.sheetArtifactDuplicate
			) {
				continue;
			}
			const reference = resolveArtifactReference(link.textContent ?? '');
			if (!reference) {
				continue;
			}
			const anchorId = anchors.get(`${reference.kind}:${reference.label.toLowerCase()}`);
			if (!anchorId) {
				continue;
			}
			link.href = `#${anchorId}`;
			link.removeAttribute('target');
			link.removeAttribute('rel');
			link.classList.add('paper-sheet__artifact-reference');
		}
	}

	function annotateSheetArtifacts(root: HTMLElement): void {
		const anchors = collectArtifactAnchors(root);
		if (anchors.size === 0) {
			return;
		}
		relinkExistingArtifactReferenceAnchors(root, anchors);
		linkArtifactReferences(root, anchors);
	}

	const METADATA_STOP_WORDS = new Set([
		'a',
		'an',
		'and',
		'answer',
		'answers',
		'exam',
		'for',
		'mark',
		'marks',
		'of',
		'paper',
		'question',
		'questions',
		'review',
		'source',
		'submission',
		'the',
		'uploaded',
		'worksheet'
	]);

	function significantMetadataTokens(value: string): Set<string> {
		return new Set(
			value
				.toLowerCase()
				.replaceAll(/[^a-z0-9]+/gu, ' ')
				.split(/\s+/u)
				.map((token) => token.trim())
				.map((token) => normalizeMetadataToken(token))
				.filter((token) => token.length > 1 && !METADATA_STOP_WORDS.has(token))
		);
	}

	function normalizeMetadataToken(token: string): string {
		if (token.endsWith('ical')) {
			return token.slice(0, -2);
		}
		if (token.endsWith('ics')) {
			return token.slice(0, -1);
		}
		if (token.endsWith('s') && token.length > 3) {
			return token.slice(0, -1);
		}
		return token;
	}

	function splitMetadataParts(value: string): string[] {
		return value
			.split(/\s*(?:·|•|\||;|\n)\s*/u)
			.map((part) => part.trim())
			.filter((part) => part.length > 0);
	}

	function isRedundantMetadataPart(part: string, title: string): boolean {
		const partTokens = significantMetadataTokens(part);
		if (partTokens.size === 0) {
			return false;
		}
		const titleTokens = significantMetadataTokens(title);
		let overlap = 0;
		for (const token of partTokens) {
			if (titleTokens.has(token)) {
				overlap += 1;
			}
		}
		if (partTokens.size === 1) {
			return overlap === 1;
		}
		return overlap >= 2 && overlap / partTokens.size >= 0.6;
	}

	function stripQuestionPaperSuffix(title: string): string {
		return title
			.replace(/\s+questions?\s+paper\s*$/iu, '')
			.replace(/\s+worksheet\s*$/iu, '')
			.trim();
	}

	function stripRedundantSubtitleParts(subtitle: string, title: string): string {
		const parts = splitMetadataParts(subtitle);
		if (parts.length <= 1) {
			return subtitle.trim();
		}
		const distinctParts = parts.filter((part) => !isRedundantMetadataPart(part, title));
		if (distinctParts.length === 0) {
			return subtitle.trim();
		}
		return distinctParts.join(' · ');
	}

	function buildSubtitleWithUsefulMetadata(sheet: SheetDocument, title: string): string {
		const subtitle = stripRedundantSubtitleParts(sheet.subtitle, title) || sheet.subtitle;
		const subtitleParts = splitMetadataParts(subtitle);
		const usefulMetadataParts = [sheet.level, sheet.subject]
			.map((part) => part.trim())
			.filter((part) => part.length > 0)
			.filter((part) => !isRedundantMetadataPart(part, title))
			.filter(
				(part) => !subtitleParts.some((subtitlePart) => isRedundantMetadataPart(part, subtitlePart))
			);
		return [...usefulMetadataParts, ...subtitleParts].join(' · ');
	}

	function isContentSection(section: PaperSheetSection): section is PaperSheetContentSection {
		return 'id' in section;
	}

	function sumQuestionEntryMarks(entry: PaperSheetQuestionEntry): number {
		if (entry.type === 'group') {
			return sumQuestionMarks(entry.questions);
		}
		return entry.marks;
	}

	function sumQuestionMarks(entries: readonly PaperSheetQuestionEntry[] | undefined): number {
		let total = 0;
		for (const entry of entries ?? []) {
			total += sumQuestionEntryMarks(entry);
		}
		return total;
	}

	function collectLeafQuestionIds(
		entries: readonly PaperSheetQuestionEntry[] | undefined,
		questionIds: string[]
	): void {
		for (const entry of entries ?? []) {
			if (entry.type === 'group') {
				collectLeafQuestionIds(entry.questions, questionIds);
			} else {
				questionIds.push(entry.id);
			}
		}
	}

	function sectionReviewScore(
		section: PaperSheetContentSection,
		review: PaperSheetReview | null | undefined
	): SectionScoreSummary | null {
		if (!review) {
			return null;
		}
		const questionIds: string[] = [];
		collectLeafQuestionIds(section.questions, questionIds);
		if (questionIds.length === 0) {
			return null;
		}
		let got = 0;
		let total = 0;
		for (const questionId of questionIds) {
			const score = review.questions[questionId]?.score;
			if (!score) {
				return null;
			}
			got += score.got;
			total += score.total;
		}
		return { got, total };
	}

	function formatMarkNoun(total: number): string {
		return total === 1 ? 'mark' : 'marks';
	}

	function formatQuestionMarkText(options: {
		marks: number;
		score?: { got: number; total: number } | null;
		awaitingAnswers?: boolean;
	}): string {
		const score = options.score ?? null;
		if (score) {
			return `[${score.got.toString()}/${score.total.toString()} ${formatMarkNoun(score.total)}]`;
		}
		if (options.awaitingAnswers === true) {
			return `[—/${options.marks.toString()} ${formatMarkNoun(options.marks)}]`;
		}
		return `[${options.marks.toString()} ${formatMarkNoun(options.marks)}]`;
	}

	function resolveQuestionScoreTone(
		score: { got: number; total: number } | null | undefined
	): QuestionScoreTone | null {
		if (!score || score.total <= 0) {
			return null;
		}
		if (score.got >= score.total) {
			return 'full';
		}
		if (score.got > 0) {
			return 'partial';
		}
		return 'zero';
	}

	function resolveCloseGapBand(options: {
		thread: SparkTutorReviewState['threads'][string];
		score: { got: number; total: number } | null | undefined;
	}): SparkTutorReviewGapBand {
		if (options.thread.status === 'resolved') {
			return 'closed';
		}
		if (options.thread.gapBand) {
			return options.thread.gapBand;
		}
		const score = options.score;
		if (!score || score.total <= 0) {
			return 'large_gap';
		}
		const missingMarks = score.total - score.got;
		if (missingMarks <= 1 || score.got / score.total >= 0.75) {
			return 'small_gap';
		}
		if (score.got > 0 && score.got / score.total >= 0.35) {
			return 'medium_gap';
		}
		return 'large_gap';
	}

	function collectQuestionMarkLabelsFromEntries(
		entries: readonly PaperSheetQuestionEntry[] | undefined,
		review: PaperSheetReview | null | undefined,
		awaitingAnswers: boolean,
		labels: QuestionMarkLabel[]
	): void {
		for (const entry of entries ?? []) {
			if (entry.type === 'group') {
				collectQuestionMarkLabelsFromEntries(entry.questions, review, awaitingAnswers, labels);
				continue;
			}
			const score = review?.questions[entry.id]?.score ?? null;
			labels.push({
				questionId: entry.id,
				text: formatQuestionMarkText({
					marks: entry.marks,
					score,
					awaitingAnswers
				}),
				tone: resolveQuestionScoreTone(score)
			});
		}
	}

	function collectQuestionMarkLabels(
		sheet: SheetDocument | null,
		review: PaperSheetReview | null | undefined,
		awaitingAnswers: boolean
	): QuestionMarkLabel[] {
		const labels: QuestionMarkLabel[] = [];
		for (const section of sheet?.sections ?? []) {
			if (!isContentSection(section)) {
				continue;
			}
			collectQuestionMarkLabelsFromEntries(section.questions, review, awaitingAnswers, labels);
		}
		return labels;
	}

	function joinQuestionLabel(parentLabel: string | null, childLabel: string): string {
		if (!parentLabel) {
			return childLabel;
		}
		if (childLabel.startsWith(parentLabel)) {
			return childLabel;
		}
		return `${parentLabel}.${childLabel}`;
	}

	function formatCloseGapQuestionPrompt(
		question: PaperSheetQuestion,
		parentPrompt: string | null
	): string {
		const prompt = (() => {
			switch (question.type) {
				case 'answer_bank': {
					const parts: string[] = [];
					for (let index = 0; index < question.blanks.length; index += 1) {
						parts.push(question.segments[index] ?? '');
						parts.push('_____');
					}
					parts.push(question.segments[question.segments.length - 1] ?? '');
					const options = question.options
						.map((option) => `${option.label ? `(${option.label}) ` : ''}${option.text}`)
						.join(' | ');
					return [parts.join(''), options ? `Options: ${options}` : null]
						.filter((value): value is string => Boolean(value))
						.join('\n\n');
				}
				case 'fill':
					return [question.prompt, ...question.blanks.map(() => '_____'), question.after]
						.filter((part) => part.trim().length > 0)
						.join(question.conjunction ? ` ${question.conjunction} ` : ' ');
				case 'cloze': {
					const parts: string[] = [];
					for (let index = 0; index < question.blanks.length; index += 1) {
						parts.push(question.segments[index] ?? '');
						parts.push('_____');
					}
					parts.push(question.segments[question.segments.length - 1] ?? '');
					return parts.join('');
				}
				case 'mcq':
					return [
						question.prompt,
						...question.options.map((option) =>
							`${option.label ? `(${option.label}) ` : ''}${option.text}`
						)
					]
						.filter((part) => part.trim().length > 0)
						.join('\n\n');
				case 'lines':
					return question.prompt;
				case 'calc':
					return [question.prompt, question.inputLabel ? `Answer: ${question.inputLabel}` : null]
						.filter((part): part is string => Boolean(part && part.trim().length > 0))
						.join('\n\n');
				case 'match':
					return [
						question.prompt,
						question.pairs.map((pair) => `${pair.term} -> ${pair.match}`).join('\n')
					]
						.filter((part) => part.trim().length > 0)
						.join('\n\n');
				case 'spelling':
					return [question.prompt, question.words.map((word) => word.wrong).join(' | ')]
						.filter((part) => part.trim().length > 0)
						.join('\n\n');
				case 'flow':
					return question.prompt;
			}
		})();
		return [parentPrompt, prompt]
			.filter((part): part is string => Boolean(part && part.trim().length > 0))
			.join('\n\n');
	}

	function formatCloseGapStudentAnswer(questionId: string): string {
		const value = reviewState?.answers[questionId];
		if (typeof value === 'string') {
			return value.trim().length > 0 ? value : '(blank)';
		}
		if (!value) {
			return '(blank)';
		}
		const entries = Object.entries(value).map(([key, answer]) => {
			const trimmed = answer.trim();
			return `${key}: ${trimmed.length > 0 ? trimmed : '(blank)'}`;
		});
		return entries.length > 0 ? entries.join('\n') : '(blank)';
	}

	function findCloseGapQuestionInEntries(options: {
		entries: readonly PaperSheetQuestionEntry[] | undefined;
		questionId: string;
		parentPrompt: string | null;
		parentLabel: string | null;
		counter: { value: number };
	}): { question: PaperSheetQuestion; questionLabel: string; parentPrompt: string | null } | null {
		for (const entry of options.entries ?? []) {
			if (entry.type === 'group') {
				const nextParentPrompt = [options.parentPrompt, entry.prompt]
					.filter((part): part is string => Boolean(part && part.trim().length > 0))
					.join('\n\n');
				const result = findCloseGapQuestionInEntries({
					entries: entry.questions,
					questionId: options.questionId,
					parentPrompt: nextParentPrompt.length > 0 ? nextParentPrompt : null,
					parentLabel: entry.displayNumber ?? options.parentLabel,
					counter: options.counter
				});
				if (result) {
					return result;
				}
				continue;
			}

			const rawLabel = entry.displayNumber ?? options.counter.value.toString();
			const questionLabel = joinQuestionLabel(options.parentLabel, rawLabel);
			options.counter.value += 1;
			if (entry.id !== options.questionId) {
				continue;
			}
			return {
				question: entry,
				questionLabel: `Question ${questionLabel}`,
				parentPrompt: options.parentPrompt
			};
		}
		return null;
	}

	function findCloseGapQuestionContext(questionId: string): CloseGapQuestionContext | null {
		if (!reviewState || !reviewSheetDocument) {
			return null;
		}
		const counter = { value: 1 };
		for (const section of reviewSheetDocument.sections) {
			if (!isContentSection(section)) {
				continue;
			}
			const result = findCloseGapQuestionInEntries({
				entries: section.questions,
				questionId,
				parentPrompt: null,
				parentLabel: null,
				counter
			});
			if (!result) {
				continue;
			}
			const review = reviewState.review.questions[questionId];
			const thread = reviewState.threads[questionId] ?? null;
			if (!review || !thread) {
				return null;
			}
			const pendingReply = pendingReplies[questionId];
			const messages: CloseGapMessage[] = thread.messages.map((message) => ({
				id: message.id,
				author: message.author,
				markdown: message.markdown,
				...(message.attachments ? { attachments: message.attachments } : {})
			}));
			if (pendingReply) {
				messages.push({
					id: `pending-${questionId}`,
					author: 'student',
					markdown: pendingReply.text,
					attachments: pendingReply.attachments
				});
			}
			return {
				questionId,
				questionLabel: result.questionLabel,
				questionPrompt: formatCloseGapQuestionPrompt(result.question, result.parentPrompt),
				studentAnswer: formatCloseGapStudentAnswer(questionId),
				reviewNote: review.note,
				replyPlaceholder:
					review.replyPlaceholder ?? 'Write what you would change, and why that fixes the gap.',
				gapBand: resolveCloseGapBand({
					thread,
					score: review.score ?? null
				}),
				messages,
				resolved: thread.status === 'resolved'
			};
		}
		return null;
	}

	function annotateQuestionMarkBadges(root: HTMLElement, labels: readonly QuestionMarkLabel[]): void {
		const badges = root.querySelectorAll<HTMLElement>('.paper-sheet__question-marks');
		for (let index = 0; index < badges.length; index += 1) {
			const badge = badges[index];
			const label = labels[index];
			if (!badge || !label) {
				continue;
			}
			if (badge.textContent !== label.text) {
				badge.textContent = label.text;
				badge.setAttribute('aria-label', `Question ${label.questionId} marks ${label.text}`);
			}
			const row = badge.closest<HTMLElement>('.paper-sheet__question');
			const numberBadge = row?.querySelector<HTMLElement>('.paper-sheet__question-number');
			const feedbackCard = row?.querySelector<HTMLElement>('.paper-sheet-note');
			for (const element of [row, badge, numberBadge, feedbackCard]) {
				element?.classList.remove('is-score-full', 'is-score-partial', 'is-score-zero');
				if (label.tone) {
					element?.classList.add(`is-score-${label.tone}`);
				}
			}
		}
	}

	function stripExistingSectionMarkSuffix(label: string): string {
		return label
			.replace(/\s*[·•|-]\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*marks?\s*$/iu, '')
			.replace(/\s*[·•|-]\s*\d+(?:\.\d+)?\s*marks?\s*$/iu, '')
			.trim();
	}

	function sectionLabelWithMarks(
		section: PaperSheetContentSection,
		review: PaperSheetReview | null | undefined
	): string {
		const baseLabel = stripExistingSectionMarkSuffix(section.label) || section.label;
		const reviewScore = sectionReviewScore(section, review);
		if (reviewScore) {
			return `${baseLabel} · ${reviewScore.got}/${reviewScore.total} ${formatMarkNoun(reviewScore.total)}`;
		}
		const total = sumQuestionMarks(section.questions);
		if (total <= 0) {
			return baseLabel;
		}
		return `${baseLabel} · ${total} ${formatMarkNoun(total)}`;
	}

	function buildRenderableSheetDocument(
		sheet: SheetDocument,
		review?: PaperSheetReview | null
	): SheetDocument {
		const title = stripQuestionPaperSuffix(sheet.title) || sheet.title;
		const subtitle = buildSubtitleWithUsefulMetadata(sheet, title);
		return {
			...applyPaperSheetSubjectTheme(sheet),
			title,
			subtitle,
			sections: sheet.sections.map((section) => {
				if (!isContentSection(section)) {
					return section;
				}
				return {
					...section,
					label: sectionLabelWithMarks(section, review)
				};
			})
		};
	}

	function applySheetPageState(next: SparkSheetPageState): void {
		run = next.run;
		if (next.draft) {
			draft = next.draft;
		}
		draftAnswers = next.draftAnswers;
		lastSavedDraftSignature = JSON.stringify(next.draftAnswers);
		draftSaveError = null;
		if (next.report) {
			report = next.report;
		}
		const nextReviewState = next.interaction?.reviewState ?? next.initialReviewState ?? null;
		if (nextReviewState) {
			reviewState = nextReviewState;
		}
		if (next.interaction?.id) {
			interactionSessionId = next.interaction.id;
		}
		if (next.interaction) {
			activeTurnQuestionId = next.interaction.activeTurnQuestionId;
		}
		if (next.run.status !== 'executing') {
			gradingDraft = false;
		}
	}

	async function refreshSheetArtifacts(): Promise<void> {
		if (artifactRefreshInFlight) {
			return;
		}
		artifactRefreshInFlight = true;
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, ARTIFACT_REFRESH_REQUEST_TIMEOUT_MS);
		try {
			const response = await window.fetch(`/api/spark/sheets/${run.id}/state`, {
				headers: {
					accept: 'application/json'
				},
				signal: controller.signal
			});
			if (!response.ok) {
				await invalidateAll();
				return;
			}
			const payload = SparkSheetPageStateSchema.parse(await response.json());
			applySheetPageState(payload);
			if (payload.draft === null && payload.report === null && payload.run.status === 'done') {
				await invalidateAll();
			}
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				console.warn('Failed to refresh sheet artifacts', error);
			}
			await invalidateAll();
		} finally {
			clearTimeout(timeout);
			artifactRefreshInFlight = false;
		}
	}

	function sameRunTotals(
		left: PageData['run']['totals'],
		right: PageData['run']['totals']
	): boolean {
		if (left === null || right === null) {
			return false;
		}
		return (
			left.awardedMarks === right.awardedMarks &&
			left.maxMarks === right.maxMarks &&
			left.percentage === right.percentage
		);
	}

	function sameRunDisplay(
		left: PageData['run']['display'],
		right: PageData['run']['display']
	): boolean {
		return (
			left.title === right.title &&
			left.subtitle === right.subtitle &&
			left.metaLine === right.metaLine &&
			left.summaryMarkdown === right.summaryMarkdown &&
			left.footer === right.footer
		);
	}

	function sameRunState(left: PageData['run'], right: PageData['run']): boolean {
		return (
			left.id === right.id &&
			left.workspaceId === right.workspaceId &&
			left.status === right.status &&
			left.sheetPhase === right.sheetPhase &&
			left.error === right.error &&
			left.createdAt === right.createdAt &&
			left.updatedAt === right.updatedAt &&
			sameRunDisplay(left.display, right.display) &&
			sameRunTotals(left.totals, right.totals)
		);
	}

	async function persistDraftAnswers(
		answers: PaperSheetAnswers,
		signature: string
	): Promise<boolean> {
		draftAnswers = answers;
		if (signature === lastSavedDraftSignature) {
			draftSaveError = null;
			return true;
		}
		savingDraft = true;
		draftSaveError = null;
		try {
			const response = await window.fetch(`/api/spark/sheets/${run.id}/draft`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ answers })
			});
			const payload = (await response.json().catch(() => null)) as {
				error?: string;
				issues?: Array<{ message?: string }>;
			} | null;
			if (!response.ok) {
				draftSaveError =
					payload?.issues?.[0]?.message ??
					payload?.error ??
					'Unable to save your worksheet answers.';
				return false;
			}
			lastSavedDraftSignature = signature;
			return true;
		} catch {
			draftSaveError = 'Unable to save your worksheet answers.';
			return false;
		} finally {
			savingDraft = false;
		}
	}

	function queueDraftSave(answers: PaperSheetAnswers): void {
		draftAnswers = answers;
		const signature = JSON.stringify(answers);
		if (draftSaveTimer) {
			clearTimeout(draftSaveTimer);
		}
		draftSaveTimer = setTimeout(() => {
			void persistDraftAnswers(answers, signature);
		}, 500);
	}

	async function submitSheetForGrading(answers: PaperSheetAnswers): Promise<boolean> {
		if (!draft) {
			return false;
		}
		if (draftSaveTimer) {
			clearTimeout(draftSaveTimer);
			draftSaveTimer = null;
		}
		const signature = JSON.stringify(answers);
		const saved = await persistDraftAnswers(answers, signature);
		if (!saved) {
			return false;
		}
		gradingDraft = true;
		requestError = null;
		try {
			const response = await window.fetch(`/api/spark/sheets/${run.id}/grade`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ answers })
			});
			const payload = (await response.json().catch(() => null)) as {
				error?: string;
				issues?: Array<{ message?: string }>;
			} | null;
			if (!response.ok) {
				requestError =
					payload?.issues?.[0]?.message ??
					payload?.error ??
					'Unable to start grading for this sheet.';
				gradingDraft = false;
				return false;
			}
			run = {
				...run,
				status: 'executing',
				sheetPhase: 'grading',
				error: null,
				updatedAt: new Date().toISOString()
			};
			return true;
		} catch {
			requestError = 'Unable to start grading for this sheet.';
			gradingDraft = false;
			return false;
		}
	}

	async function submitQuestionReply(
		questionId: string,
		draft: string,
		attachments: File[]
	): Promise<boolean> {
		if (submittingQuestionIds[questionId] || run.status !== 'done') {
			return false;
		}
		const pendingReply: PendingReply = {
			text: draft,
			attachments: attachments.map((file, index) => ({
				id:
					typeof crypto !== 'undefined' && 'randomUUID' in crypto
						? crypto.randomUUID()
						: `pending-${questionId}-${index.toString()}-${Date.now().toString()}`,
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				sizeBytes: file.size,
				...(file.type.startsWith('image/') ? { url: URL.createObjectURL(file) } : {})
			}))
		};
		submittingQuestionIds = {
			...submittingQuestionIds,
			[questionId]: true
		};
		pendingReplies = {
			...pendingReplies,
			[questionId]: pendingReply
		};
		activeTurnQuestionId = questionId;
		requestError = null;

		try {
			const formData = new FormData();
			formData.append('action', 'reply');
			formData.append('questionId', questionId);
			formData.append('text', draft);
			for (const attachment of attachments) {
				formData.append('file', attachment);
			}
			const response = await window.fetch(`/api/spark/sheets/${run.id}/turn`, {
				method: 'POST',
				body: formData
			});

			const payload = (await response.json().catch(() => null)) as
				| {
						error?: string;
						issues?: Array<{ message?: string }>;
						sessionId?: string;
						reviewState?: unknown;
				  }
				| null;
			if (!response.ok) {
				requestError =
					payload?.issues?.[0]?.message ?? payload?.error ?? 'Unable to send your worksheet reply.';
				cleanupPendingReply(pendingReply);
				pendingReplies = removeQuestionKey(pendingReplies, questionId);
				return false;
			} else {
				if (payload?.sessionId) {
					interactionSessionId = payload.sessionId;
				}
				if (payload?.reviewState) {
					const parsedReviewState = SparkTutorReviewStateSchema.safeParse(payload.reviewState);
					if (parsedReviewState.success) {
						reviewState = parsedReviewState.data;
						activeTurnQuestionId = null;
					}
				}
				return true;
			}
		} catch {
			requestError = 'Unable to send your worksheet reply.';
			cleanupPendingReply(pendingReply);
			pendingReplies = removeQuestionKey(pendingReplies, questionId);
			return false;
		} finally {
			submittingQuestionIds = removeQuestionKey(submittingQuestionIds, questionId);
		}
	}

	function openCloseGapResponse(questionId: string): void {
		if (activeResponseQuestionId && activeResponseQuestionId !== questionId) {
			responseDrafts = {
				...responseDrafts,
				[activeResponseQuestionId]: activeResponseDraft
			};
		}
		activeResponseQuestionId = questionId;
		activeResponseDraft = responseDrafts[questionId] ?? '';
	}

	function closeCloseGapResponse(): void {
		if (activeResponseQuestionId) {
			const trimmedDraft = activeResponseDraft.trim();
			responseDrafts =
				trimmedDraft.length > 0
					? {
							...responseDrafts,
							[activeResponseQuestionId]: activeResponseDraft
						}
					: removeQuestionKey(responseDrafts, activeResponseQuestionId);
		}
		activeResponseQuestionId = null;
		activeResponseDraft = '';
	}

	async function submitActiveResponse(value: string, files: File[]): Promise<boolean> {
		const questionId = activeResponseQuestionId;
		if (!questionId) {
			return false;
		}
		const sent = await submitQuestionReply(questionId, value, files);
		if (!sent) {
			return false;
		}
		activeResponseDraft = '';
		responseDrafts = removeQuestionKey(responseDrafts, questionId);
		return true;
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		try {
			const auth = getAuth(getFirebaseApp());
			if (auth.currentUser) {
				authReady = true;
			} else {
				const stopAuth = onIdTokenChanged(auth, (firebaseUser) => {
					if (!firebaseUser) {
						return;
					}
					authReady = true;
					stopAuth();
				});
			}
		} catch (error) {
			console.warn('Failed to initialize sheet auth guard', error);
		}
	});

	$effect(() => {
		if (sameRunState(lastSyncedDataRun, data.run)) {
			return;
		}
		lastSyncedDataRun = data.run;
		run = data.run;
	});

	$effect(() => {
		if (draft !== null) {
			return;
		}
		if (!data.draft) {
			return;
		}
		draft = data.draft;
		draftAnswers = data.draftAnswers;
		lastSavedDraftSignature = JSON.stringify(data.draftAnswers);
		draftSaveError = null;
	});

	$effect(() => {
		if (report !== null) {
			return;
		}
		if (!data.report) {
			return;
		}
		report = data.report;
	});

	$effect(() => {
		if (reviewState !== null) {
			return;
		}
		const nextReviewState = data.interaction?.reviewState ?? data.initialReviewState ?? null;
		if (nextReviewState) {
			reviewState = nextReviewState;
		}
	});

	$effect(() => {
		if (!interactionSessionId && data.interaction?.id) {
			interactionSessionId = data.interaction.id;
		}
		if (!activeTurnQuestionId && data.interaction?.activeTurnQuestionId) {
			activeTurnQuestionId = data.interaction.activeTurnQuestionId;
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		const shouldRefreshPendingArtifacts =
			report === null &&
			run.status !== 'failed' &&
			run.status !== 'stopped' &&
			(draft === null || run.sheetPhase === 'grading');
		if (!shouldRefreshPendingArtifacts) {
			artifactRefreshAttempts = 0;
			return;
		}
		if (artifactRefreshAttempts >= ARTIFACT_REFRESH_MAX_ATTEMPTS) {
			return;
		}
		const delayMs =
			artifactRefreshAttempts === 0
				? 0
				: Math.min(ARTIFACT_REFRESH_MAX_DELAY_MS, artifactRefreshAttempts * 500);
		const timer = setTimeout(() => {
			artifactRefreshAttempts += 1;
			void refreshSheetArtifacts();
		}, delayMs);
		return () => {
			clearTimeout(timer);
		};
	});

	$effect(() => {
		if (!browser || !sheetShellElement) {
			return;
		}
		report;
		reviewState;
		draft;
		draftAnswers;

		const root = sheetShellElement;
		const markLabels = reviewSheetDocument
			? collectQuestionMarkLabels(
					reviewSheetDocument,
					awaitingAnswersReport ? null : reviewState?.review,
					awaitingAnswersReport
				)
			: collectQuestionMarkLabels(draftSheetDocument, null, false);
		let frame: number | null = null;
		const refreshSheetEnhancements = () => {
			frame = null;
			eagerLoadSheetFigures(root);
			annotateSheetArtifacts(root);
			annotateQuestionMarkBadges(root, markLabels);
		};
		const scheduleSheetEnhancements = () => {
			if (frame !== null) {
				return;
			}
			frame = window.requestAnimationFrame(refreshSheetEnhancements);
		};
		scheduleSheetEnhancements();
		const observer = new MutationObserver(scheduleSheetEnhancements);
		observer.observe(root, {
			childList: true,
			subtree: true
		});
		return () => {
			if (frame !== null) {
				window.cancelAnimationFrame(frame);
			}
			observer.disconnect();
		};
	});

	$effect(() => {
		if (!browser || !authReady || !userId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const runRef = doc(db, 'spark', uid, 'graderRuns', run.id);
		return onSnapshot(
			runRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					return;
				}
				const parsed = SparkGraderRunSchema.safeParse({
					id: run.id,
					...snapshot.data()
				});
				if (!parsed.success) {
					return;
				}
				const nextSheetPhase = resolveSnapshotSheetPhase(
					parsed.data.status,
					parsed.data.sheetPhase
				);
				run = {
					...run,
					status: parsed.data.status,
					sheetPhase: nextSheetPhase,
					error: parsed.data.error ?? null,
					updatedAt: parsed.data.updatedAt.toISOString()
				};
				if (parsed.data.status !== 'executing') {
					gradingDraft = false;
				}
				const shouldReloadCompletedBuild =
					draft === null && report === null && parsed.data.status === 'done';
				const shouldReloadForReport =
					report === null && parsed.data.status === 'done' && nextSheetPhase === 'graded';
				if (shouldReloadCompletedBuild || shouldReloadForReport) {
					void refreshSheetArtifacts();
				}
			},
			(error) => {
				console.warn('Sheet run subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!browser || !authReady || !userId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const workspaceId = run.workspaceId;
		const stops: Unsubscribe[] = [];
		const subscribeWorkspaceFile = (
			filePath: string,
			apply: (raw: Record<string, unknown> | undefined) => void
		) => {
			const fileRef = doc(
				db,
				'users',
				uid,
				'workspace',
				workspaceId,
				'files',
				encodeWorkspaceFileId(filePath)
			);
			stops.push(
				onSnapshot(
					fileRef,
					(snapshot) => {
						apply(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined);
					},
					(error) => {
						console.warn(`Sheet artifact subscription failed (${filePath})`, error);
					}
				)
			);
		};
		subscribeWorkspaceFile(data.artifactPaths.draft, (raw) => {
			applyWorkspaceJson(
				data.artifactPaths.draft,
				raw,
				(value) => SparkSolveSheetDraftSchema.parse(value),
				(value) => {
					draft = value;
					if (run.sheetPhase === 'building') {
						run = {
							...run,
							sheetPhase: 'solving'
						};
					}
				}
			);
		});
		subscribeWorkspaceFile(data.artifactPaths.draftAnswers, (raw) => {
			applyWorkspaceJson(
				data.artifactPaths.draftAnswers,
				raw,
				(value) => SparkSolveSheetAnswersSchema.parse(value),
				(value: SparkSolveSheetAnswers) => {
					draftAnswers = value.answers;
					lastSavedDraftSignature = JSON.stringify(value.answers);
					draftSaveError = null;
				}
			);
		});
		subscribeWorkspaceFile(data.artifactPaths.report, (raw) => {
			applyWorkspaceJson(
				data.artifactPaths.report,
				raw,
				(value) => SparkGraderWorksheetReportSchema.parse(value),
				(_value) => {
					if (report === null) {
						void refreshSheetArtifacts();
					}
				}
			);
		});
		return () => {
			for (const stop of stops) {
				stop();
			}
		};
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !interactionSessionId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const sessionId = interactionSessionId;
		const sessionRef = doc(db, 'spark', uid, 'tutorSessions', sessionId);
		return onSnapshot(
			sessionRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					return;
				}
				const parsed = SparkTutorSessionSchema.safeParse({
					id: interactionSessionId,
					...snapshot.data()
				});
				if (!parsed.success) {
					return;
				}
				activeTurnQuestionId = parsed.data.activeTurnQuestionId ?? null;
				if (parsed.data.reviewState) {
					reviewState = parsed.data.reviewState;
				}
			},
			(error) => {
				console.warn('Sheet tutor session subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!reviewState || Object.keys(pendingReplies).length === 0) {
			return;
		}
		let nextPendingReplies = pendingReplies;
		let changed = false;
		for (const [questionId, pendingReply] of Object.entries(pendingReplies)) {
			const thread = reviewState.threads[questionId];
			const lastStudentMessage =
				thread?.messages.findLast((message) => message.author === 'student') ?? null;
			const lastMessageSignatures = (lastStudentMessage?.attachments ?? []).map(
				buildAttachmentSignature
			);
			const pendingSignatures = pendingReply.attachments.map(buildAttachmentSignature);
			if (
				lastStudentMessage?.markdown === pendingReply.text &&
				lastMessageSignatures.length === pendingSignatures.length &&
				lastMessageSignatures.every((signature, index) => signature === pendingSignatures[index])
			) {
				if (!changed) {
					nextPendingReplies = { ...pendingReplies };
					changed = true;
				}
				cleanupPendingReply(pendingReply);
				delete nextPendingReplies[questionId];
			}
		}
		if (changed) {
			pendingReplies = nextPendingReplies;
		}
	});

	const activeRuntimeQuestionId = $derived.by(() => {
		if (activeTurnQuestionId) {
			return activeTurnQuestionId;
		}
		if (reviewState) {
			for (const [questionId, thread] of Object.entries(reviewState.threads)) {
				if (thread.status === 'responding') {
					return questionId;
				}
			}
		}
		const firstPendingQuestionId = Object.keys(submittingQuestionIds)[0];
		return firstPendingQuestionId ?? null;
	});

	const feedbackThreads = $derived.by((): Record<string, PaperSheetFeedbackThread> => {
		const threads: Record<string, PaperSheetFeedbackThread> = {};
		if (!reviewState) {
			return threads;
		}
		for (const [questionId, thread] of Object.entries(reviewState.threads)) {
			const turns: PaperSheetFeedbackThread['turns'] = thread.messages.map((message) => ({
				id: message.id,
				speaker: message.author === 'assistant' ? ('tutor' as const) : ('student' as const),
				text: message.markdown,
				attachments: message.attachments?.map((attachment) => ({
					...attachment,
					...(attachment.filePath
						? { url: buildSheetAttachmentUrl(attachment.filePath, attachment.filename) }
						: {})
				}))
			}));
			const pendingReply = pendingReplies[questionId];
			const lastStudentTurn = turns.findLast((turn) => turn.speaker === 'student') ?? null;
			const lastTurnSignatures = (lastStudentTurn?.attachments ?? []).map(buildAttachmentSignature);
			const pendingSignatures = (pendingReply?.attachments ?? []).map(buildAttachmentSignature);
			const shouldAppendPendingTurn =
				pendingReply !== undefined &&
				(lastStudentTurn?.text !== pendingReply.text ||
					lastTurnSignatures.length !== pendingSignatures.length ||
					lastTurnSignatures.some((signature, index) => signature !== pendingSignatures[index]));
			const status: PaperSheetFeedbackThread['status'] = shouldAppendPendingTurn
				? 'responding'
				: thread.status;
			const nextTurns: PaperSheetFeedbackThread['turns'] = shouldAppendPendingTurn
				? [
						...turns,
						{
							id: `pending-${questionId}`,
							speaker: 'student',
							text: pendingReply.text,
							attachments: pendingReply.attachments
						}
					]
				: turns;
			threads[questionId] = {
				status,
				turns: nextTurns
			};
		}
		return threads;
	});

	const feedbackRuntimeStatuses = $derived.by((): Record<string, FeedbackRuntimeStatus> => {
		if (!activeRuntimeQuestionId) {
			return {};
		}

		const questionId = activeRuntimeQuestionId;
		const runtimeStatus: FeedbackRuntimeStatus | null =
			reviewState?.threads[questionId]?.status === 'responding' || submittingQuestionIds[questionId]
				? 'thinking'
				: null;

		if (!runtimeStatus) {
			return {};
		}

		return {
			[questionId]: runtimeStatus
		};
	});

	const feedbackThinking = $derived.by((): Record<string, string> => ({}));

	const feedbackAssistantDrafts = $derived.by((): Record<string, string> => ({}));

	const feedbackState = $derived.by((): SheetFeedbackStateMap => {
		const next: SheetFeedbackStateMap = {};

		for (const [questionId, sending] of Object.entries(submittingQuestionIds)) {
			if (sending) {
				next[questionId] = {
					...(next[questionId] ?? {}),
					sending: true
				};
			}
		}

		for (const [questionId, runtimeStatus] of Object.entries(feedbackRuntimeStatuses)) {
			next[questionId] = {
				...(next[questionId] ?? {}),
				runtimeStatus
			};
		}

		for (const [questionId, thinkingText] of Object.entries(feedbackThinking)) {
			next[questionId] = {
				...(next[questionId] ?? {}),
				thinkingText
			};
		}

		for (const [questionId, assistantDraftText] of Object.entries(feedbackAssistantDrafts)) {
			next[questionId] = {
				...(next[questionId] ?? {}),
				assistantDraftText
			};
		}

		return next;
	});

	const awaitingAnswersReport = $derived(report?.review.mode === 'awaiting_answers');
	const reviewSheetDocument = $derived.by(() =>
		reviewState
			? buildRenderableSheetDocument(
					reviewState.sheet,
					awaitingAnswersReport ? null : reviewState.review
				)
			: null
	);
	const activeResponseContext = $derived.by(() =>
		activeResponseQuestionId ? findCloseGapQuestionContext(activeResponseQuestionId) : null
	);
	const draftSheetDocument = $derived.by(() =>
		draft ? buildRenderableSheetDocument(draft.sheet) : null
	);
	const sheetFooterLabel = $derived(run.display.footer?.trim() || null);
	const sourceLinks = $derived(data.sourceLinks ?? []);
	const hasSourceChatLink = $derived(sourceLinks.some((sourceLink) => sourceLink.kind === 'chat'));
</script>

<svelte:head>
	<title>Spark · {run.display.title}</title>
</svelte:head>

<section class="sheet-page">
	{#if requestError}
		<p class="action-error" role="alert">{requestError}</p>
	{/if}
	{#if draftSaveError}
		<p class="action-error" role="alert">{draftSaveError}</p>
	{/if}
	{#if savingDraft && !draftSaveError}
		<p class="status-note">Saving answers…</p>
	{/if}

	{#if report && reviewState && reviewSheetDocument}
		<div bind:this={sheetShellElement} class="sheet-shell">
			<PaperSheet
				document={reviewSheetDocument}
				answers={reviewState.answers}
				review={awaitingAnswersReport ? null : reviewState.review}
				mode={awaitingAnswersReport ? 'readonly' : 'review'}
				allowReplies={!awaitingAnswersReport && run.status === 'done'}
				showCompletedFeedbackCards={false}
				footerLabel={sheetFooterLabel}
				feedbackThreads={awaitingAnswersReport ? {} : feedbackThreads}
				feedbackState={awaitingAnswersReport ? {} : feedbackState}
				onReply={(questionId, payload) => {
					return submitQuestionReply(questionId, payload.text, payload.attachments);
				}}
				onOpenResponse={openCloseGapResponse}
			/>
		</div>
	{:else if draft && draftSheetDocument}
		<div bind:this={sheetShellElement} class="sheet-shell">
			<PaperSheet
				document={draftSheetDocument}
				answers={draftAnswers}
				mode={canEditDraftSheet() ? 'interactive' : 'readonly'}
				grading={isDraftGradingInProgress()}
				footerLabel={sheetFooterLabel}
				gradeLabel={run.status === 'failed' || run.status === 'stopped' ? 'Grade Again' : 'Grade'}
				onAnswersChange={(answers) => {
					queueDraftSave(answers);
				}}
				onGrade={(answers) => {
					return submitSheetForGrading(answers);
				}}
			/>
		</div>
	{:else}
		<section class="pending-card">
			<h2>
				{run.status === 'failed'
					? run.sheetPhase === 'building'
						? 'This sheet failed to generate'
						: 'This sheet failed to grade'
					: run.status === 'stopped'
						? run.sheetPhase === 'building'
							? 'This sheet was stopped before generation finished'
							: 'This sheet was stopped before grading finished'
						: run.sheetPhase === 'building'
							? run.status === 'created'
								? 'This sheet is queued for generation'
								: 'This sheet is still being prepared'
							: run.status === 'created'
								? 'This sheet is queued for grading'
								: 'This sheet is still being graded'}
			</h2>
			<p>
				{run.error ??
					(run.sheetPhase === 'building'
						? run.status === 'created'
							? 'Spark has queued this worksheet and will publish the sheet once generation starts.'
							: 'The worksheet draft has not been published yet. This page will refresh once it is ready.'
						: run.status === 'created'
							? 'Spark has queued this worksheet for grading and will switch into feedback mode once the report is ready.'
							: 'The graded worksheet artifact has not been published yet. This page will refresh once grading finishes.')}
			</p>
		</section>
	{/if}

	{#if activeResponseContext}
		<CloseGapResponseModal
			questionLabel={activeResponseContext.questionLabel}
			questionPrompt={activeResponseContext.questionPrompt}
			studentAnswer={activeResponseContext.studentAnswer}
			reviewNote={activeResponseContext.reviewNote}
			gapBand={activeResponseContext.gapBand}
			messages={activeResponseContext.messages}
			bind:draft={activeResponseDraft}
			placeholder={activeResponseContext.replyPlaceholder}
			runtimeStatus={feedbackRuntimeStatuses[activeResponseContext.questionId] ?? null}
			thinkingText={feedbackThinking[activeResponseContext.questionId] ?? null}
			assistantDraftText={feedbackAssistantDrafts[activeResponseContext.questionId] ?? null}
			sending={submittingQuestionIds[activeResponseContext.questionId] ?? false}
			resolved={activeResponseContext.resolved}
			onClose={closeCloseGapResponse}
			onSubmit={submitActiveResponse}
		/>
	{/if}

	{#if sourceLinks.length > 0}
		<section class="sheet-source-card" aria-labelledby="sheet-source-card-title">
			<div class="sheet-source-card__heading">
				<p class="sheet-source-card__eyebrow">Original materials</p>
				<h2 id="sheet-source-card-title" class="sheet-source-card__title">Source documents</h2>
				<p class="sheet-source-card__description">
					{hasSourceChatLink
						? 'Open the source files and request chat used for this worksheet.'
						: 'Open the source files used for this worksheet.'}
				</p>
			</div>
			<nav class="sheet-source-links" aria-label="Source documents">
				{#each sourceLinks as sourceLink (sourceLink.href)}
					<a
						class={`sheet-source-link sheet-source-link--${sourceLink.kind}`}
						href={sourceLink.href}
						target="_blank"
						rel="noreferrer"
					>
						<span>{sourceLink.label}</span>
					</a>
				{/each}
			</nav>
		</section>
	{/if}
</section>

<style lang="postcss">
	.sheet-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(100%, 1024px);
		max-width: 1024px;
		margin: 0 auto;
	}

	.pending-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.pending-card p {
		margin: 0.75rem 0 0;
	}

	.action-error {
		margin: 0;
		color: var(--destructive);
		font-weight: 600;
	}

	.status-note {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		font-weight: 600;
	}

	.sheet-shell {
		overflow: auto;
		padding-bottom: 0.2rem;
	}

	:global([data-theme='dark'] .sheet-shell .paper-sheet__header),
	:global(:root:not([data-theme='light']) .sheet-shell .paper-sheet__header) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--sheet-color, #1f7a4d) 66%, #17142a) 0%,
			color-mix(in srgb, var(--sheet-color, #1f7a4d) 48%, #17142a) 100%
		);
	}

	:global([data-theme='dark'] .sheet-shell .paper-sheet__header-orb),
	:global(:root:not([data-theme='light']) .sheet-shell .paper-sheet__header-orb) {
		background: rgba(255, 255, 255, 0.045);
	}

	:global([data-theme='dark'] .sheet-shell .paper-sheet__header-orb--small),
	:global(:root:not([data-theme='light']) .sheet-shell .paper-sheet__header-orb--small) {
		background: rgba(255, 255, 255, 0.035);
	}

	.sheet-shell :global(.paper-sheet__section-id) {
		display: none;
	}

	.sheet-shell :global(.paper-sheet__eyebrow) {
		display: none;
	}

	.sheet-shell :global(.paper-sheet__section-marks) {
		display: none;
	}

	.sheet-shell :global(.paper-sheet__mcq-option-list),
	.sheet-shell :global(.composer-leading:has(.composer-attach)),
	.sheet-shell :global(.composer-attach) {
		display: none;
	}

	.sheet-shell :global(.paper-sheet__footer) {
		justify-content: flex-end;
	}

	.sheet-shell :global(.paper-sheet__footer > span:first-child) {
		display: none;
	}

	.sheet-shell :global(.paper-sheet__question.is-score-full) {
		border-bottom-color: color-mix(
			in srgb,
			var(--paper-review-correct-border, #22a66e) 35%,
			var(--paper-divider, #e0e0e0)
		);
	}

	.sheet-shell :global(.paper-sheet__question.is-score-partial) {
		border-bottom-color: color-mix(
			in srgb,
			var(--paper-review-teacher-border, #d6a11e) 35%,
			var(--paper-divider, #e0e0e0)
		);
	}

	.sheet-shell :global(.paper-sheet__question.is-score-zero) {
		border-bottom-color: color-mix(
			in srgb,
			var(--paper-review-incorrect-border, #c66317) 35%,
			var(--paper-divider, #e0e0e0)
		);
	}

	.sheet-shell :global(.paper-sheet__question-number.is-score-full) {
		background: var(--paper-review-correct-border, #22a66e);
		color: #fff;
	}

	.sheet-shell :global(.paper-sheet__question-number.is-score-partial) {
		background: var(--paper-review-teacher-border, #d6a11e);
		color: #1f1800;
	}

	.sheet-shell :global(.paper-sheet__question-number.is-score-zero) {
		background: var(--paper-review-incorrect-border, #c66317);
		color: #fff;
	}

	.sheet-shell :global(.paper-sheet__question-marks.is-score-full) {
		color: var(--paper-review-correct-text, #1a8c5b);
	}

	.sheet-shell :global(.paper-sheet__question-marks.is-score-partial) {
		color: var(--paper-review-teacher-text, #b07a00);
	}

	.sheet-shell :global(.paper-sheet__question-marks.is-score-zero) {
		color: var(--paper-review-incorrect-text, #c66317);
	}

	.sheet-shell :global(.paper-sheet-note.is-score-partial) {
		--note-bg: var(--paper-review-teacher-bg, #fff7ed);
		--note-left: var(--paper-review-teacher-border, #d6a11e);
		--note-badge-text: var(--paper-review-teacher-text, #b07a00);
		--note-dot: var(--paper-review-teacher-border, #d6a11e);
		--note-status-pending: var(--paper-review-teacher-text, #b07a00);
		--note-status-processing: var(--paper-review-teacher-text, #b07a00);
		--note-status-done: var(--paper-review-teacher-text, #b07a00);
	}

	.sheet-shell :global(.paper-sheet-note.is-score-zero) {
		--note-bg: var(--paper-review-incorrect-bg, #fbefe3);
		--note-left: var(--paper-review-incorrect-border, #c66317);
		--note-badge-text: var(--paper-review-incorrect-text, #c66317);
		--note-dot: var(--paper-review-incorrect-border, #c66317);
		--note-status-pending: var(--paper-review-incorrect-text, #c66317);
		--note-status-processing: var(--paper-review-incorrect-text, #c66317);
		--note-status-done: var(--paper-review-incorrect-text, #c66317);
	}

	.sheet-source-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.9rem;
		align-items: stretch;
		border: 1px solid color-mix(in srgb, var(--sheet-color, #1f7a4d) 16%, var(--border));
		border-radius: 1.25rem;
		background:
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--sheet-color, #1f7a4d) 4%, var(--card)),
				var(--card)
			),
			var(--card);
		box-shadow: 0 12px 28px color-mix(in srgb, var(--foreground) 6%, transparent);
		margin: 0 1rem 2rem;
		padding: 1.05rem 1.15rem 1.15rem;
	}

	.sheet-source-card__heading {
		min-width: 0;
	}

	.sheet-source-card__eyebrow {
		margin: 0 0 0.2rem;
		color: color-mix(in srgb, var(--sheet-color, #1f7a4d) 72%, var(--foreground));
		font-size: 0.74rem;
		font-weight: 820;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.sheet-source-card__title {
		margin: 0;
		color: var(--foreground);
		font-size: clamp(1.02rem, 2.1vw, 1.2rem);
		line-height: 1.15;
		text-transform: none;
	}

	.sheet-source-card__description {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 64%, transparent);
		font-size: 0.9rem;
		line-height: 1.35;
	}

	.sheet-source-links {
		align-items: center;
		align-self: end;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.92rem;
		font-weight: 680;
	}

	.sheet-source-link {
		border: 1px solid color-mix(in srgb, var(--sheet-color, #1f7a4d) 28%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--background) 90%, var(--sheet-color, #1f7a4d) 10%);
		color: color-mix(in srgb, var(--sheet-color, #1f7a4d) 72%, var(--foreground));
		padding: 0.35rem 0.75rem;
		text-decoration: none;
	}

	.sheet-source-link:hover,
	.sheet-source-link:focus-visible {
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}

	@media (min-width: 700px) {
		.sheet-source-card {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 1.25rem;
			align-items: end;
		}

		.sheet-source-links {
			justify-content: flex-end;
		}
	}

	@media (max-width: 520px) {
		.sheet-source-card {
			grid-template-columns: 1fr;
			margin-inline: 0.5rem;
		}

		.sheet-shell :global(.paper-sheet__header) {
			padding-right: 58px;
		}

		.sheet-shell :global(.paper-sheet__title) {
			font-size: clamp(24px, 7vw, 28px);
		}
	}

	.sheet-shell :global(.markdown-content a.markdown-figure-link::after) {
		content: none;
		display: none;
	}

	.sheet-shell :global(.markdown-content a.markdown-figure-link) {
		width: 100%;
		margin-block: 0.85rem 1.15rem;
	}

	.sheet-shell :global(.markdown-content a.markdown-figure-link[id]),
	.sheet-shell :global(.markdown-content [data-sheet-artifact-anchor]) {
		scroll-margin-top: 1.5rem;
	}

	.sheet-shell :global(.markdown-content .paper-sheet__artifact-reference) {
		color: color-mix(in srgb, var(--sheet-color, currentColor) 82%, var(--foreground));
		font-weight: 760;
		text-decoration: none;
		text-decoration-thickness: 0.08em;
		text-underline-offset: 0.18em;
	}

	.sheet-shell :global(.markdown-content .paper-sheet__artifact-reference:hover),
	.sheet-shell :global(.markdown-content .paper-sheet__artifact-reference:focus-visible) {
		text-decoration: underline;
	}

	.sheet-shell :global(.markdown-content .markdown-figure) {
		margin: 0;
		border-radius: 0.9rem;
		border-color: color-mix(in srgb, var(--sheet-border, currentColor) 70%, transparent);
		background: color-mix(in srgb, var(--sheet-light, transparent) 54%, var(--card));
	}

	.sheet-shell :global(.markdown-content .markdown-figure__image) {
		display: block;
		max-height: min(70vh, 760px);
		object-fit: contain;
	}

	.sheet-shell :global(.markdown-content .markdown-figure__caption) {
		margin-top: 0.55rem;
		font-weight: 650;
		color: color-mix(in srgb, var(--sheet-color, currentColor) 78%, var(--foreground));
	}

	.sheet-shell :global(.markdown-content p:has(+ table)),
	.sheet-shell :global(.markdown-content p:has(+ a.markdown-figure-link)) {
		margin-block: 1.15rem 0.35rem;
		font-weight: 720;
		color: color-mix(in srgb, var(--sheet-color, currentColor) 76%, var(--foreground));
	}

	.sheet-shell :global(.markdown-content table) {
		width: 100%;
		margin-block: 0.35rem 1.35rem;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--sheet-border, currentColor) 74%, transparent);
		border-collapse: separate;
		border-spacing: 0;
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--card) 90%, var(--sheet-light, transparent));
		box-shadow: 0 12px 30px -28px color-mix(in srgb, var(--sheet-color, #111827) 52%, transparent);
	}

	.sheet-shell :global(.markdown-content th) {
		background: color-mix(in srgb, var(--muted) 72%, var(--card));
		color: color-mix(in srgb, var(--sheet-color, currentColor) 72%, var(--foreground));
		font-weight: 760;
	}

	:global(:root:not([data-theme='light']) .sheet-shell .markdown-content table),
	:global([data-theme='dark'] .sheet-shell .markdown-content table),
	:global(.dark .sheet-shell .markdown-content table) {
		border-color: color-mix(in srgb, var(--foreground) 24%, transparent);
		background: color-mix(in srgb, var(--card) 84%, var(--background));
		box-shadow: none;
	}

	:global(:root:not([data-theme='light']) .sheet-shell .markdown-content th),
	:global([data-theme='dark'] .sheet-shell .markdown-content th),
	:global(.dark .sheet-shell .markdown-content th) {
		background: color-mix(in srgb, var(--foreground) 10%, var(--card));
		color: color-mix(in srgb, var(--foreground) 88%, var(--sheet-color, currentColor));
	}

	.sheet-shell :global(.markdown-content th),
	.sheet-shell :global(.markdown-content td) {
		border-bottom: 1px solid color-mix(in srgb, var(--sheet-border, currentColor) 56%, transparent);
		padding: 0.85rem 1rem;
		vertical-align: top;
	}

	.sheet-shell :global(.markdown-content tr:last-child th),
	.sheet-shell :global(.markdown-content tr:last-child td) {
		border-bottom: 0;
	}

	.sheet-shell :global(.paper-sheet__calc-row) {
		flex-wrap: wrap;
		align-items: baseline;
		row-gap: 0.4rem;
	}

	.sheet-shell :global(.paper-sheet__inline-input--compact) {
		width: auto;
		min-width: 100px;
		max-width: min(100%, 36rem);
		overflow: visible;
		text-overflow: clip;
		field-sizing: content;
	}

	.pending-card h2 {
		margin: 0;
	}

	@media (min-width: 1025px) {
		.sheet-page {
			padding-block: 1.25rem 2rem;
		}
	}
</style>
