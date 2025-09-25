import { Type, type Schema } from '@google/genai';
import type { Part } from '@google/genai';
import { runGeminiCall } from '$lib/server/utils/gemini';
import {
	SlopJudgeResponseSchema,
	type SlopAutoSignals,
	type SlopJudgeRequest,
	type SlopJudgeResponse,
	SlopAxisCodeSchema,
	type SlopAxisCode
} from '$lib/types/slop';

const SLOP_JUDGE_SCHEMA: Schema = {
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
					code: {
						type: Type.STRING,
						enum: SlopAxisCodeSchema.options as [string, ...string[]]
					},
					score_0_to_4: { type: Type.NUMBER, minimum: 0, maximum: 4 },
					auto_signals: {
						type: Type.OBJECT,
						additionalProperties: { type: Type.NUMBER }
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
						},
						minItems: 0,
						maxItems: 8
					},
					rationale: { type: Type.STRING, maxLength: 200 }
				},
				required: ['code', 'score_0_to_4', 'spans', 'rationale'],
				propertyOrdering: ['code', 'score_0_to_4', 'auto_signals', 'spans', 'rationale']
			}
		},
		top_fixes: {
			type: Type.ARRAY,
			items: { type: Type.STRING, maxLength: 120 },
			maxItems: 5
		}
	},
	required: ['overall_slop', 'domain', 'annoyance', 'axes', 'top_fixes'],
	propertyOrdering: ['overall_slop', 'domain', 'annoyance', 'axes', 'top_fixes']
};

const SYSTEM_PROMPT = `You are a meticulous copy editor judging text quality using Spark's seven-axis "slop" rubric. Work in three passes:\n1) Summarise the text's purpose and audience.\n2) Extract minimal verbatim spans that evidence issues.\n3) Score each axis (0-4), cite spans, give ≤25 word rationale, then produce the JSON schema.\nGeneral guidance: focus on usefulness, not AI detection. Consider the provided domain, context, and audience. Label the most significant issue per span. When unsure, choose the single axis that best captures the core problem. Note edge cases briefly.\nRubric summary:\n- Density — too many words for too little substance. 0=None, 1=isolated fluff, 2=recurring fluff in a paragraph, 3=widespread filler, 4=pervasive filler.\n- Relevance — off-task content vs prompt/context. 0=on-task, 1=minor tangent, 2=repeated tangents, 3=major sections off-task, 4=largely irrelevant.\n- Factuality — inaccuracies, hallucinations, misleading claims. 0=accurate, 1=minor imprecision, 2=1–2 inaccuracies, 3=multiple inaccuracies, 4=core fabrications.\n- Bias/Subjectivity — unjustified one-sidedness or missing perspective. 0=balanced, 1=minor skew, 2=notable skew, 3=strong skew harming usefulness, 4=pervasive stance.\n- Structure — repetition or templated syntax. 0=varied, 1=mild repetition, 2=noticeable templating, 3=frequent templated blocks, 4=formulaic skeleton.\n- Coherence — logical flow and organisation. 0=flows, 1=small bump, 2=local confusion, 3=hard to follow overall, 4=incoherent/contradictory.\n- Tone (fluency/verbosity/complexity) — style fit. 0=natural, 1=slight mismatch, 2=recurring awkwardness, 3=widespread unnatural/verbose/jargony, 4=pervasive mismatch impeding comprehension.\nScoring instructions: use span-level evidence, quote minimally, and keep rationales ≤25 words. Respect automatic signals when weighing Density, Bias, Structure, Tone, but override with clear textual evidence. Domain weighting: news prioritises Density/Relevance/Tone/Coherence/Bias; QA emphasises Factuality/Structure; "other" balances all axes. After scoring, set annoyance 1–5 (1=not annoying, 5=very annoying) and decide overall_slop.label (1 if weighted risk suggests notable slop, otherwise 0). Provide top fixes as short imperative suggestions ordered by impact. Return valid JSON only.`;

