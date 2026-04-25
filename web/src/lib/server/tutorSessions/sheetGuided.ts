import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
	SparkTutorSessionSchema,
	SparkTutorGuidedStateSchema,
	type PaperSheetContentSection,
	type PaperSheetQuestion,
	type PaperSheetQuestionEntry,
	type SparkGraderWorksheetReport,
	type SparkTutorGuidedState,
	type SparkTutorReviewState
} from '@spark/schemas';

import {
	findWorksheetQuestionEntry,
	safeParseGraderWorksheetReport
} from '$lib/server/grader/problemReport';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { rewriteGraderWorksheetReportAssetTargets } from '$lib/server/grader/sheetAssets';
import {
	buildInitialTutorReviewState,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	summarizeTutorReviewState,
	syncTutorReviewStateWithReport
} from '$lib/server/tutorSessions/reviewState';
import {
	createTutorSession,
	findTutorSessionForSheet,
	patchTutorSession
} from '$lib/server/tutorSessions/repo';
import { stripStudentFormulaMarkupFromMap } from '$lib/spark/gaps/studentFormulaText';

export const sheetGuidedQuestionQuerySchema = z.object({
	questionId: z.string().trim().min(1)
});

type GraderRun = NonNullable<Awaited<ReturnType<typeof getGraderRun>>>;
type TutorSession = NonNullable<Awaited<ReturnType<typeof findTutorSessionForSheet>>>;

export type SheetGuidedContext = {
	userId: string;
	run: GraderRun;
	report: SparkGraderWorksheetReport;
	session: TutorSession | null;
	reviewState: SparkTutorReviewState;
	sessionId: string;
	sessionExists: boolean;
};

export type SheetGuidedQuestionContext = {
	questionId: string;
	questionLabel: string;
	sectionLabel: string;
	questionPrompt: string;
	studentAnswer: string;
	reviewNote: string;
	replyPlaceholder: string | null;
	followUp: string | null;
	modelAnswer: string | null;
	privateReferenceContext: string;
	marks: number;
	score: { got: number; total: number } | null;
	sheetTitle: string;
	subject: string;
	level: string;
};

function formatSegmentsWithBlanks(
	segments: readonly string[],
	blankCount: number,
	placeholder = '_____'
): string {
	const parts: string[] = [];
	for (let index = 0; index < blankCount; index += 1) {
		parts.push(segments[index] ?? '');
		parts.push(placeholder);
	}
	parts.push(segments[segments.length - 1] ?? '');
	return parts.join('');
}

function formatQuestionShape(question: PaperSheetQuestion): string {
	switch (question.type) {
		case 'answer_bank': {
			const options = question.options
				.map((option) => `${option.label ? `(${option.label}) ` : ''}${option.text}`)
				.join(' | ');
			return [
				formatSegmentsWithBlanks(question.segments, question.blanks.length),
				options ? `Options: ${options}` : null
			]
				.filter((part): part is string => part !== null && part.trim().length > 0)
				.join('\n\n');
		}
		case 'fill':
			return [
				question.prompt,
				...question.blanks.map((blank) => blank.placeholder ?? '_____'),
				question.after
			]
				.filter((part) => part.trim().length > 0)
				.join(question.conjunction ? ` ${question.conjunction} ` : ' ');
		case 'cloze':
			return [
				formatSegmentsWithBlanks(question.segments, question.blanks.length),
				question.wordBank && question.wordBank.length > 0
					? `Word bank: ${question.wordBank.join(' | ')}`
					: null
			]
				.filter((part): part is string => part !== null && part.trim().length > 0)
				.join('\n\n');
		case 'mcq':
			return [
				question.prompt,
				...question.options.map(
					(option) => `${option.label ? `(${option.label}) ` : ''}${option.text}`
				)
			]
				.filter((part) => part.trim().length > 0)
				.join('\n\n');
		case 'lines':
			return question.prompt;
		case 'calc':
			return [question.prompt, question.inputLabel ? `Answer: ${question.inputLabel}` : null]
				.filter((part): part is string => part !== null && part.trim().length > 0)
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
		case 'flow': {
			const boxesById = new Map(question.boxes.map((box) => [box.id, box]));
			const rows = question.rows
				.map((row) =>
					row.items
						.map((item) => {
							if (item.type === 'operation') {
								return item.label;
							}
							const box = boxesById.get(item.boxId);
							if (!box) {
								return '[blank]';
							}
							if (box.readonly === true && box.initialValue) {
								return box.initialValue;
							}
							return `[blank${box.placeholder ? `: ${box.placeholder}` : ''}]`;
						})
						.join(' -> ')
				)
				.join('\n');
			return [question.prompt, rows].filter((part) => part.trim().length > 0).join('\n\n');
		}
	}
}

function combineQuestionPrompts(parts: Array<string | null | undefined>): string {
	return parts
		.map((part) => part?.trim() ?? '')
		.filter((part) => part.length > 0)
		.join('\n\n');
}

