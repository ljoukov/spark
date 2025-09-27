import type { Part } from '@google/genai';

import { QuizGenerationSchema, type InlineSourceFile, type QuizGeneration } from '$lib/llm/schemas';

export interface GenerateQuizOptions {
	readonly questionCount: number;
	readonly subject?: string;
	readonly board?: string;
	readonly sourceFiles: InlineSourceFile[];
}

export const BASE_PROMPT_HEADER = `You are Spark's curriculum-aligned quiz builder. Work strictly from the supplied study material. Do not invent external facts.`;

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
			const answerValue = questionRecord.answer;
			if (typeof answerValue === 'string') {
				questionRecord.answer = [answerValue];
			} else if (Array.isArray(answerValue)) {
				questionRecord.answer = answerValue.filter(
					(entry): entry is string => typeof entry === 'string'
				);
			} else if (answerValue !== undefined) {
				delete questionRecord.answer;
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
		'Write in UK English. Match the audience/tier and exam board that the source supports. Never "level up" beyond the source.',
		'',
		'Scope alignment (safety, tone, and difficulty):',
		'- Determine the definitive scope from the provided metadata (programme, subject, board, tier) and from explicit source cues such as "Higher tier only", "Separate Physics only", or board headers.',
		'- If the provided subject/tier is more advanced than the source (e.g., request says Triple Science, source is Combined), align the quiz to the source. Do not add content that is not in the source.',
		'- In that case, set quizTitle to clearly reflect the true scope (e.g., "GCSE Combined Science — Equations Review") and ensure difficulty matches the source-supported level.',
		'- Set subject to the best-fit subject/tier inferred from the source and metadata. Prefer source-specific accuracy over blindly copying a requested higher tier.',
		'',
		'Before you begin, examine the supplied material and choose a mode:',
		'- Extraction: the source already contains questions/tasks. Refine wording only when needed for clarity, preserve intent and numbering, and fill in answers directly from the source.',
		'- Synthesis: the source contains notes/tables/diagrams. Author new rigorous assessment items grounded strictly in the content.',
		'When extracting, use original identifiers (e.g., Q1, Q1a, Q2). When synthesising, ensure coverage breadth and vary question types.',
		'',
		'Coverage and balance:',
		'- Systematically scan headings/labels/sections (e.g., "Equations to learn", "Equations given", "Separate Physics only").',
		'- Ensure representative coverage from all relevant sections. Avoid over-indexing on a single section.',
		'- Distribute questions roughly in proportion to section importance/size. If the target tier includes special sections (e.g., Separate Physics), include them when present in the source; never invent them when absent.',
		'',
		'Difficulty alignment and cognitive demand:',
		'- Match difficulty to the source-supported tier. Do not exceed the source scope.',
		'- Include a healthy mix: recall/identify, apply/rearrange, interpret/analyse. Prefer multi-step application over pure lookup when the source enables it.',
		'',
		'Question quality and terminology:',
		'- Use the exact conventions and terminology from the source (e.g., group numbering, symbols, units).',
		'- Do not conflate distinct scientific terms (e.g., mass number vs relative atomic mass).',
		'- Keep prompts self-contained using only information present in the source. Hints may point where to look (e.g., a table or caption) but must not add external facts.',
		'',
		'Numeric items:',
		'- Include units in answers where appropriate. Respect significant figures implied by the source.',
		'- Where applicable, assume sensible tolerance for marking; keep the canonical answer precise in the explanation.'
	];
	base.push(
		`You must return exactly ${options.questionCount} questions.`,
		'Prioritise coverage breadth over repetition. If the source has more than fits, select items so every key theme is still assessed.',
		'If any idea lacks enough detail, narrow the scope so prompt, answer, and explanation stay fully grounded.'
	);
	base.push(
		'Return JSON that matches the provided schema. Field guidance:',
		'- quizTitle: Concise, exam-style title reflecting the true scope (board/tier) recognised in the source.',
		'- mode: Return "extraction" if you primarily refined existing questions from the material, otherwise "synthesis" when you authored new items.',
		'- subject: Use the best-fit subject/tier derived from the source and metadata (e.g., "GCSE Combined Science", "GCSE Triple Science", plus subject if known).',
		'- questionCount: Must equal the number of questions returned.',
		'- questions: Array of question objects defined below.'
	);
	base.push(
		'Each question object must include:',
		'- id: Match the original question identifier when present (e.g., "Q1a"). Otherwise use sequential IDs ("Q1", "Q2", ...).',
		'- prompt: Clean exam-ready wording that still mirrors the source task.',
		'- type: One of multiple_choice, short_answer, true_false, or numeric.',
		'- options: Only for multiple_choice. Provide 2-4 plain-text option bodies with no leading labels (UI adds A/B/C/D). Prefer 3-4 options; only use 2 options when the concept is inherently binary (otherwise use true_false).',
		'- For multi-answer multiple_choice keep 3 or 4 options; include "None of the above" only if it is genuinely plausible. Flag every correct choice via the answer array.',
		'- answer: Return an array of correct responses. For multiple_choice, each entry must be a single letter (A-D) aligned to the option positions; otherwise return one concise textual answer inside the array.',
		'- explanation: One to two sentences justifying the answer strictly with source evidence.',
		'- hint: A short, precise cue that nudges the learner without adding external facts (e.g., "Check the caption under the velocity-time graph").',
		'- sourceReference: Precise citation (page, question number, figure/caption) so humans can trace the origin. Do not fabricate references.',
		'- Correct typographical errors from the source (e.g., UK "phosphorus" not "phosphorous") without changing the scientific content.',
		'- Keep prompts, requested counts, and answers aligned. If a question asks for a specific number of items, return exactly that many, or adjust the prompt to match the grounded answer.',
		'- Use the source’s conventions exactly (e.g., AQA periodic table groups as shown; do not switch to 1-18 numbering if the source does not use it).'
	);
	if (options.subject) {
		base.push(
			`Requested subject (for context): ${options.subject}. Honour the source-supported scope if it differs.`
		);
	}
	if (options.board) {
		base.push(
			`Exam board context (for context): ${options.board}. Use the board conventions present in the source.`
		);
	}
	base.push(
		'',
		'Examples (follow patterns, do not copy text):',
		'- Scope alignment: If requested = "GCSE Triple Science (Physics)", but the source is an AQA Combined Science equations sheet, set subject to "GCSE Combined Science — Physics" and title "GCSE Combined Science — Physics Equations Review". Do not include Separate Physics-only formulae.',
		'- Terminology: On an AQA periodic table insert that does not number transition metals, do not ask for "Group 12". Ask via features the table shows (e.g., "transition metal with symbol Zn").',
		'',
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
		'Maintain strict scope alignment with the source: do not level up difficulty or add content absent from the source.',
		'You will receive the previous quiz prompts inside <PAST_QUIZES> ... </PAST_QUIZES>. Treat these markers as plain text delimiters and do not repeat the block in your response.',
		'Requirements:',
		`- Produce exactly ${options.additionalQuestionCount} new questions.`,
		'- Avoid duplicating any prompt ideas, answer wording, or explanation themes that appear in <PAST_QUIZES>.',
		'- Continue to ground every item strictly in the supplied material.',
		'- Prioritise coverage balance: focus on headings/sections underrepresented in the past quiz (e.g., "Separate Physics only" or "Equations given").',
		'- Maintain a healthy spread of cognitive demand: include some apply/rearrange/interpret questions when the source allows.',
		'- Multiple choice questions follow the same options guidance as the base quiz: supply 2-4 unlabeled option bodies, let the UI add letters; include "None of the above" only when plausible; report correct letters in the answer array.',
		'- Provide a concise hint for each question that nudges the learner without giving away the answer.',
		'- Keep prompts and answers aligned with requested counts or enumerations from the material.',
		'Return JSON following the schema. Set mode to "extension" and update questionCount accordingly. Subject should continue to reflect the true source-supported tier/board.',
		'Do not restate the previous questions in the response. Only include the new items.'
	];
	if (options.subject) {
		lines.push(
			`Requested subject (for context): ${options.subject}. Honour the source-supported scope if it differs.`
		);
	}
	if (options.board) {
		lines.push(
			`Exam board context (for context): ${options.board}. Use the board conventions present in the source.`
		);
	}
	return lines.join('\n');
}

export function parseQuizFromText(text: string): QuizGeneration {
	const parsed = JSON.parse(text);
	const normalised = normaliseQuizPayload(parsed);
	return QuizGenerationSchema.parse(normalised);
}

export type QuizPromptPart = Part;
