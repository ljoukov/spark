export type QuizFeedbackTone = 'info' | 'success' | 'warning';

export type QuizFeedback = {
	message: string;
	tone?: QuizFeedbackTone;
	heading?: string;
};

export type QuizQuestionBase = {
	id: string;
	prompt: string;
	hint?: string;
	explanation?: string;
	audioLabel?: string;
};

export type QuizChoiceOption = {
	id: string;
	label: string;
	text: string;
};

export type QuizQuestionWithFeedback = QuizQuestionBase & {
	correctFeedback: QuizFeedback;
};

export type QuizMultipleChoiceQuestion = QuizQuestionWithFeedback & {
	kind: 'multiple-choice';
	options: QuizChoiceOption[];
	correctOptionId: string;
};

export type QuizTypeAnswerQuestion = QuizQuestionWithFeedback & {
	kind: 'type-answer';
	answer: string;
	acceptableAnswers?: string[];
	placeholder?: string;
};

export type QuizInfoCardQuestion = QuizQuestionBase & {
	kind: 'info-card';
	body: string;
	continueLabel?: string;
	eyebrow?: string | null;
};

export type QuizQuestion =
	| QuizMultipleChoiceQuestion
	| QuizTypeAnswerQuestion
	| QuizInfoCardQuestion;

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
	progressKey?: string;
	questions: QuizQuestion[];
};
