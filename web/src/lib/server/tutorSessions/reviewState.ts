import { randomUUID } from 'node:crypto';

import {
	SparkTutorReviewMessageSchema,
	SparkTutorReviewStateSchema,
	SparkTutorReviewThreadSchema,
	type SparkTutorReviewMessage,
	type SparkTutorReviewState,
	type SparkTutorReviewThread
} from '@spark/schemas';

import type { GraderProblemReportSections } from '$lib/server/grader/problemReport';
import { parseMarkdownBlocks, parseMarkdownNumberedList } from '$lib/server/grader/problemReport';

const ACTIONABLE_REVIEW_PATTERNS = [
	/\b(need|needs|needed|must|should|missing|justify|justification|explain|show|clarify|prove|revise|fix|state|deduce|conclude|check)\b/i,
	/\b(not enough|incomplete|incorrect|wrong|error|mistake|gap|unclear|unsupported|unjustified|does not follow|doesn't follow|cannot conclude|can't conclude)\b/i,
	/\?/
];

const NON_ACTIONABLE_REVIEW_PATTERNS = [
	/\b(correct|valid|good|great|nice|fine|accurate|complete|sound|enough|acceptable|well done|full marks?|no issue|nothing further)\b/i,
	/\b(this works|that works|this is enough|that is enough|fully justified)\b/i
];

const WHOLE_PROBLEM_REVIEW_PATTERNS = [
	/\b(overall|throughout|whole solution|entire solution|presentation|structure|notation|final answer|conclusion)\b/i,
	/\b(need to tie|need to connect|missing conclusion|missing final statement)\b/i
];

function normalizeMarkdownSnippet(markdown: string): string {
	return markdown.replace(/\s+/g, ' ').trim();
}

function isLikelyActionableReviewMarkdown(markdown: string): boolean {
	const normalized = normalizeMarkdownSnippet(markdown);
	if (normalized.length === 0) {
		return false;
	}
	if (ACTIONABLE_REVIEW_PATTERNS.some((pattern) => pattern.test(normalized))) {
		return true;
	}
	if (NON_ACTIONABLE_REVIEW_PATTERNS.some((pattern) => pattern.test(normalized))) {
		return false;
	}
	return false;
}

function isLikelyWholeProblemReviewMarkdown(markdown: string): boolean {
	const normalized = normalizeMarkdownSnippet(markdown);
	return WHOLE_PROBLEM_REVIEW_PATTERNS.some((pattern) => pattern.test(normalized));
}

function createReviewMessage(options: {
	author: 'assistant' | 'student';
	markdown: string;
	createdAt: string;
}): SparkTutorReviewMessage {
	return SparkTutorReviewMessageSchema.parse({
		id: randomUUID(),
		author: options.author,
		markdown: options.markdown,
		createdAt: options.createdAt
	});
}

function createReviewThread(options: {
	id: string;
	label: string;
	anchor: SparkTutorReviewThread['anchor'];
	excerpt?: string;
	initialAssistantMarkdown: string;
	createdAt: string;
	status?: SparkTutorReviewThread['status'];
}): SparkTutorReviewThread {
	const status = options.status ?? 'open';
	return SparkTutorReviewThreadSchema.parse({
		id: options.id,
		label: options.label,
		status,
		anchor: options.anchor,
		...(options.excerpt ? { excerpt: options.excerpt } : {}),
		messages: [
			createReviewMessage({
				author: 'assistant',
				markdown: options.initialAssistantMarkdown,
				createdAt: options.createdAt
			})
		],
		...(status === 'resolved' ? { resolvedAt: options.createdAt } : {})
	});
}

function fallbackTranscriptLines(markdown: string | null): SparkTutorReviewState['transcriptLines'] {
	const trimmed = markdown?.trim();
	if (!trimmed) {
		return [];
	}
	return [
		{
			lineNumber: 1,
			markdown: trimmed
		}
	];
}

