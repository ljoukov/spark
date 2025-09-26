import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { auditJudgeDecision, judgeQuiz } from './eval/judge';
import {
	type InlineSourceFile,
	type JudgeAudit,
	type JudgeVerdict,
	type QuizGeneration
} from '$lib/llm/schemas';
import { extendQuizWithMoreQuestions, generateQuizFromSource } from './quizGenerator';
import { runGeminiCall } from '../utils/gemini';

const LONG_TIMEOUT = 240_000;
const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '../../../../../');
const DATA_ROOT = path.join(REPO_ROOT, 'data', 'samples');

async function loadInlineSource(relativePath: string): Promise<InlineSourceFile> {
	const absolutePath = path.join(DATA_ROOT, relativePath);
	const buffer = await readFile(absolutePath);
	return {
		displayName: path.basename(absolutePath),
		mimeType: detectMimeType(absolutePath),
		data: buffer.toString('base64')
	};
}

function detectMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.pdf': {
			return 'application/pdf';
		}
		case '.jpg':
		case '.jpeg': {
			return 'image/jpeg';
		}
		case '.png': {
			return 'image/png';
		}
		default: {
			throw new Error(`Unsupported extension for inline data: ${ext}`);
		}
	}
}

describe.sequential('Gemini quiz generation pipeline', () => {
	let extractionSources: InlineSourceFile[];
	let synthesisSources: InlineSourceFile[];
	let extractionQuiz: QuizGeneration | undefined;
	let synthesisQuiz: QuizGeneration | undefined;
	let extractionVerdict: JudgeVerdict | undefined;

	async function ensureSources(): Promise<void> {
		if (!extractionSources) {
			extractionSources = [await loadInlineSource(path.join('scans', 'c21-exam-question-pack.pdf'))];
		}
		if (!synthesisSources) {
			synthesisSources = [
				await loadInlineSource(path.join('year8', 'health-blood-donations.pdf'))
			];
		}
	}

	test(
		'gemini smoke test responds to a deterministic command',
		{ timeout: LONG_TIMEOUT },
		async () => {
			const response = await runGeminiCall((client) =>
				client.models.generateContent({
					model: 'gemini-2.5-flash',
					contents: [
						{
							role: 'user',
							parts: [
								{
									text: 'Reply with the exact phrase "GEMINI_OK" and nothing else.'
								}
							]
						}
					],
					config: {
						responseMimeType: 'text/plain',
						temperature: 0
					}
				})
			);

			const text = response.text?.trim();
			expect(text).toBe('GEMINI_OK');
		}
	);

	test(
		'generates extraction quiz from study material that already contains questions',
		{ timeout: LONG_TIMEOUT },
		async () => {
			await ensureSources();
			extractionQuiz = await generateQuizFromSource({
				questionCount: 6,
				sourceFiles: extractionSources,
				subject: 'chemistry',
				board: 'AQA'
			});

			expect(extractionQuiz.mode).toBe('extraction');
			expect(extractionQuiz.questions).toHaveLength(6);
			for (const question of extractionQuiz.questions) {
				expect(question.prompt.length).toBeGreaterThan(10);
				expect(Array.isArray(question.answer)).toBe(true);
				expect(question.answer.length).toBeGreaterThan(0);
				for (const entry of question.answer) {
					expect(entry.length).toBeGreaterThan(0);
				}
				expect(question.hint.length).toBeGreaterThan(0);
				expect(question.explanation.length).toBeGreaterThan(5);
				if (question.type === 'multiple_choice') {
					expect(question.options).toBeDefined();
					expect(question.options!.length).toBeGreaterThanOrEqual(2);
					expect(question.options!.length).toBeLessThanOrEqual(4);
					for (const entry of question.answer) {
						expect(['A', 'B', 'C', 'D']).toContain(entry);
					}
				}
			}
		}
	);

	test(
		'synthesizes quiz from study material without explicit questions',
		{ timeout: LONG_TIMEOUT },
		async () => {
			await ensureSources();
			synthesisQuiz = await generateQuizFromSource({
				questionCount: 6,
				sourceFiles: synthesisSources,
				subject: 'biology',
				board: 'OCR'
			});

			expect(synthesisQuiz.mode).toBe('synthesis');
			expect(synthesisQuiz.questions).toHaveLength(6);
			const typeSet = new Set(synthesisQuiz.questions.map((question) => question.type));
			expect(typeSet.size).toBeGreaterThanOrEqual(3);
		}
	);

	test(
		'extends previous quiz with ten new questions using the same material',
		{ timeout: LONG_TIMEOUT },
		async () => {
			await ensureSources();
			if (!synthesisQuiz) {
				synthesisQuiz = await generateQuizFromSource({
					questionCount: 6,
					sourceFiles: synthesisSources,
					subject: 'biology',
					board: 'OCR'
				});
			}
			const basePrompts = new Set(
				synthesisQuiz.questions.map((question) => question.prompt.trim().toLowerCase())
			);

			const extensionQuiz = await extendQuizWithMoreQuestions({
				sourceFiles: synthesisSources,
				baseQuiz: synthesisQuiz,
				additionalQuestionCount: 10,
				subject: 'biology',
				board: 'OCR'
			});

			expect(extensionQuiz.mode).toBe('extension');
			expect(extensionQuiz.questions).toHaveLength(10);
			for (const question of extensionQuiz.questions) {
				const normalized = question.prompt.trim().toLowerCase();
				expect(basePrompts.has(normalized)).toBe(false);
			}
		}
	);

	test('judge evaluates generated quiz against rubric', { timeout: LONG_TIMEOUT }, async () => {
		await ensureSources();
		if (!extractionQuiz) {
			extractionQuiz = await generateQuizFromSource({
				questionCount: 6,
				sourceFiles: extractionSources,
				subject: 'chemistry',
				board: 'AQA'
			});
		}

		extractionVerdict = await judgeQuiz({
			sourceFiles: extractionSources,
			candidateQuiz: extractionQuiz
		});

		expect(extractionVerdict.explanation.length).toBeGreaterThan(25);
		expect(extractionVerdict.rubricFindings.length).toBeGreaterThanOrEqual(4);
		expect(['approve', 'revise']).toContain(extractionVerdict.verdict);
	});

	test(
		'audits judge decision using gemini-2.5-pro for verification',
		{ timeout: LONG_TIMEOUT },
		async () => {
			await ensureSources();
			if (!extractionQuiz) {
				extractionQuiz = await generateQuizFromSource({
					questionCount: 6,
					sourceFiles: extractionSources,
					subject: 'chemistry',
					board: 'AQA'
				});
			}
			if (!extractionVerdict) {
				extractionVerdict = await judgeQuiz({
					sourceFiles: extractionSources,
					candidateQuiz: extractionQuiz
				});
			}

			const audit: JudgeAudit = await auditJudgeDecision({
				sourceFiles: extractionSources,
				candidateQuiz: extractionQuiz,
				judgeVerdict: extractionVerdict
			});

			expect(audit.explanation.length).toBeGreaterThan(25);
			expect(['agree', 'needs_review', 'disagree']).toContain(audit.verdictAgreement);
			expect(audit.verdictAgreement).not.toBe('disagree');
		}
	);
});
