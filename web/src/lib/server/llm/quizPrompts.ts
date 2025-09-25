import { Type, type Schema } from '@google/genai';
import type { Part } from '@google/genai';

import { QuizGenerationSchema, type InlineSourceFile, type QuizGeneration } from '$lib/llm/schemas';

export interface GenerateQuizOptions {
	readonly mode: 'extraction' | 'synthesis';
	readonly questionCount: number;
	readonly subject?: string;
	readonly board?: string;
	readonly sourceFiles: InlineSourceFile[];
	readonly temperature?: number;
}

export const BASE_PROMPT_HEADER = `You are Spark's GCSE Triple Science quiz builder. Work strictly from the supplied study material.`;

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

export function normaliseQuizPayload(payload: unknown): unknown {
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

export function buildSourceParts(files: InlineSourceFile[]): Part[] {
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
			'Return questionCount distinct items that match the source closely.',
			'Represent the full breadth of the source. Include every major concept, definition, worked example, or sub-question that appears.',
			'If you must merge short sub-parts to fit the questionCount, retain their core ideas and cite all relevant source references.',
			'When the source lists numbered exam questions, cover every numbered item and its sub-parts—combine them into one prompt only when the combined question still requires every original answer.'
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
		`You must return exactly ${options.questionCount} questions.`,
		'Prioritise coverage breadth over repetition. If the source has more material than fits, select items so every key theme is still assessed.',
		'Summaries and field values must never claim coverage that the questions do not provide; explicitly note any unavoidable omissions.'
	);
	base.push(
		'Return JSON that matches the provided schema. Field guidance:',
		'- quizTitle: Concise, exam-style title for the quiz.',
		'- summary: Two sentences. Sentence one states the scope, question types, and syllabus link. Sentence two must begin with "Coverage gaps:" and either say "none – full coverage achieved." or list the specific missing topics/processes.',
		'- mode: Set to the provided mode value.',
		'- subject: Copy the provided subject exactly.',
		'- board: Copy the provided exam board exactly.',
		'- syllabusAlignment: Brief note (<120 chars) naming the GCSE Triple Science topic or module.',
		'- questionCount: Must equal the number of questions returned.',
		'- questions: Array of question objects defined below.'
	);
	base.push(
		'Each question object must include:',
		'- id: Match the original question identifier when present (e.g., "Q1a"). Otherwise use sequential IDs ("Q1", "Q2", ...).',
		'- prompt: Clean exam-ready wording that still mirrors the source task.',
		'- answer: Correct, concise answer text.',
		'- explanation: One to two sentences justifying the answer with source evidence.',
		'- type: One of multiple_choice, short_answer, true_false, or numeric.',
		'- options: Only for multiple_choice. Provide exactly four answer texts without prefixing letters—the system adds labels.',
		'- topic: Short topic label (e.g., "Atomic structure").',
		'- difficulty: Use foundation, intermediate, or higher.',
		'- skillFocus: Action-oriented description of the assessed skill (e.g., "Interpret data", "Explain process").',
		'- sourceReference: Precise citation (page, question number, or caption) so humans can trace the origin. Do not fabricate references.',
		'- Always correct typographical or scientific errors from the source (e.g., prefer the standard UK spelling "phosphorus" even if the source writes "phosphorous").',
		'- Keep prompts, requested counts, and answers aligned. If a question asks for a specific number of items, return exactly that many in the answer after choosing the most representative examples, or adjust the prompt text so the count and answer match.',
		'- Tighten ambiguous wording when needed so the scientific term is explicit (e.g., say "relative atomic mass" rather than the vague "relative mass").'
	);
	if (options.subject) {
		base.push(`Subject focus: ${options.subject}.`);
	}
	if (options.board) {
		base.push(`Exam board context: ${options.board}.`);
	}
	base.push(
		'Include concise sourceReference entries when you can identify page numbers, prompts or captions.',
		'If the material lacks enough detail for a requirement, explain the limitation in the summary.',
		'Verify that ids and sourceReference values align with the original numbering before returning the JSON.'
	);
	return base.join('\n');
}

export function parseQuizFromText(text: string): QuizGeneration {
	const parsed = JSON.parse(text);
	const normalised = normaliseQuizPayload(parsed);
	return QuizGenerationSchema.parse(normalised);
}

export type QuizPromptPart = Part;
