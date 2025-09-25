import { Type, type Schema } from '@google/genai';
import type { Part } from '@google/genai';
import { runGeminiCall, type GeminiModelId } from '$lib/server/utils/gemini';
import {
	JudgeAuditSchema,
	JudgeVerdictSchema,
	type InlineSourceFile,
	type QuizGeneration
} from '$lib/llm/schemas';
import type { JudgeAudit, JudgeVerdict } from '$lib/llm/schemas';

export const QUIZ_EVAL_MODEL_ID: GeminiModelId = 'gemini-2.5-pro';

export const JUDGE_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		explanation: { type: Type.STRING },
		rubricFindings: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					criterion: { type: Type.STRING },
					score: { type: Type.NUMBER, minimum: 0, maximum: 1 },
					justification: { type: Type.STRING }
				},
				required: ['criterion', 'score', 'justification'],
				propertyOrdering: ['criterion', 'score', 'justification']
			}
		},
		verdict: { type: Type.STRING, enum: ['approve', 'revise'] }
	},
	required: ['explanation', 'rubricFindings', 'verdict'],
	propertyOrdering: ['explanation', 'rubricFindings', 'verdict']
};

export const AUDIT_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		explanation: { type: Type.STRING },
		verdictAgreement: { type: Type.STRING, enum: ['agree', 'needs_review', 'disagree'] },
		confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] }
	},
	required: ['explanation', 'verdictAgreement', 'confidence'],
	propertyOrdering: ['explanation', 'verdictAgreement', 'confidence']
};

export interface JudgeOptions {
	readonly rubricSummary?: string;
	readonly sourceFiles: InlineSourceFile[];
	readonly candidateQuiz: QuizGeneration;
}

export interface AuditOptions {
	readonly sourceFiles: InlineSourceFile[];
	readonly candidateQuiz: QuizGeneration;
	readonly judgeVerdict: JudgeVerdict;
}

export function buildJudgePrompt(options: JudgeOptions): string {
	return [
		`You are Spark's internal GCSE quiz quality judge. Review the proposed quiz objectively.`,
		'Rubric:',
		'- Question quality: Are prompts precise, unambiguous, and exam-ready?',
		'- Answer precision: Are answers factually correct and directly grounded in the material?',
		'- Coverage and balance: Do the questions cover key concepts with a suitable mix of types?',
		'- Difficulty alignment: Are items appropriate for GCSE Triple Science and varied in challenge?',
		'- Safety & tone: Avoid misinformation, harmful or off-spec content.',
		options.rubricSummary
			? `Additional notes: ${options.rubricSummary}`
			: 'Use the GCSE Triple Science context and ensure UK English spelling.',
		'Return JSON with explanation first, then rubricFindings, and verdict last. Explanation must cite rubric dimensions.',
		'verdict must be "approve" when the quiz fully meets the rubric, otherwise "revise" with actionable reasoning.',
		'Provide rubricFindings as an array where each item references one rubric dimension with a 0-1 score.'
	]
		.filter(Boolean)
		.join('\n');
}

export function buildAuditPrompt(): string {
	return [
		`You are Spark's senior reviewer using gemini-2.5-pro to audit another model's judgement.`,
		'Assess whether the judge verdict is reasonable given the quiz and rubric. Focus on factual accuracy and rubric fit.',
		'Return JSON with explanation first, then verdictAgreement, then confidence.',
		'If the verdict is defensible and reasoning is sound, respond with verdictAgreement="agree".',
		'Use "needs_review" when the judge raised valid concerns but missed some nuance. Use "disagree" only if the verdict is demonstrably wrong.'
	].join('\n');
}

function toParts(text: string, sources: InlineSourceFile[], extra?: Part): Part[] {
	const baseParts: Part[] = [
		{ text },
		...sources.map((file) => ({
			inlineData: {
				data: file.data,
				mimeType: file.mimeType
			}
		}))
	];
	if (extra) {
		baseParts.push(extra);
	}
	return baseParts;
}

async function callModel({
	model,
	parts,
	schema
}: {
	model: GeminiModelId;
	parts: Part[];
	schema: Schema;
}): Promise<unknown> {
	const response = await runGeminiCall((client) =>
		client.models.generateContent({
			model,
			contents: [
				{
					role: 'user',
					parts
				}
			],
			config: {
				responseMimeType: 'application/json',
				responseSchema: schema,
				temperature: 0.15
			}
		})
	);

	const text = response.text;
	if (!text) {
		throw new Error(`Gemini ${model} did not return any text`);
	}
	return JSON.parse(text);
}

export async function judgeQuiz(options: JudgeOptions): Promise<JudgeVerdict> {
	const prompt = buildJudgePrompt(options);
	const parts = toParts(prompt, options.sourceFiles, {
		text: `Candidate quiz JSON:\n${JSON.stringify(options.candidateQuiz, null, 2)}`
	});

	const parsed = await callModel({
		model: QUIZ_EVAL_MODEL_ID,
		parts,
		schema: JUDGE_RESPONSE_SCHEMA
	});
	return JudgeVerdictSchema.parse(parsed);
}

export async function auditJudgeDecision(options: AuditOptions): Promise<JudgeAudit> {
	const prompt = buildAuditPrompt();
	const parts = toParts(prompt, options.sourceFiles, {
		text: `Judge verdict JSON:\n${JSON.stringify(options.judgeVerdict, null, 2)}\n\nCandidate quiz JSON:\n${JSON.stringify(options.candidateQuiz, null, 2)}`
	});

	const parsed = await callModel({
		model: QUIZ_EVAL_MODEL_ID,
		parts,
		schema: AUDIT_RESPONSE_SCHEMA
	});
	return JudgeAuditSchema.parse(parsed);
}
