import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

export interface InlineSourceFile {
	readonly displayName: string;
	readonly mimeType: string;
	readonly data: string;
}

// LLM responses still report whether they refined source questions ("extraction"),
// authored new ones ("synthesis"), or added follow-ups ("extension"), so keep all
// three modes in the schema even though callers no longer pre-select them.
export const QUIZ_MODES = ['extraction', 'synthesis', 'extension'] as const;

export const QUESTION_TYPES = ['multiple_choice', 'short_answer', 'true_false', 'numeric'] as const;

const QuizQuestionSchema = z
	.object({
		id: z.string().min(1),
		type: z.enum(QUESTION_TYPES),
		prompt: z.string().min(1),
		options: z.array(z.string().min(1)).optional(),
		answer: z.string().min(1),
		explanation: z.string().min(1),
		sourceReference: z.string().min(1).optional()
	})
	.superRefine((value, ctx) => {
		if (value.type === 'multiple_choice') {
			if (!value.options || value.options.length !== 4) {
				ctx.addIssue({
					code: 'custom',
					message: 'multiple_choice questions must include exactly four options',
					path: ['options']
				});
			}
			return;
		}
		if (value.options && value.options.length > 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'options are only allowed for multiple_choice questions',
				path: ['options']
			});
		}
	});

// QuizGenerationSchema schema needs to be in strict sync with QUIZ_RESPONSE_SCHEMA
export const QuizGenerationSchema = z
	.object({
		mode: z.enum(QUIZ_MODES),
		subject: z.string().min(1),
		questionCount: z.number().int().min(1),
		questions: z.array(QuizQuestionSchema).min(1),
		quizTitle: z.string().min(1)
	})
	.superRefine((value, ctx) => {
		if (value.questions.length !== value.questionCount) {
			ctx.addIssue({
				code: 'custom',
				message: 'questionCount must match the number of questions returned',
				path: ['questionCount']
			});
		}
	});

// QUIZ_RESPONSE_SCHEMA schema needs to be in strict sync with QuizGenerationSchema
// This schema could be potentially generated programmatically from QuizGenerationSchema,
// but we want to take advantage from "propertyOrdering" which is essential for LLMs.
export const QUIZ_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		mode: { type: Type.STRING, enum: ['extraction', 'synthesis', 'extension'] },
		subject: { type: Type.STRING },
		questionCount: { type: Type.INTEGER, minimum: 1 },
		questions: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					id: { type: Type.STRING },
					type: {
						type: Type.STRING,
						enum: ['multiple_choice', 'short_answer', 'true_false', 'numeric']
					},
					prompt: { type: Type.STRING },
					options: {
						type: Type.ARRAY,
						items: { type: Type.STRING }
					},
					answer: { type: Type.STRING },
					explanation: { type: Type.STRING },
					sourceReference: { type: Type.STRING }
				},
				required: ['id', 'type', 'prompt', 'answer', 'explanation'],
				propertyOrdering: [
					'id',
					'type',
					'prompt',
					'options',
					'answer',
					'explanation',
					'sourceReference'
				]
			}
		},
		quizTitle: { type: Type.STRING }
	},
	required: ['mode', 'subject', 'questionCount', 'questions', 'quizTitle'],
	propertyOrdering: ['mode', 'subject', 'questionCount', 'questions', 'quizTitle']
};

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
