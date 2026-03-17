import type {
	PaperSheetAnswers as SharedPaperSheetAnswers,
	PaperSheetBlank,
	PaperSheetCalcQuestion,
	PaperSheetContentSection as SharedPaperSheetContentSection,
	PaperSheetData as SharedPaperSheetData,
	PaperSheetFeedbackThread,
	PaperSheetFeedbackTurn,
	PaperSheetFillQuestion,
	PaperSheetHookSection,
	PaperSheetInfoBox,
	PaperSheetLinesQuestion,
	PaperSheetMatchQuestion,
	PaperSheetMcqQuestion,
	PaperSheetQuestionReview,
	PaperSheetQuestionReviewStatus,
	PaperSheetReview,
	PaperSheetScore,
	PaperSheetSpellingQuestion
} from '@spark/schemas';

export type { PaperSheetBlank, PaperSheetCalcQuestion, PaperSheetFeedbackThread, PaperSheetFeedbackTurn, PaperSheetFillQuestion, PaperSheetHookSection, PaperSheetInfoBox, PaperSheetLinesQuestion, PaperSheetMatchQuestion, PaperSheetMcqQuestion, PaperSheetQuestionReview, PaperSheetQuestionReviewStatus, PaperSheetReview, PaperSheetScore, PaperSheetSpellingQuestion };

export type PaperSheetAnswers = SharedPaperSheetAnswers;
export type PaperSheetMockReview = PaperSheetReview;

export type PaperSheetQuestion =
	| PaperSheetFillQuestion
	| PaperSheetMcqQuestion
	| PaperSheetLinesQuestion
	| PaperSheetCalcQuestion
	| PaperSheetMatchQuestion
	| PaperSheetSpellingQuestion;

export type PaperSheetContentSection = Omit<SharedPaperSheetContentSection, 'questions'> & {
	questions?: PaperSheetQuestion[];
};

export type PaperSheetSection = PaperSheetHookSection | PaperSheetContentSection;

export type PaperSheetData = Omit<SharedPaperSheetData, 'sections'> & {
	sections: PaperSheetSection[];
	initialAnswers?: PaperSheetAnswers;
	mockReview?: PaperSheetMockReview;
};
