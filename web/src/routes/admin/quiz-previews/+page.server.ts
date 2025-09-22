import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { QuizGenerationSchema, QUIZ_MODES } from '$lib/server/llm/schemas';

import type { PageServerLoad } from './$types';

const QuizModeSchema = z.enum(QUIZ_MODES);

const ManifestItemSchema = z
	.object({
		id: z.string().min(1),
		sequence: z.number().int().positive(),
		mode: QuizModeSchema,
		sourceFile: z.string().min(1),
		sourceDisplayName: z.string().min(1),
		resultPath: z.string().min(1),
		status: z.enum(['ok', 'error']),
		questionCount: z.number().int().positive().optional(),
		quizTitle: z.string().min(1).optional(),
		summary: z.string().min(1).optional(),
		subject: z.string().min(1).optional(),
		board: z.string().min(1).optional(),
		errorMessage: z.string().min(1).optional()
	})
	.superRefine((value, ctx) => {
		if (value.status === 'ok' && typeof value.questionCount !== 'number') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'questionCount is required when status is ok',
				path: ['questionCount']
			});
		}
		if (value.status === 'error' && !value.errorMessage) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'errorMessage is required when status is error',
				path: ['errorMessage']
			});
		}
	});

const ManifestSchema = z
	.object({
		generatedAt: z.string().min(1),
		itemCount: z.number().int().nonnegative(),
		items: z.array(ManifestItemSchema)
	})
	.superRefine((value, ctx) => {
		if (value.items.length !== value.itemCount) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'itemCount must match the number of manifest entries',
				path: ['itemCount']
			});
		}
	});

const PersistedQuizBaseSchema = z.object({
	status: z.enum(['ok', 'error']),
	sequence: z.number().int().positive(),
	mode: QuizModeSchema,
	sourceFile: z.string().min(1),
	sourceDisplayName: z.string().min(1),
	generatedAt: z.string().min(1),
	subjectGuess: z.string().min(1).optional(),
	boardGuess: z.string().min(1).optional()
});

const PersistedQuizSuccessSchema = PersistedQuizBaseSchema.extend({
	status: z.literal('ok'),
	quiz: QuizGenerationSchema
});

const PersistedQuizErrorSchema = PersistedQuizBaseSchema.extend({
	status: z.literal('error'),
	error: z.object({
		message: z.string().min(1),
		stack: z.string().min(1).optional()
	})
});

const PersistedQuizSchema = z.union([PersistedQuizSuccessSchema, PersistedQuizErrorSchema]);

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestItem = z.infer<typeof ManifestItemSchema>;
export type PersistedQuiz = z.infer<typeof PersistedQuizSchema>;

const PREVIEW_BASE_PATH = '/admin-preview';

export const load: PageServerLoad = async ({ fetch }) => {
	const response = await fetch(`${PREVIEW_BASE_PATH}/manifest.json`, {
		headers: { 'cache-control': 'no-cache' }
	});
	if (!response.ok) {
		throw error(response.status, 'Failed to load preview manifest');
	}
	const manifestJson = await response.json();
	const manifest = ManifestSchema.parse(manifestJson);

	const previews: Record<string, PersistedQuiz> = {};
	for (const item of manifest.items) {
		const detailResponse = await fetch(`${PREVIEW_BASE_PATH}/${item.resultPath}`, {
			headers: { 'cache-control': 'no-cache' }
		});
		if (!detailResponse.ok) {
			previews[item.id] = {
				status: 'error',
				sequence: item.sequence,
				mode: item.mode,
				sourceFile: item.sourceFile,
				sourceDisplayName: item.sourceDisplayName,
				generatedAt: manifest.generatedAt,
				subjectGuess: item.subject,
				boardGuess: item.board,
				error: {
					message: `Failed to load preview JSON (${detailResponse.status})`
				}
			};
			continue;
		}
		const detailJson = await detailResponse.json();
		previews[item.id] = PersistedQuizSchema.parse(detailJson);
	}

	return {
		manifest,
		previews,
		initialSelectionId: manifest.items[0]?.id ?? null,
		previewBasePath: PREVIEW_BASE_PATH
	} satisfies {
		manifest: Manifest;
		previews: Record<string, PersistedQuiz>;
		initialSelectionId: string | null;
		previewBasePath: string;
	};
};
