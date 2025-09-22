import { z } from 'zod';

export interface InlineSourceFile {
	readonly displayName: string;
	readonly mimeType: string;
	readonly data: string;
}

export const QUIZ_MODES = ['extraction', 'synthesis', 'extension'] as const;

export const QUESTION_TYPES = ['multiple_choice', 'short_answer', 'true_false', 'numeric'] as const;

export const CANONICAL_DIFFICULTY = ['foundation', 'intermediate', 'higher'] as const;
const DIFFICULTY_ALIASES = ['easy', 'medium', 'hard'] as const;
const DIFFICULTY_NORMALISER = z
	.enum([...CANONICAL_DIFFICULTY, ...DIFFICULTY_ALIASES] as const)
	.transform((value) => {
		switch (value) {
			case 'easy':
				return 'foundation';
			case 'medium':
				return 'intermediate';
			case 'hard':
				return 'higher';
			default:
				return value;
		}
	});

export const QuizQuestionSchema = z
	.object({
		id: z.string().min(1, 'id is required'),
		prompt: z.string().min(1, 'prompt is required'),
		answer: z.string().min(1, 'answer is required'),
		explanation: z.string().min(1, 'explanation is required'),
		type: z.enum(QUESTION_TYPES),
		options: z.array(z.string().min(1)).optional(),
		topic: z.string().min(1).optional(),
		difficulty: DIFFICULTY_NORMALISER.optional(),
		skillFocus: z.string().min(1).optional(),
		sourceReference: z.string().min(1).optional()
	})
	.superRefine((value, ctx) => {
		if (value.type === 'multiple_choice' && (!value.options || value.options.length !== 4)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'multiple_choice questions must include exactly four options',
				path: ['options']
			});
		}
		if (value.type !== 'multiple_choice' && value.options && value.options.length > 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'options are only allowed for multiple_choice questions',
				path: ['options']
			});
		}
	});

export const QuizGenerationSchema = z
	.object({
		quizTitle: z.string().min(1, 'quizTitle is required'),
		summary: z.string().min(1, 'summary is required'),
		mode: z.enum(QUIZ_MODES),
		subject: z.string().min(1).optional(),
		board: z.string().min(1).optional(),
		syllabusAlignment: z.string().min(1).optional(),
		questionCount: z.number().int().positive(),
		questions: z.array(QuizQuestionSchema).min(1)
	})
	.superRefine((value, ctx) => {
		if (value.questions.length !== value.questionCount) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'questionCount must match the number of questions returned',
				path: ['questionCount']
			});
		}
	});

export const JudgeRubricItemSchema = z.object({
	criterion: z.string().min(1),
	score: z.number().min(0).max(1),
	justification: z.string().min(1)
});

export const JudgeVerdictSchema = z.object({
	explanation: z.string().min(1),
	rubricFindings: z.array(JudgeRubricItemSchema).min(1),
	verdict: z.enum(['approve', 'revise'])
});

export const JudgeAuditSchema = z.object({
	explanation: z.string().min(1),
	verdictAgreement: z.enum(['agree', 'needs_review', 'disagree']),
	confidence: z.enum(['high', 'medium', 'low'])
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizGeneration = z.infer<typeof QuizGenerationSchema>;
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
export type JudgeAudit = z.infer<typeof JudgeAuditSchema>;