export function buildInitialTutorReviewState(options: {
	sections: GraderProblemReportSections;
	now: Date;
}): SparkTutorReviewState {
	const createdAt = options.now.toISOString();
	const transcriptItems = parseMarkdownNumberedList(options.sections.transcript);
	const transcriptLines =
		transcriptItems.length > 0
			? transcriptItems.map((item) => ({
					lineNumber: item.number,
					markdown: item.markdown
				}))
			: fallbackTranscriptLines(options.sections.transcript);

	const annotationItems = parseMarkdownNumberedList(options.sections.annotations);
	const annotationsByNumber = new Map(annotationItems.map((item) => [item.number, item.markdown]));

	const threads: SparkTutorReviewThread[] = [];
	let actionableLineThreads = 0;
	for (const line of transcriptLines) {
		const commentMarkdown = annotationsByNumber.get(line.lineNumber);
		if (!commentMarkdown) {
			continue;
		}
		const actionable = isLikelyActionableReviewMarkdown(commentMarkdown);
		if (actionable) {
			actionableLineThreads += 1;
		}
		threads.push(
			createReviewThread({
				id: `line-${line.lineNumber.toString()}`,
				label: `Line ${line.lineNumber.toString()}`,
				anchor: {
					kind: 'transcript_line',
					lineNumber: line.lineNumber
				},
				excerpt: normalizeMarkdownSnippet(line.markdown).slice(0, 180),
				initialAssistantMarkdown: commentMarkdown,
				createdAt,
				status: actionable ? 'open' : 'resolved'
			})
		);
	}

	const usedAnnotationNumbers = new Set(threads.flatMap((thread) => {
		if (thread.anchor.kind === 'transcript_line') {
			return [thread.anchor.lineNumber];
		}
		return [];
	}));

	for (const item of annotationItems) {
		if (usedAnnotationNumbers.has(item.number)) {
			continue;
		}
		const actionable = isLikelyActionableReviewMarkdown(item.markdown);
		threads.push(
			createReviewThread({
				id: `annotation-${item.number.toString()}`,
				label: `Transcript comment ${item.number.toString()}`,
				anchor: {
					kind: 'problem'
				},
				initialAssistantMarkdown: item.markdown,
				createdAt,
				status: actionable ? 'open' : 'resolved'
			})
		);
	}

	if (annotationItems.length === 0) {
		const annotationBlocks = parseMarkdownBlocks(options.sections.annotations);
		for (let index = 0; index < annotationBlocks.length; index += 1) {
			const block = annotationBlocks[index];
			if (!block) {
				continue;
			}
			const actionable = isLikelyActionableReviewMarkdown(block);
			threads.push(
				createReviewThread({
					id: `annotation-block-${(index + 1).toString()}`,
					label: `Transcript comment ${(index + 1).toString()}`,
					anchor: {
						kind: 'problem'
					},
					initialAssistantMarkdown: block,
					createdAt,
					status: actionable ? 'open' : 'resolved'
				})
			);
		}
	}

	const overallBlocks = parseMarkdownBlocks(options.sections.overall);
	for (let index = 0; index < overallBlocks.length; index += 1) {
		const block = overallBlocks[index];
		if (!block) {
			continue;
		}
		const actionable = isLikelyActionableReviewMarkdown(block);
		if (!actionable) {
			continue;
		}
		if (actionableLineThreads > 0 && !isLikelyWholeProblemReviewMarkdown(block)) {
			continue;
		}
		threads.push(
			createReviewThread({
				id: `problem-${(index + 1).toString()}`,
				label: `Problem comment ${(index + 1).toString()}`,
				anchor: {
					kind: 'problem'
				},
				initialAssistantMarkdown: block,
				createdAt
			})
		);
	}

	return SparkTutorReviewStateSchema.parse({
		transcriptLines,
		threads,
		updatedAt: createdAt
	});
}