function findQuestionPromptInEntries(options: {
	entries: readonly PaperSheetQuestionEntry[] | undefined;
	questionId: string;
	parentPrompt: string | null;
}): string | null {
	for (const entry of options.entries ?? []) {
		if (entry.type === 'group') {
			const result = findQuestionPromptInEntries({
				entries: entry.questions,
				questionId: options.questionId,
				parentPrompt: combineQuestionPrompts([options.parentPrompt, entry.prompt]) || null
			});
			if (result) {
				return result;
			}
			continue;
		}
		if (entry.id !== options.questionId) {
			continue;
		}
		return combineQuestionPrompts([options.parentPrompt, formatQuestionShape(entry)]);
	}
	return null;
}

function isContentSection(
	section: SparkGraderWorksheetReport['sheet']['sections'][number]
): section is PaperSheetContentSection {
	return 'id' in section;
}

function formatSelectedQuestionPrompt(
	report: SparkGraderWorksheetReport,
	questionId: string
): string {
	for (const section of report.sheet.sections) {
		if (!isContentSection(section)) {
			continue;
		}
		const prompt = findQuestionPromptInEntries({
			entries: section.questions,
			questionId,
			parentPrompt: null
		});
		if (prompt) {
			return prompt;
		}
	}
	return '(missing question text)';
}

function formatRecordedAnswer(report: SparkGraderWorksheetReport, questionId: string): string {
	const value = report.answers[questionId];
	if (typeof value === 'string') {
		return value.trim().length > 0 ? value : '(blank)';
	}
	if (!value) {
		return '(blank)';
	}
	return Object.entries(value)
		.map(([key, answer]) => `${key}: ${answer.trim().length > 0 ? answer : '(blank)'}`)
		.join('\n');
}

