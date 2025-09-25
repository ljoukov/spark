import { Type, type Schema } from '@google/genai';
import type { SlopAutoSignals } from '$lib/slop/metrics';
import { autoSignalsToMarkdown } from '$lib/slop/metrics';
import { SLOP_CODES, SlopVerdictSchema, type SlopVerdict } from '$lib/llm/schemas';
import { runGeminiCall } from '$lib/server/utils/gemini';

const AUTO_SIGNAL_SCHEMA_PROPERTIES: Record<string, Schema> = {
	tokens: { type: Type.NUMBER },
	sentences: { type: Type.NUMBER },
	info_entropy_mean: { type: Type.NUMBER },
	info_entropy_cv: { type: Type.NUMBER },
	idea_density: { type: Type.NUMBER },
	repetition_compression_ratio: { type: Type.NUMBER },
	templates_per_token: { type: Type.NUMBER },
	subj_lexicon_ratio: { type: Type.NUMBER },
	avg_sentence_len: { type: Type.NUMBER },
	flesch_reading_ease: { type: Type.NUMBER },
	fk_grade: { type: Type.NUMBER },
	gunning_fog: { type: Type.NUMBER }
};

export const SLOP_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		overall_slop: {
			type: Type.OBJECT,
			properties: {
				label: { type: Type.INTEGER, enum: [0, 1] },
				confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 }
			},
			required: ['label', 'confidence'],
			propertyOrdering: ['label', 'confidence']
		},
		domain: { type: Type.STRING, enum: ['news', 'qa', 'other'] },
		annoyance: { type: Type.INTEGER, minimum: 1, maximum: 5 },
		axes: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					code: { type: Type.STRING, enum: [...SLOP_CODES] },
					score_0_to_4: { type: Type.NUMBER, minimum: 0, maximum: 4 },
					auto_signals: {
						type: Type.OBJECT,
						properties: AUTO_SIGNAL_SCHEMA_PROPERTIES
					},
					spans: {
						type: Type.ARRAY,
						items: {
							type: Type.OBJECT,
							properties: {
								quote: { type: Type.STRING },
								char_start: { type: Type.INTEGER, minimum: 0 },
								char_end: { type: Type.INTEGER, minimum: 0 }
							},
							required: ['quote', 'char_start', 'char_end'],
							propertyOrdering: ['quote', 'char_start', 'char_end']
						}
					},
					rationale: { type: Type.STRING }
				},
				required: ['code', 'score_0_to_4', 'auto_signals', 'spans', 'rationale'],
				propertyOrdering: ['code', 'score_0_to_4', 'auto_signals', 'spans', 'rationale']
			}
		},
		top_fixes: {
			type: Type.ARRAY,
			items: { type: Type.STRING }
		}
	},
	required: ['overall_slop', 'domain', 'annoyance', 'axes', 'top_fixes'],
	propertyOrdering: ['overall_slop', 'domain', 'annoyance', 'axes', 'top_fixes']
};

