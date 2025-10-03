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

export type QuizQuestion = QuizMultipleChoiceQuestion | QuizTypeAnswerQuestion;

export type QuizFeedbackTone = 'info' | 'success' | 'warning';

export type QuizFeedback = {
	message: string;
	tone?: QuizFeedbackTone;
	heading?: string;
};

export type QuizStepStatus = 'pending' | 'active' | 'correct' | 'incorrect' | 'skipped';

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
	questions: readonly QuizQuestion[];
};
