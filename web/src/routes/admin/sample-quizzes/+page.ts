import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { QuizGenerationSchema } from '$lib/llm/schemas';
import type { PageLoad } from './$types';

const RequestSchema = z.object({
	model: z.string().min(1),
	questionCount: z.number().int().positive()
});

const SourceSchema = z.object({
	relativePath: z.string().min(1),
	displayName: z.string().min(1)
});

const SampleIndexEntrySchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	mode: z.enum(['extraction', 'synthesis', 'extension']),
	subject: z.string().min(1).optional(),
	questionCount: z.number().int().positive(),
	request: RequestSchema,
	source: SourceSchema,
	quizTitle: z.string().min(1),
	outputPath: z.string().min(1),
	generatedAt: z.string().datetime({ offset: true })
});

const SampleIndexSchema = z.object({
	generatedAt: z.string().datetime({ offset: true }),
	samples: z.array(SampleIndexEntrySchema)
});

const SampleDetailSchema = z.object({
	id: z.string().min(1),
	mode: z.enum(['extraction', 'synthesis', 'extension']),
	subject: z.string().min(1).optional(),
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
		const res = await fetch(sample.outputPath);
		if (!res.ok) {
			throw error(500, `Failed to load sample quiz detail for ${sample.id}`);
		}
		const rawDetail = await res.json();
		return SampleDetailSchema.parse(rawDetail);
	});

	const details = await Promise.all(detailPromises);
	const detailById = new Map(details.map((detail) => [detail.id, detail]));

	return {
		generatedAt: parsedIndex.generatedAt,
		entries: parsedIndex.samples.map((sample) => {
			const detail = detailById.get(sample.id);
			if (!detail) {
				throw error(500, `Missing detail payload for ${sample.id}`);
			}
			return {
				overview: sample,
				detail
			};
		})
	};
};