export function buildEmptyTutorReviewState(now: Date): SparkTutorReviewState {
	return SparkTutorReviewStateSchema.parse({
		transcriptLines: [],
		threads: [],
		updatedAt: now.toISOString()
	});
}

export function parseTutorReviewState(raw: string | null, now: Date): SparkTutorReviewState {
	if (!raw) {
		return buildEmptyTutorReviewState(now);
	}
	try {
		return SparkTutorReviewStateSchema.parse(JSON.parse(raw));
	} catch {
		return buildEmptyTutorReviewState(now);
	}
}

export function appendTutorReviewMessage(options: {
	thread: SparkTutorReviewThread;
	author: 'assistant' | 'student';
	markdown: string;
	createdAt: string;
	status?: SparkTutorReviewThread['status'];
	resolvedAt?: string;
}): SparkTutorReviewThread {
	const nextStatus = options.status ?? options.thread.status;
	return SparkTutorReviewThreadSchema.parse({
		...options.thread,
		status: nextStatus,
		messages: [
			...options.thread.messages,
			createReviewMessage({
				author: options.author,
				markdown: options.markdown,
				createdAt: options.createdAt
			})
		],
		...(options.resolvedAt ? { resolvedAt: options.resolvedAt } : {}),
		...(nextStatus !== 'resolved' ? { resolvedAt: undefined } : {})
	});
}

export function updateTutorReviewThread(options: {
	reviewState: SparkTutorReviewState;
	thread: SparkTutorReviewThread;
	now: Date;
}): SparkTutorReviewState {
	return SparkTutorReviewStateSchema.parse({
		...options.reviewState,
		threads: options.reviewState.threads.map((entry) =>
			entry.id === options.thread.id ? options.thread : entry
		),
		updatedAt: options.now.toISOString()
	});
}

export function findTutorReviewThread(
	reviewState: SparkTutorReviewState,
	threadId: string
): SparkTutorReviewThread | null {
	return reviewState.threads.find((thread) => thread.id === threadId) ?? null;
}

export function summarizeTutorReviewState(reviewState: SparkTutorReviewState): {
	totalThreads: number;
	resolvedThreads: number;
	openThreads: number;
	respondingThreads: number;
	allResolved: boolean;
	nextThread: SparkTutorReviewThread | null;
} {
	let resolvedThreads = 0;
	let openThreads = 0;
	let respondingThreads = 0;
	let nextThread: SparkTutorReviewThread | null = null;

	for (const thread of reviewState.threads) {
		if (thread.status === 'resolved') {
			resolvedThreads += 1;
			continue;
		}
		if (!nextThread) {
			nextThread = thread;
		}
		if (thread.status === 'responding') {
			respondingThreads += 1;
			continue;
		}
		openThreads += 1;
	}

	return {
		totalThreads: reviewState.threads.length,
		resolvedThreads,
		openThreads,
		respondingThreads,
		allResolved: resolvedThreads === reviewState.threads.length,
		nextThread
	};
}

export function buildTutorReviewPreview(reviewState: SparkTutorReviewState): string {
	const summary = summarizeTutorReviewState(reviewState);
	if (summary.totalThreads === 0) {
		return 'No tutor review comments were generated for this problem.';
	}
	if (summary.allResolved) {
		return `All ${summary.totalThreads.toString()} comments resolved.`;
	}
	return `${summary.openThreads.toString()} open, ${summary.resolvedThreads.toString()} resolved.`;
}

export function buildTutorReviewFocusLabel(reviewState: SparkTutorReviewState): string | null {
	const summary = summarizeTutorReviewState(reviewState);
	if (summary.allResolved) {
		return 'Resolved';
	}
	const thread = summary.nextThread;
	if (!thread) {
		return null;
	}
	if (thread.anchor.kind === 'transcript_line') {
		return `Line ${thread.anchor.lineNumber.toString()}`;
	}
	return thread.label;
}
