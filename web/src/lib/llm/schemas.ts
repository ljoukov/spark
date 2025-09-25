import { z } from 'zod';

export interface InlineSourceFile {
	readonly displayName: string;
	readonly mimeType: string;
	readonly data: string;
}

export const QUIZ_MODES = ['extraction', 'synthesis', 'extension'] as const;

export const SLOP_AXIS_CODES = [
	'Density',
	'Relevance',
	'Factuality',
	'Bias',
	'Structure',
	'Coherence',
	'Tone'
] as const;

export const SLOP_AUTO_SIGNAL_KEYS = [
	'tokens',
	'sentences',
	'words',
	'info_entropy_mean',
	'info_entropy_stddev',
	'idea_density',
	'repetition_compression_ratio',
	'templates_per_token',
	'subj_lexicon_ratio',
	'avg_sentence_len',
	'flesch_reading_ease',
	'fk_grade',
	'gunning_fog'
] as const;

function isSlopAutoSignalKey(value: string): value is (typeof SLOP_AUTO_SIGNAL_KEYS)[number] {
	return (SLOP_AUTO_SIGNAL_KEYS as readonly string[]).includes(value);
}

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

const SlopSpanSchema = z
	.object({
		quote: z.string().min(1),
		char_start: z.number().int().nonnegative(),
		char_end: z.number().int().nonnegative()
	})
	.refine((value) => value.char_end >= value.char_start, {
		message: 'char_end must be >= char_start'
	});

const SlopAxisAutoSignalEntrySchema = z.object({
	name: z.enum(SLOP_AUTO_SIGNAL_KEYS),
	value: z.union([z.number(), z.string()])
});

const RawSlopAxisAutoSignalsSchema = z
	.union([
		z.record(z.string(), z.union([z.number(), z.string()])),
		z.array(SlopAxisAutoSignalEntrySchema).max(4)
	])
	.optional();

const SlopAxisAutoSignalsSchema = RawSlopAxisAutoSignalsSchema.transform((value) => {
	if (!value) {
		return {} satisfies SlopAutoSignals;
	}

	const entries: Array<{
		name: string;
		value: number | string;
	}> = Array.isArray(value)
		? value
		: Object.entries(value).map(([name, entryValue]) => ({
				name,
				value: entryValue as number | string
			}));

	const result: Partial<Record<(typeof SLOP_AUTO_SIGNAL_KEYS)[number], number>> = {};
	for (const entry of entries) {
		if (!isSlopAutoSignalKey(entry.name)) {
			continue;
		}
		const numericValue =
			typeof entry.value === 'string' ? Number.parseFloat(entry.value) : entry.value;
		if (Number.isFinite(numericValue)) {
			result[entry.name] = Number(numericValue);
		}
	}

	return result satisfies SlopAutoSignals;
});

export const SlopAxisScoreSchema = z.object({
	code: z.enum(SLOP_AXIS_CODES),
	score_0_to_4: z.number().min(0).max(4),
	auto_signals: SlopAxisAutoSignalsSchema,
	spans: z.array(SlopSpanSchema).max(10),
	rationale: z.string().min(1).max(200)
});

export const SlopJudgementSchema = z.object({
	overall_slop: z.object({
		label: z.union([z.literal(0), z.literal(1)]),
		confidence: z.number().min(0).max(1)
	}),
	domain: z.enum(['news', 'qa', 'other']),
	annoyance: z.number().int().min(1).max(5),
	axes: z.array(SlopAxisScoreSchema).min(1),
	top_fixes: z.array(z.string().min(1)).max(10)
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizGeneration = z.infer<typeof QuizGenerationSchema>;
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
export type JudgeAudit = z.infer<typeof JudgeAuditSchema>;
export type SlopAxisCode = (typeof SLOP_AXIS_CODES)[number];
export type SlopAxisScore = z.infer<typeof SlopAxisScoreSchema>;
export type SlopJudgement = z.infer<typeof SlopJudgementSchema>;
export type SlopAutoSignals = Partial<Record<(typeof SLOP_AUTO_SIGNAL_KEYS)[number], number>>;
