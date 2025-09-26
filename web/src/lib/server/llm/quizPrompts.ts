import type { Part } from '@google/genai';

import { QuizGenerationSchema, type InlineSourceFile, type QuizGeneration } from '$lib/llm/schemas';

export interface GenerateQuizOptions {
	readonly questionCount: number;
	readonly subject?: string;
	readonly board?: string;
	readonly sourceFiles: InlineSourceFile[];
}

export const BASE_PROMPT_HEADER = `You are Spark's GCSE Triple Science quiz builder. Work strictly from the supplied study material.`;

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
	const base = [
		BASE_PROMPT_HEADER,
		'Before you begin, inspect the supplied material to determine how it presents learning content:',
		'- If it already contains explicit questions (including exam tasks or worksheets), perform an extraction pass: refine those questions, preserve their intent, and fill in any missing answers directly from the material.',
		'- If it is mostly expository notes, diagrams, or lessons without explicit questions, perform a synthesis pass: construct new rigorous GCSE assessment items grounded in the content.',
		'When you extract, keep the original numbering and cover every explicit question or sub-question. When you synthesize, ensure broad coverage across the key ideas and vary the question types.',
		'Always mix short_answer, multiple_choice, true_false, and numeric items where the material allows, and ground every prompt, answer, and explanation in the supplied content.',
		'Never fabricate information—everything must be supported by the supplied material.'
	];
	base.push(
		'Always write in UK English and reference the specification where relevant.',
		`You must return exactly ${options.questionCount} questions.`,
		'Prioritise coverage breadth over repetition. If the source has more material than fits, select items so every key theme is still assessed.',
		'If the material lacks enough detail for an idea, adjust the question scope so the prompt, answer, and explanation stay fully grounded.'
	);
	base.push(
		'Return JSON that matches the provided schema. Field guidance:',
		'- quizTitle: Concise, exam-style title for the quiz.',
		'- mode: Return "extraction" if you primarily refined existing questions from the material, otherwise "synthesis" when you authored new items.',
		'- subject: Copy the provided subject exactly.',
		'- questionCount: Must equal the number of questions returned.',
		'- questions: Array of question objects defined below.'
	);
	base.push(
		'Each question object must include:',
		'- id: Match the original question identifier when present (e.g., "Q1a"). Otherwise use sequential IDs ("Q1", "Q2", ...).',
		'- prompt: Clean exam-ready wording that still mirrors the source task.',
		'- answer: Correct, concise answer text. For multiple_choice include the matching option label (e.g., "A) Car").',
		'- explanation: One to two sentences justifying the answer with source evidence.',
		'- type: One of multiple_choice, short_answer, true_false, or numeric.',
		'- options: Only for multiple_choice. Provide exactly four answer texts prefixed with "A) ", "B) ", "C) ", and "D) " in that order.',
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
		'Verify that ids and sourceReference values align with the original numbering before returning the JSON.'
	);
	return base.join('\n');
}

export interface ExtendQuizPromptOptions {
	readonly additionalQuestionCount: number;
	readonly subject?: string;
	readonly board?: string;
}

export function buildExtensionPrompt(options: ExtendQuizPromptOptions): string {
	const lines = [
		BASE_PROMPT_HEADER,
		'The learner already received an initial quiz and now needs additional questions drawn from the same study material.',
		'You will receive the previous quiz prompts inside <PAST_QUIZES> ... </PAST_QUIZES>. Treat these markers as plain text delimiters and do not repeat the block in your response.',
		'Requirements:',
		`- Produce exactly ${options.additionalQuestionCount} new questions.`,
		'- Avoid duplicating any prompt ideas, answer wording, or explanation themes that appear in <PAST_QUIZES>.',
		'- Continue to ground every item strictly in the supplied material.',
		'- Highlight fresh angles or subtopics that were underrepresented previously.',
		'- Multiple choice responses must include four options prefixed with "A) ", "B) ", "C) ", and "D) " in that order. Write the correct answer using the matching label.',
		'- Keep prompts and answers aligned with requested counts or enumerations from the material.',
		'Return JSON following the schema. Set mode to "extension" and update questionCount accordingly.',
		'Do not restate the previous questions in the response. Only include the new items.'
	];
	if (options.subject) {
		lines.push(`Subject focus: ${options.subject}.`);
	}
	if (options.board) {
		lines.push(`Exam board context: ${options.board}.`);
	}
	return lines.join('\n');
}

export function parseQuizFromText(text: string): QuizGeneration {
	const parsed = JSON.parse(text);
	const normalised = normaliseQuizPayload(parsed);
	return QuizGenerationSchema.parse(normalised);
}

export type QuizPromptPart = Part;
