import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { QuizGenerationSchema, type QuizGeneration } from '$lib/server/llm/schemas';
import type { Pathname } from '$app/types';
import type { PageServerLoad } from './$types';

const ManifestSourceFileSchema = z.object({
	relativePath: z.string().min(1),
	displayName: z.string().min(1),
	mimeType: z.string().min(1),
	bytes: z.number().int().nonnegative()
});

const ManifestEntrySchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	mode: z.enum(['extraction', 'synthesis', 'extension']),
	questionCount: z.number().int().positive(),
	subject: z.string().min(1).optional(),
	board: z.string().min(1).optional(),
	generatedAt: z.string().min(1),
	generationSource: z.enum(['live', 'fixture']),
	status: z.enum(['ok', 'error']),
	errorMessage: z.string().min(1).optional(),
	quizPath: z.string().min(1),
	sourceFiles: z.array(ManifestSourceFileSchema).min(1)
});

const ManifestSchema = z.object({
	generatedAt: z.string().min(1),
	generator: z.object({
		script: z.string().min(1),
		questionCountDefault: z.number().int().positive(),
		usedFixtures: z.boolean()
	}),
	entries: z.array(ManifestEntrySchema)
});

type Manifest = z.infer<typeof ManifestSchema>;

type PreviewItem = {
	entry: Manifest['entries'][number];
	quiz?: QuizGeneration;
	error?: string;
	rawPath: Pathname;
};

const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const STATIC_ROOT = path.resolve(CURRENT_DIR, '../../../../static');
const PREVIEW_ROOT = path.join(STATIC_ROOT, 'admin', 'quiz-previews');

function resolvePreviewPath(relative: string): string {
	return path.join(PREVIEW_ROOT, relative);
}

export const load: PageServerLoad = async () => {
	try {
		const manifestPath = resolvePreviewPath('manifest.json');
		const manifestRaw = await readFile(manifestPath, 'utf8');
		const manifest = ManifestSchema.parse(JSON.parse(manifestRaw)) satisfies Manifest;

		const previews: PreviewItem[] = [];
		for (const entry of manifest.entries) {
			const quizFilePath = resolvePreviewPath(entry.quizPath);
			const quizRaw = await readFile(quizFilePath, 'utf8');
			let quizData: QuizGeneration | undefined;
			let errorMessage: string | undefined;
			try {
				const parsed = JSON.parse(quizRaw);
				if (entry.status === 'ok') {
					quizData = QuizGenerationSchema.parse(parsed);
				} else {
					errorMessage = typeof parsed?.error === 'string' ? parsed.error : undefined;
				}
			} catch (parseError) {
				if (entry.status === 'ok') {
					throw parseError;
				}
				errorMessage = errorMessage ?? 'Unable to parse quiz JSON.';
			}

			previews.push({
				entry,
				quiz: quizData,
				error: errorMessage ?? entry.errorMessage,
				rawPath: `/admin/quiz-previews/${entry.quizPath}` as Pathname
			});
		}

		return { manifest, previews } satisfies { manifest: Manifest; previews: PreviewItem[] };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load quiz previews.';
		throw error(500, message);
	}
};