function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars).trimEnd()}\n...`;
}

function buildReferenceLabels(entry: ReturnType<typeof findWorksheetQuestionEntry>): string[] {
	if (!entry) {
		return [];
	}
	const labels = [
		entry.question.id,
		entry.number.toString(),
		`Question ${entry.number.toString()}`
	];
	if (entry.question.displayNumber) {
		labels.push(entry.question.displayNumber);
		labels.push(`Question ${entry.question.displayNumber}`);
	}
	return [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
}

function extractReferenceSnippet(options: {
	text: string | undefined;
	labels: readonly string[];
	maxChars: number;
}): string | null {
	const text = options.text?.trim();
	if (!text) {
		return null;
	}
	const labels = options.labels.map((label) => label.toLowerCase());
	const lines = text.split(/\r?\n/u);
	const matchIndex = lines.findIndex((line) => {
		const lower = line.toLowerCase();
		return labels.some((label) => lower.includes(label));
	});
	if (matchIndex === -1) {
		return null;
	}
	const start = Math.max(0, matchIndex - 6);
	const end = Math.min(lines.length, matchIndex + 24);
	return truncateText(lines.slice(start, end).join('\n').trim(), options.maxChars);
}

function buildPrivateReferenceContext(options: {
	report: SparkGraderWorksheetReport;
	entry: ReturnType<typeof findWorksheetQuestionEntry>;
}): string {
	const labels = buildReferenceLabels(options.entry);
	const questionReview = options.entry
		? options.report.review.questions[options.entry.question.id]
		: null;
	const parts: string[] = [];
	if (questionReview?.followUp?.trim()) {
		parts.push(`Question-specific grader note:\n${questionReview.followUp.trim()}`);
	}
	if (questionReview?.modelAnswer?.trim()) {
		parts.push(`Private model answer:\n${questionReview.modelAnswer.trim()}`);
	}
	const officialSolution = extractReferenceSnippet({
		text: options.report.references?.officialSolutionMarkdown,
		labels,
		maxChars: 2200
	});
	if (officialSolution) {
		parts.push(`Private official-solution excerpt:\n${officialSolution}`);
	}
	const grading = extractReferenceSnippet({
		text: options.report.references?.gradingMarkdown,
		labels,
		maxChars: 2200
	});
	if (grading) {
		parts.push(`Private grading excerpt:\n${grading}`);
	}
	return parts.length > 0
		? parts.join('\n\n')
		: 'No focused private answer reference was supplied. Use the visible problem, submitted answer, and review note.';
}

function buildSessionSource(options: {
	report: SparkGraderWorksheetReport;
	runId: string;
}): z.infer<typeof SparkTutorSessionSchema>['source'] {
	return {
		kind: 'sheet',
		runId: options.runId,
		sheetTitle: options.report.sheet.title,
		...(typeof options.report.review.score.got === 'number'
			? { awardedMarks: options.report.review.score.got }
			: {}),
		...(typeof options.report.review.score.total === 'number'
			? { maxMarks: options.report.review.score.total }
			: {})
	};
}

function normalizeGuidedState(state: SparkTutorGuidedState): SparkTutorGuidedState {
	return SparkTutorGuidedStateSchema.parse({
		...state,
		answers: state.answers ?? {},
		writtenAnswer: state.writtenAnswer ?? '',
		fieldResults: state.fieldResults ?? {},
		lastChecked: state.lastChecked ?? {},
		fieldAttempts: state.fieldAttempts ?? {}
	});
}

export async function loadSheetGuidedContext(options: {
	userId: string;
	sheetId: string;
}): Promise<SheetGuidedContext | null> {
	const run = await getGraderRun(options.userId, options.sheetId);
	if (!run) {
		return null;
	}

	const reportPath = run.sheet?.filePath ?? run.sheetPath;
	const reportRaw = await getWorkspaceTextFile(options.userId, run.workspaceId, reportPath);
	if (!reportRaw) {
		throw new Error('sheet_not_ready');
	}
	const parsedReport = safeParseGraderWorksheetReport(reportRaw);
	if (!parsedReport) {
		throw new Error('sheet_invalid');
	}
	const report = rewriteGraderWorksheetReportAssetTargets({
		sheetId: run.id,
		report: parsedReport
	});
	const session = await findTutorSessionForSheet({
		userId: options.userId,
		runId: run.id
	});
	const now = new Date();
	const reviewState = session?.reviewState
		? syncTutorReviewStateWithReport({
				reviewState: session.reviewState,
				report,
				now
			})
		: buildInitialTutorReviewState({
				report,
				now
			});

	return {
		userId: options.userId,
		run,
		report,
		session,
		reviewState,
		sessionId: session?.id ?? randomUUID(),
		sessionExists: session !== null
	};
}

export function buildSheetGuidedQuestionContext(options: {
	report: SparkGraderWorksheetReport;
	questionId: string;
}): SheetGuidedQuestionContext | null {
	const entry = findWorksheetQuestionEntry(options.report.sheet, options.questionId);
	if (!entry) {
		return null;
	}
	const review = options.report.review.questions[options.questionId];
	if (!review) {
		return null;
	}
	const displayNumber = entry.question.displayNumber ?? entry.number.toString();
	const score = review.score ?? null;
	return {
		questionId: options.questionId,
		questionLabel: `Question ${displayNumber}`,
		sectionLabel: entry.section.label,
		questionPrompt: formatSelectedQuestionPrompt(options.report, options.questionId),
		studentAnswer: formatRecordedAnswer(options.report, options.questionId),
		reviewNote: review.note,
		replyPlaceholder: review.replyPlaceholder ?? null,
		followUp: review.followUp ?? null,
		modelAnswer: review.modelAnswer ?? null,
		privateReferenceContext: buildPrivateReferenceContext({
			report: options.report,
			entry
		}),
		marks: Math.max(1, Math.round(score?.total ?? entry.question.marks)),
		score,
		sheetTitle: options.report.sheet.title,
		subject: options.report.sheet.subject,
		level: options.report.sheet.level
	};
}

export function mergeGuidedState(options: {
	current: SparkTutorGuidedState | undefined;
	prefillAnswers?: Record<string, string>;
	next?: SparkTutorGuidedState;
	now: Date;
}): SparkTutorGuidedState {
	const current = options.current ?? {};
	const next = options.next ?? {};
	const answers = {
		...stripStudentFormulaMarkupFromMap(options.prefillAnswers),
		...stripStudentFormulaMarkupFromMap(current.answers),
		...stripStudentFormulaMarkupFromMap(next.answers)
	};
	const lastChecked = {
		...stripStudentFormulaMarkupFromMap(current.lastChecked),
		...stripStudentFormulaMarkupFromMap(next.lastChecked)
	};
	return normalizeGuidedState({
		...current,
		...next,
		answers,
		lastChecked,
		updatedAt: options.now.toISOString()
	});
}

export async function persistSheetGuidedReviewState(options: {
	context: SheetGuidedContext;
	reviewState: SparkTutorReviewState;
	status?: z.infer<typeof SparkTutorSessionSchema>['status'];
	now: Date;
}): Promise<void> {
	const summary = summarizeTutorReviewState(options.reviewState);
	const focusLabel = buildTutorReviewFocusLabel(options.reviewState);
	const status =
		options.status ??
		(summary.allResolved ? ('completed' as const) : ('awaiting_student' as const));
	const updates: Record<string, unknown> = {
		status,
		updatedAt: options.now,
		preview: buildTutorReviewPreview(options.reviewState),
		reviewState: options.reviewState
	};
	if (focusLabel) {
		updates.focusLabel = focusLabel;
	}
	if (status === 'completed' || summary.allResolved) {
		updates.completedAt = options.now;
	}

	if (!options.context.sessionExists) {
		await createTutorSession(
			options.context.userId,
			SparkTutorSessionSchema.parse({
				id: options.context.sessionId,
				workspaceId: `close-gap-${options.context.sessionId}`,
				status,
				source: buildSessionSource({
					report: options.context.report,
					runId: options.context.run.id
				}),
				title: `${options.context.report.sheet.title} feedback`,
				...updates,
				createdAt: options.now
			})
		);
		return;
	}

	const deletes = ['activeTurnAgentId', 'activeTurnQuestionId'];
	if (!focusLabel) {
		deletes.push('focusLabel');
	}
	if (status !== 'completed' && !summary.allResolved) {
		deletes.push('completedAt');
	}
	await patchTutorSession(options.context.userId, options.context.sessionId, updates, deletes);
}
