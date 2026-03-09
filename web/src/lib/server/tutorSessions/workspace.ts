import {
	SparkTutorComposerStateSchema,
	SparkTutorHistoryEntrySchema,
	SparkTutorReviewStateSchema,
	SparkTutorScreenStateSchema,
	type SparkTutorComposerState,
	type SparkTutorHistoryEntry,
	type SparkTutorReviewState,
	type SparkTutorScreenState,
	type SparkTutorSession
} from '@spark/schemas';
import { buildWorkspaceFileDocPath, upsertWorkspaceTextFileDoc } from '@spark/llm';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import type { GraderProblemReportSections } from '$lib/server/grader/problemReport';
import {
	buildEmptyTutorReviewState,
	buildInitialTutorReviewState,
} from '$lib/server/tutorSessions/reviewState';

export const TUTOR_CONTEXT_PROBLEM_PATH = 'context/problem.md' as const;
export const TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH = 'context/official-solution.md' as const;
export const TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH = 'context/student-transcript.md' as const;
export const TUTOR_CONTEXT_GRADING_PATH = 'context/grading.md' as const;
export const TUTOR_CONTEXT_ANNOTATIONS_PATH = 'context/annotations.md' as const;
export const TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH = 'context/overall-feedback.md' as const;

export const TUTOR_UI_TOP_PANEL_PATH = 'ui/tutor.md' as const;
export const TUTOR_STATE_SESSION_PATH = 'state/session.json' as const;
export const TUTOR_STATE_COMPOSER_PATH = 'state/composer.json' as const;
export const TUTOR_STATE_REVIEW_PATH = 'state/review.json' as const;
export const TUTOR_HISTORY_TURNS_PATH = 'history/turns.jsonl' as const;

function stringifyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
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
	sections: GraderProblemReportSections;
	now: Date;
}): Promise<void> {
	const problemContent =
		options.sections.officialStatement ??
		options.sections.statement ??
		'Problem statement unavailable.';
	const officialSolutionContent =
		options.sections.officialSolution ?? 'Official solution unavailable.';
	const transcriptContent = options.sections.transcript ?? 'Student transcript unavailable.';
	const gradingContent = options.sections.grading ?? 'Grading unavailable.';
	const annotationsContent = options.sections.annotations ?? 'Line-by-line annotation unavailable.';
	const overallContent = options.sections.overall ?? 'Overall feedback unavailable.';

	const initialScreenState = buildTutorScreenState({
		session: options.session
	});
	const initialComposerState = buildTutorComposerState({
		placeholder: 'Reply to a comment thread.',
		disabled: options.session.status !== 'awaiting_student',
		allowConfidence: false,
		hintButtons: []
	});
	const initialReviewState = buildInitialTutorReviewState({
		sections: options.sections,
		now: options.now
	});

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_PROBLEM_PATH,
			content: problemContent,
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH,
			content: officialSolutionContent,
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH,
			content: transcriptContent,
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_GRADING_PATH,
			content: gradingContent,
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_ANNOTATIONS_PATH,
			content: annotationsContent,
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH,
			content: overallContent,
			now: options.now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_UI_TOP_PANEL_PATH,
			content: 'Reply on each review thread until every comment is resolved.\n',
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
		})
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
	context: {
		problem: string;
		officialSolution: string;
		transcript: string;
		grading: string;
		annotations: string;
		overallFeedback: string;
	};
}> {
	const [
		tutorMarkdown,
		sessionStateRaw,
		composerStateRaw,
		reviewStateRaw,
		problem,
		officialSolution,
		transcript,
		grading,
		annotations,
		overallFeedback
	] = await Promise.all([
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
			filePath: TUTOR_CONTEXT_PROBLEM_PATH
		}),
		readTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH
		}),
		readTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH
		}),
		readTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_GRADING_PATH
		}),
		readTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_ANNOTATIONS_PATH
		}),
		readTutorWorkspaceTextFile({
			serviceAccountJson: options.serviceAccountJson,
			userId: options.userId,
			workspaceId: options.workspaceId,
			filePath: TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH
		})
	]);

	return {
		tutorMarkdown: tutorMarkdown ?? 'Preparing your tutor session...',
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
		context: {
			problem: problem ?? '',
			officialSolution: officialSolution ?? '',
			transcript: transcript ?? '',
			grading: grading ?? '',
			annotations: annotations ?? '',
			overallFeedback: overallFeedback ?? ''
		}
	};
}
