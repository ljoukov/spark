import { error } from '@sveltejs/kit';
import { z } from 'zod';

import {
	JudgeAuditSchema,
	JudgeVerdictSchema,
	QuizGenerationSchema,
	SlopVerdictSchema
} from '$lib/llm/schemas';
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

const ModelRunSchema = z.object({
	modelId: z.string().min(1),
	temperature: z.number()
});

const SampleJobSchema = z.object({
	id: z.string().min(1),
	category: z.string().min(1),
	displayName: z.string().min(1),
	sourcePath: z.string().min(1),
	relativeSourcePath: z.string().min(1),
	mode: z.enum(['extraction', 'synthesis']),
	questionCount: z.number().int().positive(),
	subject: z.string().min(1).optional(),
	board: z.string().min(1).optional(),
	temperature: z.number().optional()
});

const JudgeFileSchema = z
	.object({
		id: z.string().min(1),
		evaluatedAt: z.string().datetime({ offset: true }),
		prompt: z.string().min(1),
		source: SourceSchema,
		job: SampleJobSchema,
		judge: z.object({
			model: ModelRunSchema,
			verdict: JudgeVerdictSchema
		}),
		audit: z
			.object({
				model: ModelRunSchema,
				result: JudgeAuditSchema
			})
			.optional()
	})
	.passthrough();

const SlopFileSchema = z
	.object({
		id: z.string().min(1),
		evaluatedAt: z.string().datetime({ offset: true }),
		prompt: z.string().min(1),
		context: z.string(),
		domain: z.enum(['news', 'qa', 'other']),
		source: SourceSchema,
		job: SampleJobSchema.optional(),
		autoSignals: z.record(z.number()),
		model: ModelRunSchema,
		verdict: SlopVerdictSchema
	})
	.passthrough();

const SampleIndexEntrySchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	mode: z.enum(['extraction', 'synthesis', 'extension']),
	subject: z.string().min(1).optional(),
	board: z.string().min(1).optional(),
	questionCount: z.number().int().positive(),
	request: RequestSchema,
	source: SourceSchema,
	quizTitle: z.string().min(1),
	summary: z.string().min(1),
	outputPath: z.string().min(1),
	generatedAt: z.string().datetime({ offset: true }),
	outputs: z.object({
		quiz: z.string().min(1),
		judge: z.string().min(1).optional(),
		slop: z.string().min(1).optional(),
		extension: z.string().min(1).optional(),
		extensionJudge: z.string().min(1).optional(),
		extensionSlop: z.string().min(1).optional()
	}),
	extension: z
		.object({
			quizTitle: z.string().min(1),
			questionCount: z.number().int().positive(),
			generatedAt: z.string().datetime({ offset: true })
		})
		.optional(),
	judge: z
		.object({
			verdict: z.enum(['approve', 'revise']),
			outputPath: z.string().min(1)
		})
		.optional(),
	extensionJudge: z
		.object({
			verdict: z.enum(['approve', 'revise']),
			outputPath: z.string().min(1)
		})
		.optional(),
	slop: z
		.object({
			label: z.union([z.literal(0), z.literal(1)]),
			confidence: z.number(),
			outputPath: z.string().min(1)
		})
		.optional(),
	extensionSlop: z
		.object({
			label: z.union([z.literal(0), z.literal(1)]),
			confidence: z.number(),
			outputPath: z.string().min(1)
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

	async function fetchAndParse<T>(url: string, schema: z.ZodType<T>, label: string): Promise<T> {
		const response = await fetch(url);
		if (!response.ok) {
			throw error(500, `Failed to load ${label}`);
		}
		const raw = await response.json();
		return schema.parse(raw);
	}

	const entries = await Promise.all(
		parsedIndex.samples.map(async (sample) => {
			const detail = await fetchAndParse(sample.outputPath, SampleDetailSchema, 'sample detail');
			const judge = sample.outputs.judge
				? await fetchAndParse(sample.outputs.judge, JudgeFileSchema, 'judge verdict')
				: null;
			const slop = sample.outputs.slop
				? await fetchAndParse(sample.outputs.slop, SlopFileSchema, 'slop verdict')
				: null;
			const extension = sample.outputs.extension
				? await fetchAndParse(sample.outputs.extension, SampleDetailSchema, 'extension quiz')
				: null;
			const extensionJudge = sample.outputs.extensionJudge
				? await fetchAndParse(
						sample.outputs.extensionJudge,
						JudgeFileSchema,
						'extension judge verdict'
					)
				: null;
			const extensionSlop = sample.outputs.extensionSlop
				? await fetchAndParse(
						sample.outputs.extensionSlop,
						SlopFileSchema,
						'extension slop verdict'
					)
				: null;

			return {
				overview: sample,
				detail,
				judge,
				slop,
				extension,
				extensionJudge,
				extensionSlop
			};
		})
	);

	return {
		generatedAt: parsedIndex.generatedAt,
		entries
	};
};
