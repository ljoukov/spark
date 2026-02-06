import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { renderMarkdownOptional } from '$lib/server/markdown';
import { resolveGradingPrompt, resolveMarkScheme } from '$lib/server/quiz/grading';
import {
	QuizDefinitionSchema,
	QuizInfoCardSchema,
	QuizMultipleChoiceSchema,
	QuizTypeAnswerSchema
} from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import type {
	QuizChoiceOption,
	QuizDefinition,
	QuizInfoCardQuestion,
	QuizMultipleChoiceQuestion,
	QuizQuestion,
	QuizTypeAnswerQuestion
} from '$lib/types/quiz';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required'),
	sessionId: z.string().trim().min(1, 'sessionId is required'),
	quizId: z.string().trim().min(1, 'quizId is required')
});

// Admin should be able to inspect legacy/partial quiz docs.
// Keep strict validation for the banner, but fall back to a lenient parser for rendering.
const LenientQuizTypeAnswerSchema = QuizTypeAnswerSchema.extend({
	marks: z.number().int().min(1).max(20).optional(),
	markScheme: z.string().trim().min(1).optional()
});

const LenientQuizQuestionSchema = z.discriminatedUnion('kind', [
	QuizMultipleChoiceSchema,
	LenientQuizTypeAnswerSchema,
	QuizInfoCardSchema
]);

const LenientQuizDefinitionSchema = QuizDefinitionSchema.extend({
	questions: z.array(LenientQuizQuestionSchema).min(1)
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

type QuizTypeAnswerView = QuizTypeAnswerQuestion & {
	markSchemeResolved: string;
	markSchemeWasDefault: boolean;
};

type QuizQuestionView = QuizMultipleChoiceQuestion | QuizInfoCardQuestion | QuizTypeAnswerView;

type QuizView = Omit<QuizDefinition, 'questions'> & {
	questions: QuizQuestionView[];
};

function withHtml(question: QuizQuestion): QuizQuestion {
	const promptHtml = renderMarkdownOptional(question.prompt);
	const hintHtml = renderMarkdownOptional(question.hint);

	const renderAnswer = (answer?: string) => {
		if (!answer) {
			return undefined;
		}
		const hasLatex = /\\[a-zA-Z]+/.test(answer);
		const hasDollar = answer.includes('$');
		const candidate = !hasDollar && hasLatex ? `$${answer}$` : answer;
		return renderMarkdownOptional(candidate);
	};

	const renderFeedback = (message: string) => renderMarkdownOptional(message);

	switch (question.kind) {
		case 'multiple-choice': {
			const options = question.options.map((option: QuizChoiceOption) => ({
				...option,
				textHtml: renderMarkdownOptional(option.text)
			}));
			const explanationHtml = renderMarkdownOptional(question.explanation);
			return {
				...question,
				promptHtml,
				hintHtml,
				explanationHtml,
				correctFeedback: {
					...question.correctFeedback,
					messageHtml: renderFeedback(question.correctFeedback.message)
				},
				options
			};
		}
		case 'type-answer': {
			return {
				...question,
				promptHtml,
				hintHtml,
				answerHtml: renderAnswer(question.answer),
				correctFeedback: {
					...question.correctFeedback,
					messageHtml: renderFeedback(question.correctFeedback.message)
				}
			};
		}
		case 'info-card': {
			return {
				...question,
				promptHtml,
				hintHtml,
				bodyHtml: renderMarkdownOptional(question.body)
			};
		}
	}
}

function withResolvedMarkScheme(question: QuizQuestion): QuizQuestionView {
	if (question.kind !== 'type-answer') {
		return question;
	}
	const storedMarkScheme = typeof question.markScheme === 'string' && question.markScheme.trim().length > 0;
	return {
		...question,
		markSchemeResolved: resolveMarkScheme(question.markScheme),
		markSchemeWasDefault: !storedMarkScheme
	};
}

function withHtmlQuiz(quiz: QuizDefinition): QuizView {
	const questions = quiz.questions.map((question) => withResolvedMarkScheme(withHtml(question)));
	return {
		...quiz,
		questions
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId, sessionId, quizId } = paramsSchema.parse(params);

	const snapshot = await getFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `spark/${userId}/sessions/${sessionId}/quiz/${quizId}`
	});

	if (!snapshot.exists || !snapshot.data) {
		return {
			quizDocFound: false,
			quizParseOk: false,
			quiz: null,
			parseIssues: [],
			gradingPromptResolved: null,
			gradingPromptWasDefault: false
		};
	}

	const payload = { id: quizId, ...(snapshot.data ?? {}) };
	const strictParsed = QuizDefinitionSchema.safeParse(payload);
	const quizParseOk = strictParsed.success;

	const parseIssues = strictParsed.success
		? []
		: strictParsed.error.issues.map((issue) => ({
				path: issue.path.join('.'),
				message: issue.message
			}));

	const parsed = strictParsed.success ? strictParsed : LenientQuizDefinitionSchema.safeParse(payload);
	if (!parsed.success) {
		return {
			quizDocFound: true,
			quizParseOk,
			quiz: null,
			parseIssues,
			gradingPromptResolved: null,
			gradingPromptWasDefault: false
		};
	}

	const quiz = parsed.data as QuizDefinition;
	const storedPrompt = typeof quiz.gradingPrompt === 'string' && quiz.gradingPrompt.trim().length > 0;

	return {
		quizDocFound: true,
		quizParseOk,
		quiz: withHtmlQuiz(quiz),
		parseIssues,
		gradingPromptResolved: resolveGradingPrompt(quiz.gradingPrompt),
		gradingPromptWasDefault: !storedPrompt
	};
};
