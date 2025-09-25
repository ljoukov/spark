import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { QuizGenerationSchema } from '$lib/llm/schemas';
import type { PageLoad } from './$types';

const RequestSchema = z.object({
	model: z.string().min(1),
	questionCount: z.number().int().positive(),
	temperature: z.number().optional()
});

const SourceSchema = z.object({
	relativePath: z.string().min(1),
	displayName: z.string().min(1)
});

const SlopScoreSchema = z.object({
        label: z.union([z.literal(0), z.literal(1)]),
        riskScore: z.number()
});

const SampleOutputsSchema = z.object({
        quiz: z.string().min(1).optional(),
        qualityJudge: z.string().min(1).optional(),
        slop: z.string().min(1).optional(),
        extension: z.string().min(1).optional(),
        extensionQualityJudge: z.string().min(1).optional(),
        extensionSlop: z.string().min(1).optional()
});

const SampleIndexEntrySchema = z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        mode: z.enum(['extraction', 'synthesis', 'extension']),
        subject: z.string().min(1).optional(),
        board: z.string().min(1).optional(),
        questionCount: z.number().int().positive().optional(),
        request: RequestSchema.optional(),
        source: SourceSchema,
        quizTitle: z.string().min(1).optional(),
        summary: z.string().min(1).optional(),
        outputPath: z.string().min(1).optional(),
        generatedAt: z.string().datetime({ offset: true }).optional(),
        outputs: SampleOutputsSchema,
        extension: z
                .object({
                        quizTitle: z.string().min(1),
                        questionCount: z.number().int().positive(),
                        generatedAt: z.string().datetime({ offset: true })
                })
                .nullable()
                .optional(),
        quality: z
                .object({
                        baseVerdict: z.enum(['approve', 'revise']).optional(),
                        extensionVerdict: z.enum(['approve', 'revise']).optional()
                })
                .optional(),
        slop: z
                .object({
                        base: SlopScoreSchema.optional(),
                        extension: SlopScoreSchema.optional()
                })
                .optional()
});

const SampleIndexSchema = z.object({
	generatedAt: z.string().datetime({ offset: true }),
	samples: z.array(SampleIndexEntrySchema)
});

const SampleDetailSchema = z.object({
        id: z.string().min(1),
        mode: z.enum(['extraction', 'synthesis', 'extension']),
        subject: z.string().min(1).optional(),
        board: z.string().min(1).optional(),
        generatedAt: z.string().datetime({ offset: true }),
	request: RequestSchema,
	source: SourceSchema,
	prompt: z.string().min(1),
	quiz: QuizGenerationSchema
});

export type SampleOverview = z.infer<typeof SampleIndexEntrySchema>;
export type SampleDetail = z.infer<typeof SampleDetailSchema>;

export const load: PageLoad = async ({ fetch }) => {
        const indexRes = await fetch('/admin/sample-quizzes/index.json');
        if (!indexRes.ok) {
                throw error(500, 'Failed to load sample quiz index');
        }
        const rawIndex = await indexRes.json();
        const parsedIndex = SampleIndexSchema.parse(rawIndex);

        const detailPromises = parsedIndex.samples.map(async (sample) => {
                if (!sample.outputPath) {
                        return null;
                }
                const res = await fetch(sample.outputPath);
                if (!res.ok) {
                        throw error(500, `Failed to load sample quiz detail for ${sample.id}`);
                }
                const rawDetail = await res.json();
                return SampleDetailSchema.parse(rawDetail);
        });

        const details = await Promise.all(detailPromises);
        const detailById = new Map(
                details
                        .filter((detail): detail is SampleDetail => detail !== null)
                        .map((detail) => [detail.id, detail])
        );

        return {
                generatedAt: parsedIndex.generatedAt,
                entries: parsedIndex.samples.map((sample) => {
                        const detail = sample.outputPath ? detailById.get(sample.id) ?? null : null;
                        return {
                                overview: sample,
                                detail
                        };
                })
        };
};
