import { Type, type Schema } from '@google/genai';
import type { Part } from '@google/genai';
import { runGeminiCall } from '../utils/gemini';
import { QuizGenerationSchema, type InlineSourceFile, type QuizGeneration } from './schemas';

export interface GenerateQuizOptions {
	readonly mode: 'extraction' | 'synthesis';
	readonly questionCount: number;
	readonly subject?: string;
	readonly board?: string;
	readonly sourceFiles: InlineSourceFile[];
	readonly temperature?: number;
}

export interface ExtendQuizOptions {
	readonly sourceFiles: InlineSourceFile[];
	readonly baseQuiz: QuizGeneration;
	readonly additionalQuestionCount: number;
}

const BASE_PROMPT_HEADER = `You are Spark's GCSE Triple Science quiz builder. Work strictly from the supplied study material.`;

export const QUIZ_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		quizTitle: { type: Type.STRING },
		summary: { type: Type.STRING },
		mode: { type: Type.STRING, enum: ['extraction', 'synthesis', 'extension'] },
		subject: { type: Type.STRING },
		board: { type: Type.STRING },
		syllabusAlignment: { type: Type.STRING },
		questionCount: { type: Type.INTEGER, minimum: 1 },
		questions: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					id: { type: Type.STRING },
					prompt: { type: Type.STRING },
					answer: { type: Type.STRING },
					explanation: { type: Type.STRING },
					type: {
						type: Type.STRING,
						enum: ['multiple_choice', 'short_answer', 'true_false', 'numeric']
					},
					options: {
						type: Type.ARRAY,
						items: { type: Type.STRING }
					},
					topic: { type: Type.STRING },
					difficulty: { type: Type.STRING },
					skillFocus: { type: Type.STRING },
					sourceReference: { type: Type.STRING }
				},
				required: ['id', 'prompt', 'answer', 'explanation', 'type'],
				propertyOrdering: [
					'id',
					'prompt',
					'type',
					'answer',
					'explanation',
					'options',
					'topic',
					'difficulty',
					'skillFocus',
					'sourceReference'
				]
			}
		}
	},
	required: ['quizTitle', 'summary', 'mode', 'questionCount', 'questions'],
	propertyOrdering: [
		'quizTitle',
		'summary',
		'mode',
		'subject',
		'board',
		'syllabusAlignment',
		'questionCount',
		'questions'
	]
};

function normaliseQuizPayload(payload: unknown): unknown {
	if (!payload || typeof payload !== 'object') {
		return payload;
	}
	const quizRecord = payload as Record<string, unknown>;
	const questionsValue = quizRecord.questions;
	if (Array.isArray(questionsValue)) {
		quizRecord.questionCount = questionsValue.length;
		for (const item of questionsValue) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const questionRecord = item as Record<string, unknown>;
			const typeValue = typeof questionRecord.type === 'string' ? questionRecord.type : undefined;
			if (typeValue !== 'multiple_choice' && Array.isArray(questionRecord.options)) {
				delete questionRecord.options;
			}
		}
	}
	return quizRecord;
}

function buildSourceParts(files: InlineSourceFile[]): Part[] {
	return files.map((file) => ({
		inlineData: {
			data: file.data,
			mimeType: file.mimeType
		}
	}));
}

export function buildGenerationPrompt(options: GenerateQuizOptions): string {
	const base = [BASE_PROMPT_HEADER];
	if (options.mode === 'extraction') {
		base.push(
			'The material already includes questions and answers. Extract high-quality exam-ready items.',
			'Preserve original wording as much as possible while fixing small typos.',
			'Return questionCount distinct items that match the source closely.'
		);
	} else {
		base.push(
			'The material does not contain explicit questions. Synthesize rigorous GCSE questions.',
			'Mix short_answer, multiple_choice, true_false, and numeric items.',
			'Ground every answer and explanation directly in the supplied notes.'
		);
	}
	base.push(
		'Always write in UK English and reference the specification where relevant.',
		'Return JSON that matches the provided schema. The summary should highlight coverage and question mix.',
		`You must return exactly ${options.questionCount} questions.`,
		'For multiple_choice items, include exactly four options labelled A, B, C, and D in the options array.',
		'Set the difficulty field to foundation, intermediate, or higher; choose the closest match when uncertain.'
	);
	if (options.subject) {
		base.push(`Subject focus: ${options.subject}.`);
	}
	if (options.board) {
		base.push(`Exam board context: ${options.board}.`);
	}
	base.push(
		'Include concise sourceReference entries when you can identify page numbers, prompts or captions.',
		'If the material lacks enough detail for a requirement, explain the limitation in the summary.'
	);
	return base.join('\n');
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
