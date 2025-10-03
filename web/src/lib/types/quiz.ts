import type { SessionStepId } from '$lib/progress/session';

export type QuizQuestionBase = {
        id: string;
        prompt: string;
        hint?: string;
        explanation?: string;
        audioLabel?: string;
        progressLabel?: string;
};

export type QuizChoiceOption = {
	id: string;
	label: string;
	text: string;
};

export type QuizMultipleChoiceQuestion = QuizQuestionBase & {
	kind: 'multiple-choice';
	options: readonly QuizChoiceOption[];
	correctOptionId: string;
};

export type QuizTypeAnswerQuestion = QuizQuestionBase & {
	kind: 'type-answer';
	answer: string;
	acceptableAnswers?: readonly string[];
	placeholder?: string;
};

export type QuizInfoCardQuestion = QuizQuestionBase & {
        kind: 'info-card';
        body: string | readonly string[];
        actionLabel?: string;
};

export type QuizQuestion =
        | QuizMultipleChoiceQuestion
        | QuizTypeAnswerQuestion
        | QuizInfoCardQuestion;

export type QuizFeedbackTone = 'info' | 'success' | 'warning';

export type QuizFeedback = {
	message: string;
	tone?: QuizFeedbackTone;
	heading?: string;
};

// Adds 'seen' to represent a question the user opened but hasn't answered yet.
export type QuizStepStatus = 'pending' | 'active' | 'seen' | 'correct' | 'incorrect' | 'skipped';

export type QuizProgressStep = {
	status: QuizStepStatus;
	label?: string;
};

export type QuizDefinition = {
        id: string;
        title: string;
        description?: string;
        topic?: string;
        estimatedMinutes?: number;
        stepId?: SessionStepId;
        completionCtaLabel?: string;
        questions: readonly QuizQuestion[];
};
