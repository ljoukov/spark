import type { SessionStatus, SparkGraderRunStatus } from '@spark/schemas';

type TaskCardPreviewBase = {
	title?: string;
	subtitle?: string | null;
	summary?: string | null;
	meta?: string | null;
	startedAt?: Date | null;
	liveStatusError?: boolean;
};

export type TaskCardLessonPreview = TaskCardPreviewBase & {
	kind: 'lesson';
	status: SessionStatus;
	progress?: {
		completed: number;
		total: number;
	} | null;
};

export type TaskCardGraderPreview = TaskCardPreviewBase & {
	kind: 'grader';
	status: SparkGraderRunStatus;
	totals?: {
		awardedMarks: number;
		maxMarks: number;
		problemCount: number;
		percentage: number;
	} | null;
};

export type TaskCardPreview = TaskCardLessonPreview | TaskCardGraderPreview;
