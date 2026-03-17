import { randomUUID } from 'node:crypto';

import {
	SparkTutorReviewMessageSchema,
	SparkTutorReviewStateSchema,
	SparkTutorReviewThreadSchema,
	type SparkGraderWorksheetReport,
	type SparkTutorReviewMessage,
	type SparkTutorReviewState,
	type SparkTutorReviewThread
} from '@spark/schemas';

import { listWorksheetQuestionEntries } from '$lib/server/grader/problemReport';

const EMPTY_SHEET_STATE: SparkTutorReviewState = SparkTutorReviewStateSchema.parse({
	sheet: {
		id: 'empty-sheet',
		subject: 'Unknown',
		level: 'Unknown',
		title: 'Tutor sheet',
		subtitle: 'Worksheet data unavailable.',
		color: '#36587a',
		accent: '#4d7aa5',
		light: '#e8f2fb',
		border: '#bfd0e0',
		sections: [
			{
				type: 'hook',
				text: 'Worksheet data unavailable.'
			}
		]
	},
	answers: {},
	review: {
		score: {
			got: 0,
			total: 0
		},
		label: 'Worksheet unavailable',
		message: 'No worksheet review data is available for this tutor session.',
		note: 'Tutor review could not be loaded.',
		questions: {}
	},
	threads: {},
	updatedAt: new Date(0).toISOString()
});

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
	questionId: string;
	status: SparkTutorReviewThread['status'];
	createdAt: string;
}): SparkTutorReviewThread {
	return SparkTutorReviewThreadSchema.parse({
		questionId: options.questionId,
		status: options.status,
		messages: [],
		...(options.status === 'resolved' ? { resolvedAt: options.createdAt } : {})
	});
}

export function buildInitialTutorReviewState(options: {
	report: SparkGraderWorksheetReport;
	now: Date;
}): SparkTutorReviewState {
	const createdAt = options.now.toISOString();
	const threads: Record<string, SparkTutorReviewThread> = {};

	for (const entry of listWorksheetQuestionEntries(options.report.sheet)) {
		const review = options.report.review.questions[entry.question.id];
		const status = review?.status === 'correct' ? 'resolved' : 'open';
		threads[entry.question.id] = createReviewThread({
			questionId: entry.question.id,
			status,
			createdAt
		});
	}

	return SparkTutorReviewStateSchema.parse({
		sheet: options.report.sheet,
		answers: options.report.answers,
		review: options.report.review,
		threads,
		updatedAt: createdAt
	});
}

export function buildEmptyTutorReviewState(now: Date): SparkTutorReviewState {
	return SparkTutorReviewStateSchema.parse({
		...EMPTY_SHEET_STATE,
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
		threads: {
			...options.reviewState.threads,
			[options.thread.questionId]: options.thread
		},
		updatedAt: options.now.toISOString()
	});
}

export function findTutorReviewThread(
	reviewState: SparkTutorReviewState,
	questionId: string
): SparkTutorReviewThread | null {
	return reviewState.threads[questionId] ?? null;
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

	for (const entry of listWorksheetQuestionEntries(reviewState.sheet)) {
		const thread = reviewState.threads[entry.question.id];
		if (!thread) {
			continue;
		}
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

	const totalThreads = Object.keys(reviewState.threads).length;
	return {
		totalThreads,
		resolvedThreads,
		openThreads,
		respondingThreads,
		allResolved: totalThreads === 0 || resolvedThreads === totalThreads,
		nextThread
	};
}

export function buildTutorReviewPreview(reviewState: SparkTutorReviewState): string {
	const summary = summarizeTutorReviewState(reviewState);
	if (summary.totalThreads === 0) {
		return 'No worksheet tutor comments were generated for this problem.';
	}
	if (summary.allResolved) {
		return `All ${summary.totalThreads.toString()} worksheet comments resolved.`;
	}
	if (summary.openThreads === 1) {
		return '1 worksheet question still needs revision.';
	}
	return `${summary.openThreads.toString()} worksheet questions still need revision.`;
}

export function buildTutorReviewFocusLabel(reviewState: SparkTutorReviewState): string | null {
	const summary = summarizeTutorReviewState(reviewState);
	if (summary.allResolved) {
		return 'Resolved';
	}
	if (!summary.nextThread) {
		return null;
	}
	const nextEntry = listWorksheetQuestionEntries(reviewState.sheet).find(
		(entry) => entry.question.id === summary.nextThread?.questionId
	);
	if (!nextEntry) {
		return null;
	}
	return `Question ${nextEntry.number.toString()}`;
}
