import { generateText, type LlmTextDelta, type LlmTextModelId } from '@spark/llm';

export const DEFAULT_GRADING_PROMPT =
	'Use GCSE Biology marking standards. Award marks for each distinct point in the mark scheme.';
export const DEFAULT_MARK_SCHEME =
	'Derive the mark scheme from the model answer. Award one mark per distinct correct idea.';
const INTERACTIVE_QUIZ_GRADING_MODEL_ID: LlmTextModelId = 'gemini-flash-latest';

export type GradeTypeAnswerInput = {
	gradingPrompt: string;
	markScheme: string;
	maxMarks: number;
	questionPrompt: string;
	modelAnswer: string;
	studentAnswer: string;
	maxAttempts?: number;
};

export type GradeTypeAnswerResult = {
	awardedMarks: number;
	maxMarks: number;
	feedback: string;
	result: 'correct' | 'partial' | 'incorrect';
};

async function requestGradeFromModel(
	prompt: string,
	maxAttempts: number,
	onDelta?: (delta: LlmTextDelta) => void
): Promise<string> {
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const text = await generateText({
				modelId: INTERACTIVE_QUIZ_GRADING_MODEL_ID,
				contents: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
				onDelta
			});
			return text;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError ?? new Error('LLM request failed');
}

function buildGradingPrompt(input: GradeTypeAnswerInput): string {
	return [
		"You are Spark's GCSE examiner.",
		'Grade the student answer using the mark scheme. Award partial credit when appropriate.',
		'Return plain text only (no JSON, no code fences) using this exact output format:',
		'%AWARDED_MARKS%: X',
		'%MAX_MARKS%: Y',
		'%FEEDBACK%:',
		'<Markdown block starts on the next line after a blank line>',
		'(Leave exactly one blank line after %FEEDBACK%: before the Markdown.)',
		'',
		'The Markdown block must be fluent, student-facing, and use the exact structure below.',
		'Use headings that read naturally (not robotic or copy-pasted).',
		'### (a) Your grade and feedback',
		'**Your answer:** **X/Y**',
		'Reason: 1-2 sentences explaining what is correct/missing (be specific, student-facing).',
		'If awardedMarks < maxMarks, add two short lines immediately after Reason:',
		'Where you got marks: ...',
		'What you missed: ...',
		'If awardedMarks = maxMarks, skip the Where/What lines entirely.',
		'',
		'---',
		'',
		'### (b) Full-mark model answer (GCSE)',
		'A 2-4 sentence model answer that stays close to any correct student points; use **bold** to emphasize key terms.',
		'',
		'---',
		'',
		'### (c) Marking points (1 bullet per mark)',
		'Use a hyphen list with one bullet per mark (e.g. "- point"). Do not use numbered lists.',
		'Put a blank line before the bullet list.',
		'',
		'You may use 0-2 subject-relevant emoji total (e.g. 🧬 🦠 🧪) to improve clarity or memorability.',
		'If no correct points are present, explicitly say so in section (a) before listing missing points.',
		'Example output:',
		'%AWARDED_MARKS%: 2',
		'%MAX_MARKS%: 4',
		'%FEEDBACK%:',
		'',
		'### (a) Your grade and feedback 🧪',
		'**Your answer:** **2/4**',
		'Reason: You correctly stated that antibiotics don’t work on viruses and mentioned symptom relief, but you didn’t explain how the immune system clears the virus.',
		'Where you got marks: antibiotics only kill **bacteria**, not **viruses**.',
		'What you missed: the **immune system** makes **antibodies** and uses **phagocytosis** to remove the virus.',
		'',
		'---',
		'',
		'### (b) Full-mark model answer (GCSE)',
		'Antibiotics only kill **bacteria**, not **viruses**, so they don’t treat viral disease. Instead, **painkillers** can ease symptoms while the **immune system** produces **antibodies** and uses **phagocytosis** to clear infected cells.',
		'',
		'---',
		'',
		'### (c) Marking points (1 bullet per mark)',
		'',
		'- Antibiotics do not work on **viruses** (only bacteria).',
		'- **Painkillers** relieve symptoms.',
		'- The **immune system** produces **antibodies**.',
		'- **Phagocytosis** clears the virus/infected cells.',
		'Do not mention the mark scheme explicitly; only use it to grade.',
		'',
		'Grading prompt:',
		input.gradingPrompt,
		'',
		`Question (${input.maxMarks} marks):`,
		input.questionPrompt,
		'',
		'Mark scheme:',
		input.markScheme,
		'',
		'Model answer:',
		input.modelAnswer,
		'',
		'Student answer:',
		input.studentAnswer
	].join('\n');
}

export type GradeOutput = {
	awardedMarks: number;
	maxMarks: number;
	feedback: string;
};