const MASTER_INSTRUCTIONS = `You are a meticulous copy editor. Judge the quality of the given text — not whether it is AI-written — using the slop rubric below. Work in three passes:\n1. Skim and summarise the text’s purpose and audience.\n2. Extract the minimal verbatim spans that prove any issues.\n3. Score each axis 0–4, justify briefly (≤25 words), and produce the JSON schema.\n\nGeneral guidance:\n- Focus on usefulness for the stated task and audience.\n- Code the most significant issue per span; avoid duplicate spans across axes.\n- When unsure, pick the label that captures the core problem.\n- Explain edge cases concisely.\n\nRubric overview:\n- Density: 0 none · 1 isolated filler · 2 recurring in a paragraph · 3 widespread across sections · 4 pervasive fluff.\n- Relevance: 0 on-task · 1 minor tangent · 2 repeated tangents · 3 major sections off-task · 4 largely irrelevant.\n- Factuality: 0 accurate · 1 minor imprecision · 2 one clear error · 3 several inaccuracies · 4 fabrications central to the passage.\n- Bias/Subjectivity: 0 appropriate balance · 1 mild skew · 2 notable skew or missing POV · 3 strong skew harming usefulness · 4 pervasive unjustified stance.\n- Structure: 0 varied · 1 mild repetition · 2 noticeable templating · 3 frequent repetitive blocks · 4 formulaic skeleton dominates.\n- Coherence: 0 flows · 1 small bump · 2 local confusion · 3 hard to follow overall · 4 incoherent or contradictory.\n- Tone (fluency/verbosity/word complexity): 0 natural · 1 slight mismatch · 2 recurring awkwardness · 3 widespread unnatural verbosity · 4 pervasive mismatch hurting comprehension.\n\nDomain weighting for overall slop risk (threshold 0.6):\n- news: Density .20, Relevance .20, Tone .20, Coherence .15, Bias .15, Structure .05, Factuality .05\n- qa: Factuality .35, Structure .25, Density .10, Relevance .10, Tone .10, Coherence .05, Bias .05\n- other: weight all axes equally.\nCompute the weighted risk from normalised scores (score ÷ 4). Label overall_slop.label = 1 when risk ≥ 0.6; otherwise 0.\n\nFew-shot anchor spans:\n- Density (qa): "Running is great for health" — generic filler dodges the request for marathon pacing.\n- Relevance (news): "In other community news" inside a wildfire update drifts off the incident.\n- Factuality: "The eruption lasted 18 hours" contradicts supplied briefing (3 hours).\n- Bias: "Only foolish councillors oppose the plan" lacks counter-perspective.\n- Structure: "Firstly... Secondly... Thirdly..." reused verbatim across answers.\n- Coherence: abrupt switch "However, the treaty failed" after praising its success with no explanation.\n- Tone: "Leveraging synergistic modalities" in guidance for teenagers is over-formal.\n\nReturn JSON only with the schema below.`;

export interface SlopJudgePromptOptions {
	domain: 'news' | 'qa' | 'other';
	context?: string;
	text: string;
	autoSignals: SlopAutoSignals;
}

export function buildSlopJudgePrompt(options: SlopJudgePromptOptions): string {
	const contextLine = options.context?.trim().length ? options.context.trim() : 'none';
	const autoSignalLines = autoSignalsToMarkdown(options.autoSignals);
	return [
		MASTER_INSTRUCTIONS,
		'',
		`DOMAIN: ${options.domain}`,
		`CONTEXT: ${contextLine}`,
		`TEXT: <<<${options.text.trim()}>>>`,
		'',
		'AUTO_SIGNALS:',
		autoSignalLines,
		'',
		'RETURN: Valid JSON with keys overall_slop, domain, annoyance, axes, top_fixes. No extra prose.'
	].join('\n');
}

export type EvaluateSlopOptions = SlopJudgePromptOptions;

export interface SlopJudgeResult {
	prompt: string;
	evaluatedAt: string;
	modelId: string;
	verdict: SlopVerdict;
}

const SLOP_MODELS: Array<'gemini-2.5-pro' | 'gemini-2.5-flash'> = [
	'gemini-2.5-pro',
	'gemini-2.5-flash'
];

export async function evaluateSlop(options: EvaluateSlopOptions): Promise<SlopJudgeResult> {
	const prompt = buildSlopJudgePrompt(options);
	const parts = [{ text: prompt }];
	let lastError: unknown;
	for (const model of SLOP_MODELS) {
		try {
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
						responseSchema: SLOP_RESPONSE_SCHEMA,
						temperature: 0.15
					}
				})
			);
			const text = response.text;
			if (!text) {
				throw new Error(`Gemini ${model} did not return any text`);
			}
			const parsed = JSON.parse(text) as unknown;
			const verdict = SlopVerdictSchema.parse(parsed);
			return {
				prompt,
				evaluatedAt: new Date().toISOString(),
				modelId: model,
				verdict
			};
		} catch (error: unknown) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error('Unable to run slop detection');
}
