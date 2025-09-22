import { z } from 'zod';

import { QuizGenerationSchema } from '$lib/server/llm/schemas';

const PREVIEW_MODES = ['extraction', 'synthesis'] as const;

export const PreviewIndexEntrySchema = z.object({
	id: z.number().int().positive(),
	sourceRelativePath: z.string().min(1),
	mode: z.enum(PREVIEW_MODES),
	subject: z.string().min(1).optional(),
	board: z.string().min(1).optional(),
	questionCount: z.number().int().positive(),
	outputFile: z.string().min(1)
});

export const PreviewDetailSchema = PreviewIndexEntrySchema.extend({
	quiz: QuizGenerationSchema
});

export const PreviewIndexSchema = z.object({
	generatedAt: z.string().datetime(),
	entries: z.array(PreviewIndexEntrySchema)
});

export type PreviewIndexEntry = z.infer<typeof PreviewIndexEntrySchema>;
export type PreviewDetail = z.infer<typeof PreviewDetailSchema>;
export type PreviewIndex = z.infer<typeof PreviewIndexSchema>;
