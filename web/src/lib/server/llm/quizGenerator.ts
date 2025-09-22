import type { Part } from '@google/genai';

import { runGeminiCall } from '../utils/gemini';
import { QuizGenerationSchema, type InlineSourceFile, type QuizGeneration } from '$lib/llm/schemas';
import {
	BASE_PROMPT_HEADER,
	type GenerateQuizOptions,
	QUIZ_RESPONSE_SCHEMA,
	buildGenerationPrompt,
	buildSourceParts,
	normaliseQuizPayload
} from './quizPrompts';

export type { GenerateQuizOptions } from './quizPrompts';

export interface ExtendQuizOptions {
	readonly sourceFiles: InlineSourceFile[];
	readonly baseQuiz: QuizGeneration;
	readonly additionalQuestionCount: number;
}

export async function generateQuizFromSource(
	options: GenerateQuizOptions
): Promise<QuizGeneration> {
	const prompt = buildGenerationPrompt(options);
	const parts: Part[] = [{ text: prompt }, ...buildSourceParts(options.sourceFiles)];

	const response = await runGeminiCall((client) =>
		client.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: [
				{
					role: 'user',
					parts
				}
			],
			config: {
				responseMimeType: 'application/json',
				responseSchema: QUIZ_RESPONSE_SCHEMA,
				temperature: options.temperature ?? 0.2
			}
		})
	);

	const text = response.text;
	if (!text) {
		throw new Error('Gemini did not return any text for quiz generation');
	}

	const parsed = JSON.parse(text);
	const normalised = normaliseQuizPayload(parsed);
	return QuizGenerationSchema.parse(normalised);
}

export function buildExtensionPrompt(options: ExtendQuizOptions): string {
	return [
		BASE_PROMPT_HEADER,
		'The learner already received an initial quiz, provided below as JSON. They now want additional questions.',
		'Requirements:',
		`- Produce exactly ${options.additionalQuestionCount} new questions.`,
		'- Avoid duplicating any prompt ideas, answer wording, or explanation themes present in the base quiz.',
		'- Continue to ground every item strictly in the supplied material.',
		'- Highlight fresh angles or subtopics that were underrepresented previously.',
		'- Multiple choice responses must include four options labelled A, B, C, and D.',
		'- Difficulty must be mapped to foundation, intermediate, or higher for every question.',
		'Return JSON following the schema. Set mode to "extension" and update questionCount accordingly.',
		'Do not restate the previous questions in the response. Only include the new items.'
	].join('\n');
}

export async function extendQuizWithMoreQuestions(
	options: ExtendQuizOptions
): Promise<QuizGeneration> {
	const prompt = buildExtensionPrompt(options);
	const baseQuizJson = JSON.stringify(options.baseQuiz, null, 2);
	const parts: Part[] = [
		{ text: prompt },
		...buildSourceParts(options.sourceFiles),
		{
			text: `Existing quiz JSON:\n${baseQuizJson}`
		}
	];

	const response = await runGeminiCall((client) =>
		client.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: [
				{
					role: 'user',
					parts
				}
			],
			config: {
				responseMimeType: 'application/json',
				responseSchema: QUIZ_RESPONSE_SCHEMA,
				temperature: 0.2
			}
		})
	);

	const text = response.text;
	if (!text) {
		throw new Error('Gemini did not return any text for quiz extension');
	}
	const parsed = JSON.parse(text);
	const normalised = normaliseQuizPayload(parsed);
	return QuizGenerationSchema.parse(normalised);
}
