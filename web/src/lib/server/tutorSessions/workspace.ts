import path from 'node:path';

import {
	SparkGraderWorksheetReportSchema,
	SparkTutorComposerStateSchema,
	SparkTutorHistoryEntrySchema,
	SparkTutorReviewStateSchema,
	SparkTutorScreenStateSchema,
	type SparkGraderWorksheetReport,
	type PaperSheetQuestion,
	type SparkTutorComposerState,
	type SparkTutorHistoryEntry,
	type SparkTutorReviewState,
	type SparkTutorScreenState,
	type SparkTutorSession
} from '@spark/schemas';
import { buildWorkspaceFileDocPath, upsertWorkspaceTextFileDoc } from '@spark/llm';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { buildEmptyTutorReviewState, buildInitialTutorReviewState } from '$lib/server/tutorSessions/reviewState';
import { listWorksheetQuestionEntries } from '$lib/server/grader/problemReport';

export const TUTOR_CONTEXT_REPORT_PATH = 'context/report.json' as const;
export const TUTOR_CONTEXT_PROBLEM_PATH = 'context/problem.md' as const;
export const TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH = 'context/official-solution.md' as const;
export const TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH = 'context/student-transcript.md' as const;
export const TUTOR_CONTEXT_GRADING_PATH = 'context/grading.md' as const;
export const TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH = 'context/overall-feedback.md' as const;

export const TUTOR_UI_TOP_PANEL_PATH = 'ui/tutor.md' as const;
export const TUTOR_STATE_SESSION_PATH = 'state/session.json' as const;
export const TUTOR_STATE_COMPOSER_PATH = 'state/composer.json' as const;
export const TUTOR_STATE_REVIEW_PATH = 'state/review.json' as const;
export const TUTOR_HISTORY_TURNS_PATH = 'history/turns.jsonl' as const;
export const TUTOR_FEEDBACK_ROOT_DIR = 'feedback/questions' as const;

const EMPTY_REPORT: SparkGraderWorksheetReport = SparkGraderWorksheetReportSchema.parse({
	schemaVersion: 1,
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
	}
});

function stringifyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function formatTutorQuestionPrompt(question: PaperSheetQuestion): string {
	switch (question.type) {
		case 'answer_bank': {
			const parts: string[] = [];
			for (let index = 0; index < question.blanks.length; index += 1) {
				parts.push(question.segments[index] ?? '');
				parts.push('_____');
			}
			parts.push(question.segments[question.segments.length - 1] ?? '');
			const optionList = question.options
				.map((option) => `${option.label ? `(${option.label}) ` : ''}${option.text}`)
				.join(' | ');
			return `${parts.join('')}\n\nOptions: ${optionList}`;
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
		case 'lines':
		case 'calc':
		case 'match':
		case 'spelling':
		case 'flow':
			return question.prompt;
	}
}

export function buildTutorQuestionDirectoryPath(questionId: string): string {
	return `${TUTOR_FEEDBACK_ROOT_DIR}/${questionId}`;
}

export function buildTutorQuestionMetadataPath(questionId: string): string {
	return `${buildTutorQuestionDirectoryPath(questionId)}/question.json`;
}

export function buildTutorQuestionTurnsDirectoryPath(questionId: string): string {
	return `${buildTutorQuestionDirectoryPath(questionId)}/turns`;
}

export function buildTutorQuestionAttachmentsDirectoryPath(questionId: string): string {
	return `${buildTutorQuestionDirectoryPath(questionId)}/uploads`;
}

function formatTurnFileStamp(now: Date): string {
	return now.toISOString().replace(/[:.]/g, '-');
}

function sanitizeTutorAttachmentFilename(filename: string): string {
	const ext = path.extname(filename).toLowerCase();
	const base = path.basename(filename, ext);
	const normalizedBase = base
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	const normalizedExt = ext
		.replace(/[^a-z0-9.]+/g, '')
		.slice(0, 16);
	const safeBase = normalizedBase.length > 0 ? normalizedBase : 'upload';
	return `${safeBase}${normalizedExt}`;
}

export function buildTutorQuestionTurnPath(options: {
	questionId: string;
	author: 'assistant' | 'student';
	now: Date;
}): string {
	return `${buildTutorQuestionTurnsDirectoryPath(options.questionId)}/${formatTurnFileStamp(options.now)}-${options.author}.json`;
}

export function buildTutorQuestionAttachmentPath(options: {
	questionId: string;
	fileId: string;
	filename: string;
	now: Date;
	index: number;
}): string {
	const stamp = formatTurnFileStamp(options.now);
	const safeFilename = sanitizeTutorAttachmentFilename(options.filename);
	return `${buildTutorQuestionAttachmentsDirectoryPath(options.questionId)}/${stamp}-${options.index.toString()}-${options.fileId}-${safeFilename}`;
}

export function buildTutorComposerState(
	overrides: Partial<SparkTutorComposerState> = {}
): SparkTutorComposerState {
	return SparkTutorComposerStateSchema.parse({
		placeholder: 'Write your next thought here.',
		disabled: false,
		submitLabel: 'Send',
		allowConfidence: true,
		confidenceLabel: 'How sure are you?',
		hintButtons: [
			{
				id: 'nudge',
				label: 'Need a nudge',
				kind: 'hint',
				hintLevel: 'nudge'
			},
			{
				id: 'pointer',
				label: 'Need a pointer',
				kind: 'hint',
				hintLevel: 'pointer'
			}
		],
		...overrides
	});
}

export function buildTutorScreenState(options: {
	session: SparkTutorSession;
	focusLabel?: string | null;
}): SparkTutorScreenState {
	return SparkTutorScreenStateSchema.parse({
		status: options.session.status,
		title: options.session.title,
		...(options.focusLabel ? { focusLabel: options.focusLabel } : {}),
		updatedAt: options.session.updatedAt.toISOString()
	});
}

export function serializeTutorHistoryEntry(entry: SparkTutorHistoryEntry): string {
	return JSON.stringify(SparkTutorHistoryEntrySchema.parse(entry));
}

export function appendTutorHistoryEntry(
	existing: string | null,
	entry: SparkTutorHistoryEntry
): string {
	const trimmed = existing?.trimEnd() ?? '';
	const line = serializeTutorHistoryEntry(entry);
	return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
}

export async function writeTutorWorkspaceTextFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	filePath: string;
	content: string;
	now: Date;
}): Promise<void> {
	await upsertWorkspaceTextFileDoc({
		serviceAccountJson: options.serviceAccountJson,
		userId: options.userId,
		workspaceId: options.workspaceId,
		filePath: options.filePath,
		content: options.content,
		createdAt: options.now,
		updatedAt: options.now
	});
}

export async function seedTutorWorkspace(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	session: SparkTutorSession;
	report: SparkGraderWorksheetReport;
	now: Date;
}): Promise<void> {
	const initialScreenState = buildTutorScreenState({
		session: options.session
	});
	const initialComposerState = buildTutorComposerState({
		placeholder: 'Reply to the tutor on any open worksheet question.',
		disabled: options.session.status !== 'awaiting_student',
		allowConfidence: false,
		hintButtons: []
	});
	const initialReviewState = buildInitialTutorReviewState({
		report: options.report,
		now: options.now
	});
	const questionEntries = listWorksheetQuestionEntries(options.report.sheet);

	const references = options.report.references ?? {};

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_REPORT_PATH,
			content: stringifyJson(options.report),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_PROBLEM_PATH,
			content: (references.officialProblemMarkdown ?? references.problemMarkdown ?? '').trim(),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH,
			content: (references.officialSolutionMarkdown ?? '').trim(),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH,
			content: (references.studentTranscriptMarkdown ?? '').trim(),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_GRADING_PATH,
			content: (references.gradingMarkdown ?? '').trim(),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH,
			content: (references.overallFeedbackMarkdown ?? '').trim(),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_UI_TOP_PANEL_PATH,
			content: 'Worksheet tutor ready.\n',
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_STATE_SESSION_PATH,
			content: stringifyJson(initialScreenState),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_STATE_COMPOSER_PATH,
			content: stringifyJson(initialComposerState),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_STATE_REVIEW_PATH,
			content: stringifyJson(initialReviewState),
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_HISTORY_TURNS_PATH,
			content: '',
			now: options.now
		}),
		...questionEntries.map((entry) =>
			writeTutorWorkspaceTextFile({
				serviceAccountJson: options.serviceAccountJson,
				userId: options.userId,
				workspaceId: options.workspaceId,
				filePath: buildTutorQuestionMetadataPath(entry.question.id),
				content: stringifyJson({
					questionId: entry.question.id,
					questionNumber: entry.number,
					sectionId: entry.section.id,
					sectionLabel: entry.section.label,
					prompt: formatTutorQuestionPrompt(entry.question),
					initialStatus: initialReviewState.threads[entry.question.id]?.status ?? 'open',
					initialNote: initialReviewState.review.questions[entry.question.id]?.note ?? ''
				}),
				now: options.now
			})
		)
	]);
}

export async function readTutorWorkspaceTextFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	filePath: string;
}): Promise<string | null> {
	const snapshot = await getFirestoreDocument({
		serviceAccountJson: options.serviceAccountJson,
		documentPath: buildWorkspaceFileDocPath({
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: options.filePath
		})
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	const content = snapshot.data.content;
	return typeof content === 'string' ? content : null;
}

function parseJsonWithSchema<T>(raw: string | null, parse: (value: unknown) => T, fallback: T): T {
	if (!raw) {
		return fallback;
	}
	try {
		return parse(JSON.parse(raw));
	} catch {
		return fallback;
	}
}

export async function readTutorWorkspaceState(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	session: SparkTutorSession;
}): Promise<{
	tutorMarkdown: string;
	screenState: SparkTutorScreenState;
	composerState: SparkTutorComposerState;
	reviewState: SparkTutorReviewState;
	report: SparkGraderWorksheetReport;
}> {
	const [tutorMarkdown, sessionStateRaw, composerStateRaw, reviewStateRaw, reportRaw] =
		await Promise.all([
			readTutorWorkspaceTextFile({
				serviceAccountJson: options.serviceAccountJson,
				userId: options.userId,
				workspaceId: options.workspaceId,
				filePath: TUTOR_UI_TOP_PANEL_PATH
			}),
			readTutorWorkspaceTextFile({
				serviceAccountJson: options.serviceAccountJson,
				userId: options.userId,
				workspaceId: options.workspaceId,
				filePath: TUTOR_STATE_SESSION_PATH
			}),
			readTutorWorkspaceTextFile({
				serviceAccountJson: options.serviceAccountJson,
				userId: options.userId,
				workspaceId: options.workspaceId,
				filePath: TUTOR_STATE_COMPOSER_PATH
			}),
			readTutorWorkspaceTextFile({
				serviceAccountJson: options.serviceAccountJson,
				userId: options.userId,
				workspaceId: options.workspaceId,
				filePath: TUTOR_STATE_REVIEW_PATH
			}),
			readTutorWorkspaceTextFile({
				serviceAccountJson: options.serviceAccountJson,
				userId: options.userId,
				workspaceId: options.workspaceId,
				filePath: TUTOR_CONTEXT_REPORT_PATH
			})
		]);

	const report = parseJsonWithSchema(
		reportRaw,
		(value) => SparkGraderWorksheetReportSchema.parse(value),
		EMPTY_REPORT
	);

	return {
		tutorMarkdown: tutorMarkdown ?? 'Worksheet tutor ready.',
		screenState: parseJsonWithSchema(
			sessionStateRaw,
			(value) => SparkTutorScreenStateSchema.parse(value),
			buildTutorScreenState({ session: options.session })
		),
		composerState: parseJsonWithSchema(
			composerStateRaw,
			(value) => SparkTutorComposerStateSchema.parse(value),
			buildTutorComposerState()
		),
		reviewState: parseJsonWithSchema(
			reviewStateRaw,
			(value) => SparkTutorReviewStateSchema.parse(value),
			buildEmptyTutorReviewState(options.session.updatedAt)
		),
		report
	};
}
