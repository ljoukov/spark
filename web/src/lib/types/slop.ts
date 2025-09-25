import { z } from 'zod';

export const SlopAxisCodeSchema = z.enum([
	'Density',
	'Relevance',
	'Factuality',
	'Bias',
	'Structure',
	'Coherence',
	'Tone'
]);

export type SlopAxisCode = z.infer<typeof SlopAxisCodeSchema>;

export const SlopSpanSchema = z.object({
	quote: z.string().min(1),
	char_start: z.number().int().min(0),
	char_end: z.number().int().min(0)
});

export type SlopSpan = z.infer<typeof SlopSpanSchema>;

export const SlopAxisResultSchema = z.object({
	code: SlopAxisCodeSchema,
	score_0_to_4: z.number().min(0).max(4),
	auto_signals: z
		.record(z.union([z.number(), z.string()]))
		.optional()
		.default({}),
	spans: z.array(SlopSpanSchema).max(8),
	rationale: z.string().min(1).max(200)
});

export type SlopAxisResult = z.infer<typeof SlopAxisResultSchema>;

export const SlopJudgeResponseSchema = z.object({
	overall_slop: z.object({
		label: z.union([z.literal(0), z.literal(1)]),
		confidence: z.number().min(0).max(1)
	}),
	domain: z.enum(['news', 'qa', 'other']),
	annoyance: z.number().int().min(1).max(5),
	axes: z.array(SlopAxisResultSchema),
	top_fixes: z.array(z.string().min(1)).max(5)
});

export type SlopJudgeResponse = z.infer<typeof SlopJudgeResponseSchema>;

export const SlopAutoSignalsSchema = z.object({
	tokens: z.number().int().nonnegative(),
	sentences: z.number().int().min(1),
	info_entropy_mean: z.number().nonnegative(),
	info_entropy_cv: z.number().nonnegative(),
	idea_density: z.number().min(0),
	repetition_compression_ratio: z.number().min(0),
	templates_per_token: z.number().min(0),
	subj_lexicon_ratio: z.number().min(0),
	avg_sentence_len: z.number().min(0),
	flesch_reading_ease: z.number(),
	fk_grade: z.number(),
	gunning_fog: z.number(),
	complex_word_ratio: z.number().min(0),
	syllables_per_word: z.number().min(0)
});

export type SlopAutoSignals = z.infer<typeof SlopAutoSignalsSchema>;

export const SlopJudgeRequestSchema = z.object({
	domain: z.enum(['news', 'qa', 'other']),
	context: z.string().trim().default(''),
	text: z.string().min(1, 'Provide some text to evaluate.')
});

export type SlopJudgeRequest = z.infer<typeof SlopJudgeRequestSchema>;

export interface WeightedRisk {
	readonly risk: number;
	readonly threshold: number;
	readonly weights: Record<SlopAxisCode, number>;
}