export function parseGradeOutput(rawText: string, maxMarks: number): GradeOutput {
	const trimmed = rawText.trim();
	if (!trimmed) {
		throw new Error('Empty grading response');
	}
	const feedbackMatch = trimmed.match(/%FEEDBACK%:\s*([\s\S]*)/i);
	const sectionMatch = trimmed.match(/(###\s*\(a\)[\s\S]*)/i);
	const feedbackRaw = feedbackMatch?.[1]?.trim() ?? sectionMatch?.[1]?.trim();
	if (!feedbackRaw) {
		throw new Error('Missing feedback in grading response');
	}

	const awardedMatch = trimmed.match(/%AWARDED_MARKS%:\s*(\d+)/i);
	const maxMatch = trimmed.match(/%MAX_MARKS%:\s*(\d+)/i);
	let awardedMarks = awardedMatch ? Number.parseInt(awardedMatch[1], 10) : NaN;
	let parsedMaxMarks = maxMatch ? Number.parseInt(maxMatch[1], 10) : maxMarks;

	if (!Number.isFinite(awardedMarks)) {
		const markMatch = feedbackRaw.match(
			/(?:Mark|Your answer|Your grade|Score)\s*:\s*.*?(\d+)\s*\/\s*(\d+)/i
		);
		if (markMatch) {
			awardedMarks = Number.parseInt(markMatch[1], 10);
			parsedMaxMarks = Number.parseInt(markMatch[2], 10);
		}
	}

	if (!Number.isFinite(awardedMarks)) {
		throw new Error('Missing awarded marks in grading response');
	}

	return {
		awardedMarks,
		maxMarks: parsedMaxMarks,
		feedback: normalizeGradeFeedback(feedbackRaw)
	};
}

function normalizeMarkingPointsSection(feedback: string): string {
	const lines = feedback.split(/\r?\n/u);
	const output: string[] = [];
	let inMarkingSection = false;

	for (const line of lines) {
		const trimmed = line.trim();
		const isHeading = /^###\s+/i.test(trimmed);
		const isSectionC = /^###\s*\(c\)\s*/i.test(trimmed);

		if (isHeading) {
			inMarkingSection = isSectionC;
			output.push(line);
			continue;
		}

		if (!inMarkingSection) {
			output.push(line);
			continue;
		}

		if (trimmed.length === 0) {
			output.push(line);
			continue;
		}

		if (/^[-*+]\s+/.test(trimmed)) {
			output.push(line);
			continue;
		}
		if (/^\d+\.\s+/.test(trimmed)) {
			const withoutIndex = trimmed.replace(/^\d+\.\s+/, '');
			output.push(`- ${withoutIndex}`);
			continue;
		}

		output.push(`- ${trimmed}`);
	}

	return output.join('\n');
}

function normalizeGradeFeedback(feedback: string): string {
	const normalized = normalizeMarkingPointsSection(feedback);
	return normalized.trim();
}

export function resolveGradingPrompt(value?: string | null): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_GRADING_PROMPT;
}

export function resolveMarkScheme(value?: string | null): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_MARK_SCHEME;
}

export async function gradeTypeAnswer(input: GradeTypeAnswerInput): Promise<GradeTypeAnswerResult> {
	const prompt = buildGradingPrompt(input);
	const rawText = await requestGradeFromModel(prompt, input.maxAttempts ?? 3);
	const parsed = parseGradeOutput(rawText, input.maxMarks);
	const awardedMarks = Math.max(0, Math.min(parsed.awardedMarks, input.maxMarks));
	const feedback = parsed.feedback.trim();
	const result: GradeTypeAnswerResult['result'] =
		awardedMarks >= input.maxMarks ? 'correct' : awardedMarks === 0 ? 'incorrect' : 'partial';

	return {
		awardedMarks,
		maxMarks: input.maxMarks,
		feedback,
		result
	};
}

export type GradeStreamDelta = {
	type: 'thought' | 'text';
	delta: string;
};

export async function gradeTypeAnswerStreaming(
	input: GradeTypeAnswerInput,
	onDelta?: (delta: GradeStreamDelta) => void
): Promise<GradeTypeAnswerResult> {
	const prompt = buildGradingPrompt(input);
	let sawText = false;
	const rawText = await requestGradeFromModel(prompt, input.maxAttempts ?? 3, (delta) => {
		if (delta.thoughtDelta) {
			onDelta?.({ type: 'thought', delta: delta.thoughtDelta });
		}
		if (delta.textDelta) {
			sawText = true;
			onDelta?.({ type: 'text', delta: delta.textDelta });
		}
	});
	if (!sawText && onDelta) {
		onDelta({ type: 'text', delta: rawText });
	}
	const parsed = parseGradeOutput(rawText, input.maxMarks);
	const awardedMarks = Math.max(0, Math.min(parsed.awardedMarks, input.maxMarks));
	const feedback = parsed.feedback.trim();
	const result: GradeTypeAnswerResult['result'] =
		awardedMarks >= input.maxMarks ? 'correct' : awardedMarks === 0 ? 'incorrect' : 'partial';

	return {
		awardedMarks,
		maxMarks: input.maxMarks,
		feedback,
		result
	};
}
