import type { SessionStatus, SparkGraderRunStatus } from '@spark/schemas';

type AgentRunCardPreviewBase = {
	title?: string;
	subtitle?: string | null;
	summary?: string | null;
	meta?: string | null;
	liveStatusError?: boolean;
};

export type AgentRunCardLessonPreview = AgentRunCardPreviewBase & {
	kind: 'lesson';
	status: SessionStatus;
	progress?: {
		completed: number;
		total: number;
	} | null;
};

export type AgentRunCardGraderPreview = AgentRunCardPreviewBase & {
	kind: 'grader';
	status: SparkGraderRunStatus;
	totals?: {
		awardedMarks: number;
		maxMarks: number;
		problemCount: number;
		percentage: number;
	} | null;
};

export type AgentRunCardPreview = AgentRunCardLessonPreview | AgentRunCardGraderPreview;
