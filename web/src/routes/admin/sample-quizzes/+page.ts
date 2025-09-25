import { error } from '@sveltejs/kit';
import { z } from 'zod';

import {
	QuizGenerationSchema,
	SLOP_AXIS_CODES,
	SLOP_AUTO_SIGNAL_KEYS,
	SlopJudgementSchema
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

const SlopContributionSchema = z.object({
	code: z.enum(SLOP_AXIS_CODES),
	score: z.number(),
	weight: z.number(),
	contribution: z.number()
});

const SlopJudgeModelSchema = z.object({
	modelId: z.string().min(1),
	temperature: z.number()
});

const SlopAutoSignalsSchema = z.record(z.string(), z.number()).transform((value) => {
	const result: Partial<Record<(typeof SLOP_AUTO_SIGNAL_KEYS)[number], number>> = {};
	for (const key of SLOP_AUTO_SIGNAL_KEYS) {
		const candidate = value[key];
		if (typeof candidate === 'number' && Number.isFinite(candidate)) {
			result[key] = candidate;
		}
	}
	return result;
});

const SlopJudgeDetailSchema = z.object({
	id: z.string().min(1),
	evaluatedAt: z.string().datetime({ offset: true }),
	prompt: z.string().min(1),
	domain: z.enum(['news', 'qa', 'other']),
	context: z.string().nullable().optional(),
	text: z.string().min(1),
	autoSignals: SlopAutoSignalsSchema,
	judgement: SlopJudgementSchema,
	model: SlopJudgeModelSchema,
	riskScore: z.number(),
	recommendedLabel: z.union([z.literal(0), z.literal(1)]),
	threshold: z.number(),
	contributions: z.array(SlopContributionSchema)
});

export type SampleOverview = z.infer<typeof SampleIndexEntrySchema>;
export type SampleDetail = z.infer<typeof SampleDetailSchema>;
export type SlopJudgeDetail = z.infer<typeof SlopJudgeDetailSchema>;

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
		const [detailRes, baseSlopRes, extensionSlopRes] = await Promise.all([
			fetch(sample.outputPath),
			sample.outputs.slop ? fetch(sample.outputs.slop) : Promise.resolve(null),
			sample.outputs.extensionSlop ? fetch(sample.outputs.extensionSlop) : Promise.resolve(null)
		]);

		if (!detailRes?.ok) {
			throw error(500, `Failed to load sample quiz detail for ${sample.id}`);
		}

		const rawDetail = await detailRes.json();
		const detail = SampleDetailSchema.parse(rawDetail);

		if (baseSlopRes && !baseSlopRes.ok) {
			throw error(500, `Failed to load base slop detail for ${sample.id}`);
		}
		if (extensionSlopRes && !extensionSlopRes.ok) {
			throw error(500, `Failed to load extension slop detail for ${sample.id}`);
		}

		const baseSlop = baseSlopRes ? SlopJudgeDetailSchema.parse(await baseSlopRes.json()) : null;
		const extensionSlop = extensionSlopRes
			? SlopJudgeDetailSchema.parse(await extensionSlopRes.json())
			: null;

		return { detail, baseSlop, extensionSlop };
	});

	const details = await Promise.all(detailPromises);
	const detailById = new Map<
		string,
		{
			detail: SampleDetail;
			baseSlop: SlopJudgeDetail | null;
			extensionSlop: SlopJudgeDetail | null;
		}
	>(
		details
			.filter(
				(
					entry
				): entry is {
					detail: SampleDetail;
					baseSlop: SlopJudgeDetail | null;
					extensionSlop: SlopJudgeDetail | null;
				} => entry !== null
			)
			.map((entry) => [entry.detail.id, entry])
	);

	return {
		generatedAt: parsedIndex.generatedAt,
		entries: parsedIndex.samples.map((sample) => {
			const detailEntry = sample.outputPath ? (detailById.get(sample.id) ?? null) : null;
			return {
				overview: sample,
				detail: detailEntry?.detail ?? null,
				slop: detailEntry
					? {
							base: detailEntry.baseSlop,
							extension: detailEntry.extensionSlop
						}
					: { base: null, extension: null }
			};
		})
	};
};