const FEW_SHOT_EXAMPLE = `Example (news, clean)
DOMAIN: news
CONTEXT: none
TEXT: <<<Short bulletin summarising a local council vote with specific results.>>>
AUTO_SIGNALS:
- tokens: 54, sentences: 4
- info_entropy_mean: 4.7, idea_density: 0.640
- repetition_compression_ratio: 0.360, templates_per_token: 0.000
- subj_lexicon_ratio: 0.020
- avg_sentence_len: 13.500
- flesch_reading_ease / fk_grade / gunning_fog: 62.30 / 8.60 / 10.10
RETURN: {"overall_slop":{"label":0,"confidence":0.72},"domain":"news","annoyance":1,"axes":[{"code":"Density","score_0_to_4":0,"auto_signals":{"tokens":54,"info_entropy_mean":4.7},"spans":[],"rationale":"Concise report with specific outcomes."},{"code":"Relevance","score_0_to_4":0,"spans":[],"rationale":"All sentences address the council vote."},{"code":"Factuality","score_0_to_4":0,"spans":[],"rationale":"No factual disputes detected."},{"code":"Bias","score_0_to_4":0,"spans":[],"rationale":"Neutral phrasing without stance."},{"code":"Structure","score_0_to_4":0,"spans":[],"rationale":"Sentence structures vary."},{"code":"Coherence","score_0_to_4":0,"spans":[],"rationale":"Flow is chronological and clear."},{"code":"Tone","score_0_to_4":0,"auto_signals":{"avg_sentence_len":13.5},"spans":[],"rationale":"Straightforward newsroom tone."}],"top_fixes":[]}

Example (qa, slop)
DOMAIN: qa
CONTEXT: Question: "How can I improve my marathon time?"
TEXT: <<<Running is great for your mood and heart. Staying happy helps you keep jogging regularly. Remember to hydrate every single day and visualise the finish line.>>>
AUTO_SIGNALS:
- tokens: 41, sentences: 3
- info_entropy_mean: 4.214, idea_density: 0.463
- repetition_compression_ratio: 0.411, templates_per_token: 0.024
- subj_lexicon_ratio: 0.073
- avg_sentence_len: 13.667
- flesch_reading_ease / fk_grade / gunning_fog: 71.20 / 7.41 / 9.43
RETURN: {"overall_slop":{"label":1,"confidence":0.78},"domain":"qa","annoyance":3,"axes":[{"code":"Density","score_0_to_4":2,"auto_signals":{"idea_density":0.463},"spans":[{"quote":"Staying happy helps you keep jogging regularly.","char_start":48,"char_end":98}],"rationale":"Platitudes repeat without concrete training actions."},{"code":"Relevance","score_0_to_4":3,"spans":[{"quote":"Running is great for your mood and heart.","char_start":0,"char_end":42}],"rationale":"Health benefits dodge the marathon pacing request."},{"code":"Factuality","score_0_to_4":0,"spans":[],"rationale":"Advice is generic but not false."},{"code":"Bias","score_0_to_4":0,"spans":[],"rationale":"No stance issues."},{"code":"Structure","score_0_to_4":1,"spans":[{"quote":"Remember to hydrate every single day and visualise the finish line.","char_start":100,"char_end":176}],"rationale":"List-like imperative echoing motivational script."},{"code":"Coherence","score_0_to_4":1,"spans":[{"quote":"Staying happy helps you keep jogging regularly.","char_start":48,"char_end":98}],"rationale":"Loose connection between sentences."},{"code":"Tone","score_0_to_4":2,"auto_signals":{"subj_lexicon_ratio":0.073},"spans":[{"quote":"visualise the finish line","char_start":145,"char_end":173}],"rationale":"Motivational jargon outweighs actionable coaching."}],"top_fixes":["Explain pacing or interval work","Replace platitudes with concrete drills"]}`;

function formatAutoSignals(signals: SlopAutoSignals): string {
	const lines: string[] = [
		`- tokens: ${signals.tokens}, sentences: ${signals.sentences}`,
		`- info_entropy_mean: ${signals.info_entropy_mean.toFixed(3)}, info_entropy_cv: ${signals.info_entropy_cv.toFixed(3)}`,
		`- idea_density: ${signals.idea_density.toFixed(3)}`,
		`- repetition_compression_ratio: ${signals.repetition_compression_ratio.toFixed(3)}`,
		`- templates_per_token: ${signals.templates_per_token.toFixed(3)}`,
		`- subj_lexicon_ratio: ${signals.subj_lexicon_ratio.toFixed(3)}`,
		`- avg_sentence_len: ${signals.avg_sentence_len.toFixed(3)}`,
		`- flesch_reading_ease / fk_grade / gunning_fog: ${signals.flesch_reading_ease.toFixed(2)} / ${signals.fk_grade.toFixed(2)} / ${signals.gunning_fog.toFixed(2)}`,
		`- complex_word_ratio: ${signals.complex_word_ratio.toFixed(3)}, syllables_per_word: ${signals.syllables_per_word.toFixed(3)}`
	];
	return lines.join('\n');
}

function buildUserPrompt({
	request,
	autoSignals
}: {
	request: SlopJudgeRequest;
	autoSignals: SlopAutoSignals;
}): string {
	const context = request.context.trim() ? request.context.trim() : 'none';
	return [
		`DOMAIN: ${request.domain}`,
		`CONTEXT: ${context}`,
		`TEXT: <<<${request.text}>>>`,
		'',
		'AUTO_SIGNALS:',
		formatAutoSignals(autoSignals),
		'',
		'RETURN: Valid JSON per schema. Do not add commentary.'
	].join('\n');
}

function toParts(userPrompt: string): Part[] {
	return [{ text: `${SYSTEM_PROMPT}\n\n${FEW_SHOT_EXAMPLE}` }, { text: userPrompt }];
}

export const DOMAIN_WEIGHTS: Record<'news' | 'qa' | 'other', Record<SlopAxisCode, number>> = {
	news: {
		Density: 0.2,
		Relevance: 0.2,
		Tone: 0.2,
		Coherence: 0.15,
		Bias: 0.15,
		Structure: 0.05,
		Factuality: 0.05
	},
	qa: {
		Density: 0.1,
		Relevance: 0.1,
		Tone: 0.1,
		Coherence: 0.05,
		Bias: 0.05,
		Structure: 0.25,
		Factuality: 0.35
	},
	other: {
		Density: 0.16,
		Relevance: 0.16,
		Tone: 0.16,
		Coherence: 0.14,
		Bias: 0.14,
		Structure: 0.12,
		Factuality: 0.12
	}
};

export const SLOP_THRESHOLD = 0.5;

export async function runSlopJudge(options: {
	request: SlopJudgeRequest;
	autoSignals: SlopAutoSignals;
}): Promise<SlopJudgeResponse> {
	const userPrompt = buildUserPrompt(options);
	const parts = toParts(userPrompt);

	const response = await runGeminiCall((client) =>
		client.models.generateContent({
			model: 'gemini-2.5-pro',
			contents: [
				{
					role: 'user',
					parts
				}
			],
			config: {
				responseMimeType: 'application/json',
				responseSchema: SLOP_JUDGE_SCHEMA,
				temperature: 0.15
			}
		})
	);

	const text = response.text;
	if (!text) {
		throw new Error('Gemini did not return a response for the slop judge request.');
	}
	const parsed = JSON.parse(text) as unknown;
	return SlopJudgeResponseSchema.parse(parsed);
}
