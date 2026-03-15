export type PaperSheetHookSection = {
	type: 'hook';
	text: string;
};

export type PaperSheetInfoBox = {
	icon: string;
	title: string;
	text: string;
};

export type PaperSheetBlank = {
	placeholder?: string;
	minWidth?: number;
};

export type PaperSheetFillQuestion = {
	id: string;
	type: 'fill';
	marks: number;
	prompt: string;
	blanks: [PaperSheetBlank] | [PaperSheetBlank, PaperSheetBlank];
	after: string;
	conjunction?: string;
};

export type PaperSheetMcqQuestion = {
	id: string;
	type: 'mcq';
	marks: number;
	prompt: string;
	options: string[];
};

export type PaperSheetLinesQuestion = {
	id: string;
	type: 'lines';
	marks: number;
	prompt: string;
	lines: number;
};

export type PaperSheetCalcQuestion = {
	id: string;
	type: 'calc';
	marks: number;
	prompt: string;
	hint?: string;
	inputLabel: string;
	unit: string;
};

export type PaperSheetMatchQuestion = {
	id: string;
	type: 'match';
	marks: number;
	prompt: string;
	pairs: Array<{
		term: string;
		match: string;
	}>;
};

export type PaperSheetSpellingQuestion = {
	id: string;
	type: 'spelling';
	marks: number;
	prompt: string;
	words: Array<{
		wrong: string;
	}>;
};

export type PaperSheetQuestion =
	| PaperSheetFillQuestion
	| PaperSheetMcqQuestion
	| PaperSheetLinesQuestion
	| PaperSheetCalcQuestion
	| PaperSheetMatchQuestion
	| PaperSheetSpellingQuestion;

export type PaperSheetContentSection = {
	id: string;
	label: string;
	theory?: string;
	infoBox?: PaperSheetInfoBox;
	questions?: PaperSheetQuestion[];
};

export type PaperSheetSection = PaperSheetHookSection | PaperSheetContentSection;

export type PaperSheetData = {
	id: string;
	subject: string;
	level: string;
	title: string;
	subtitle: string;
	color: string;
	accent: string;
	light: string;
	border: string;
	sections: PaperSheetSection[];
};

export type PaperSheetAnswers = Record<string, string | Record<string, string>>;

export type PaperSheetScore = {
	got: number;
	total: number;
};

export type PaperSheetQuestionReviewStatus = 'correct' | 'incorrect' | 'teacher-review';

export type PaperSheetQuestionReview = {
	status: PaperSheetQuestionReviewStatus;
	label?: string;
	statusLabel?: string;
	note: string;
	replyPlaceholder?: string;
	followUp?: string;
};

export type PaperSheetMockReview = {
	score: PaperSheetScore;
	objectiveQuestionCount?: number;
	teacherReviewMarks?: number;
	teacherReviewQuestionCount?: number;
	label: string;
	message: string;
	note: string;
	questions: Record<string, PaperSheetQuestionReview>;
};
