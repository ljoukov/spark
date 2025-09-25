import { Type, type Part, type Schema } from '@google/genai';

import {
	SLOP_AXIS_CODES,
	SLOP_AUTO_SIGNAL_KEYS,
	SlopJudgementSchema,
	type SlopAxisCode,
	type SlopAutoSignals,
	type SlopJudgement
} from '$lib/llm/schemas';

const RUBRIC_LINES = [
	'Density — flag filler or low-information wording. 0=clean, 4=pervasive filler.',
	'Relevance — stays on task; penalise tangents. 0=on-task, 4=mostly irrelevant.',
	'Factuality — accuracy and hallucinations. 0=correct, 4=core fabrications.',
	'Bias — unjustified subjectivity or missing POV. 0=balanced, 4=pervasive skew.',
	'Structure — repetition or templated phrasing. 0=varied, 4=formulaic skeleton.',
	'Coherence — logical flow. 0=flows, 4=incoherent or contradictory.',
	'Tone — fluency, verbosity, complexity. 0=natural, 4=burdens comprehension.'
];

const SCALE_LINES = [
	'0 — no issue observed.',
	'1 — slight issue; isolated.',
	'2 — recurring issue in local spans.',
	'3 — major issue across sections.',
	'4 — severe issue dominating the text.'
];

const DOMAIN_WEIGHTING_GUIDANCE = [
	'News: emphasise Density, Relevance, Tone, Coherence, Bias.',
	'QA: emphasise Factuality and Structure; Density/Relevance secondary.',
	'Other: average of the two profiles.'
];

export interface BuildSlopJudgePromptOptions {
	readonly domain: 'news' | 'qa' | 'other';
	readonly text: string;
	readonly context?: string | null;
	readonly autoSignals: SlopAutoSignals;
	readonly requestId?: string;
}

function formatAutoSignals(signals: SlopAutoSignals): string {
	return SLOP_AUTO_SIGNAL_KEYS.map((key) => `- ${key}: ${signals[key] ?? 0}`).join('\n');
}

export function buildSlopJudgePrompt(options: BuildSlopJudgePromptOptions): string {
	const contextBlock = options.context?.trim()?.length
		? `CONTEXT: ${options.context}`
		: 'CONTEXT: none';
	const textBlock = `TEXT: <<<${options.text}>>>`;
	const autoSignalsBlock = `AUTO_SIGNALS:\n${formatAutoSignals(options.autoSignals)}`;
	const requestLine = options.requestId ? `REQUEST_ID: ${options.requestId}` : null;
	return [
		'You are a meticulous copy editor. Judge the quality of the given text — not whether it is AI-written.',
		'Work in three passes: (1) skim and summarise the purpose/audience; (2) extract minimal spans proving issues; (3) score each axis 0-4 with ≤25 word rationale, then produce JSON.',
		'General guidance: focus on reader value, consider context, and code the single most significant issue per span. Prefer precise spans over long quotes.',
		'Rubric:',
		...RUBRIC_LINES.map((line) => `- ${line}`),
		'Scoring scale:',
		...SCALE_LINES.map((line) => `- ${line}`),
		'Domain weighting guidance:',
		...DOMAIN_WEIGHTING_GUIDANCE.map((line) => `- ${line}`),
		'When quoting spans include char_start and char_end indices from the TEXT block (0-indexed, inclusive/exclusive).',
		'For each axis include an auto_signals array of {"name":<metric>,"value":<number>} entries (max 4) using the most relevant metrics from AUTO_SIGNALS.',
		'After scoring compute domain-weighted risk = Σ((score/4)×weight). Use threshold 0.55 to set overall_slop.label (1=slop,0=clean). Confidence should reflect certainty in that label.',
		'Return JSON only, matching the schema.',
		`DOMAIN: ${options.domain}`,
		contextBlock,
		textBlock,
		autoSignalsBlock,
		requestLine,
		'RETURN: {"overall_slop":{"label":0|1,"confidence":0-1},"domain":"news|qa|other","annoyance":1-5,"axes":[...],"top_fixes":["..."]}'
	]
		.filter(Boolean)
		.join('\n');
}

const AUTO_SIGNAL_ENTRY_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		name: { type: Type.STRING },
		value: { type: Type.NUMBER }
	},
	required: ['name', 'value']
};

const AUTO_SIGNAL_SCHEMA: Schema = {
	type: Type.ARRAY,
	items: AUTO_SIGNAL_ENTRY_SCHEMA,
	maxItems: 4
};

const SPAN_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		quote: { type: Type.STRING },
		char_start: { type: Type.INTEGER },
		char_end: { type: Type.INTEGER }
	},
	required: ['quote', 'char_start', 'char_end'],
	propertyOrdering: ['quote', 'char_start', 'char_end']
};

const AXIS_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		code: { type: Type.STRING },
		score_0_to_4: { type: Type.NUMBER },
		auto_signals: AUTO_SIGNAL_SCHEMA,
		spans: { type: Type.ARRAY, items: SPAN_SCHEMA, maxItems: 6 },
		rationale: { type: Type.STRING }
	},
	required: ['code', 'score_0_to_4', 'auto_signals', 'spans', 'rationale']
};

export const SLOP_JUDGE_RESPONSE_SCHEMA: Schema = {
	type: Type.OBJECT,
	properties: {
		overall_slop: {
			type: Type.OBJECT,
			properties: {
				label: { type: Type.INTEGER },
				confidence: { type: Type.NUMBER }
			},
			required: ['label', 'confidence']
		},
		domain: { type: Type.STRING },
		annoyance: { type: Type.INTEGER },
		axes: { type: Type.ARRAY, items: AXIS_SCHEMA, maxItems: 7 },
		top_fixes: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 6 }
	},
	required: ['overall_slop', 'domain', 'annoyance', 'axes', 'top_fixes']
};

export interface WeightedAxisContribution {
	readonly code: SlopAxisCode;
	readonly score: number;
	readonly weight: number;
	readonly contribution: number;
}

const NEWS_WEIGHTS: Record<SlopAxisCode, number> = {
	Density: 0.2,
	Relevance: 0.2,
	Tone: 0.2,
	Coherence: 0.15,
	Bias: 0.15,
	Structure: 0.05,
	Factuality: 0.05
};

const QA_WEIGHTS: Record<SlopAxisCode, number> = {
	Factuality: 0.35,
	Structure: 0.25,
	Density: 0.1,
	Relevance: 0.1,
	Tone: 0.1,
	Coherence: 0.05,
	Bias: 0.05
};

function averageWeights(
	a: Record<SlopAxisCode, number>,
	b: Record<SlopAxisCode, number>
): Record<SlopAxisCode, number> {
	const result = {} as Record<SlopAxisCode, number>;
	for (const code of SLOP_AXIS_CODES) {
		result[code] = Number(((a[code] ?? 0) + (b[code] ?? 0)) / 2);
	}
	return result;
}

const OTHER_WEIGHTS = averageWeights(NEWS_WEIGHTS, QA_WEIGHTS);

export const DEFAULT_SLOP_RISK_THRESHOLD = 0.55;

export function getDomainWeights(domain: 'news' | 'qa' | 'other'): Record<SlopAxisCode, number> {
	switch (domain) {
		case 'news':
			return NEWS_WEIGHTS;
		case 'qa':
			return QA_WEIGHTS;
		default:
			return OTHER_WEIGHTS;
	}
}

export function computeWeightedRisk(
	judgement: SlopJudgement,
	domain: 'news' | 'qa' | 'other'
): { riskScore: number; contributions: WeightedAxisContribution[] } {
	const weights = getDomainWeights(domain);
	const scoreByCode = new Map<SlopAxisCode, number>();
	for (const axis of judgement.axes) {
		scoreByCode.set(axis.code, axis.score_0_to_4);
	}
	const contributions: WeightedAxisContribution[] = [];
	let riskScore = 0;
	for (const code of SLOP_AXIS_CODES) {
		const rawScore = scoreByCode.get(code) ?? 0;
		const normalized = Math.min(Math.max(rawScore / 4, 0), 1);
		const weight = weights[code] ?? 0;
		const contribution = Number((normalized * weight).toFixed(4));
		riskScore += contribution;
		contributions.push({ code, score: rawScore, weight, contribution });
	}
	return { riskScore: Number(riskScore.toFixed(4)), contributions };
}

export function toPartsFromPrompt(prompt: string): Part[] {
	return [{ text: prompt }];
}

function toAxisCode(value: unknown): SlopAxisCode | null {
	if (typeof value !== 'string') {
		return null;
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		return null;
	}
	const match = SLOP_AXIS_CODES.find((code) => code.toLowerCase() === normalized.toLowerCase());
	return match ?? null;
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

type NormalizedSpan = { quote: string; char_start: number; char_end: number };

function toSpan(value: unknown): NormalizedSpan | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const span = value as Record<string, unknown>;
	const quoteCandidate = span.quote ?? span.span;
	if (typeof quoteCandidate !== 'string' || quoteCandidate.trim().length === 0) {
		return null;
	}
	const start = toNumber(span.char_start);
	const end = toNumber(span.char_end);
	if (start === null || end === null) {
		return null;
	}
	const charStart = Math.max(0, Math.floor(start));
	const charEnd = Math.max(charStart, Math.floor(end));
	return {
		quote: quoteCandidate,
		char_start: charStart,
		char_end: charEnd
	};
}

function normaliseTopFixes(value: unknown): string[] {
	if (!value) {
		return [];
	}
	const result: string[] = [];
	const values = Array.isArray(value) ? value : [value];
	for (const entry of values) {
		if (typeof entry === 'string') {
			const trimmed = entry.trim();
			if (trimmed.length > 0) {
				result.push(trimmed);
			}
			continue;
		}
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const candidate =
			typeof (entry as { fix?: unknown }).fix === 'string'
				? (entry as { fix: string }).fix
				: typeof (entry as { text?: unknown }).text === 'string'
					? (entry as { text: string }).text
					: typeof (entry as { suggestion?: unknown }).suggestion === 'string'
						? (entry as { suggestion: string }).suggestion
						: typeof (entry as { action?: unknown }).action === 'string'
							? (entry as { action: string }).action
							: undefined;
		if (typeof candidate === 'string') {
			const trimmed = candidate.trim();
			if (trimmed.length > 0) {
				result.push(trimmed);
			}
		}
	}
	return result;
}

function normaliseSlopJudgement(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object') {
		return raw;
	}
	const parsed = raw as Record<string, unknown>;
	const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
	const spansByCode = new Map<SlopAxisCode, NormalizedSpan[]>();
	for (const issue of issues) {
		const span = toSpan(issue);
		const code =
			issue && typeof issue === 'object'
				? toAxisCode((issue as Record<string, unknown>).code)
				: null;
		if (span && code) {
			const existing = spansByCode.get(code) ?? [];
			existing.push(span);
			spansByCode.set(code, existing);
		}
	}

	const axes = Array.isArray(parsed.axes) ? parsed.axes : [];
	const normalizedAxes: Array<{
		code: SlopAxisCode;
		score_0_to_4: number;
		auto_signals: unknown;
		spans: NormalizedSpan[];
		rationale: string;
	}> = [];
	const seenCodes = new Set<SlopAxisCode>();
	for (const axis of axes) {
		if (!axis || typeof axis !== 'object') {
			continue;
		}
		const axisEntry = axis as Record<string, unknown>;
		const code = toAxisCode(axisEntry.code ?? axisEntry.axis);
		if (!code) {
			continue;
		}
		const score = Math.max(
			0,
			Math.min(4, toNumber(axisEntry.score_0_to_4 ?? axisEntry.score ?? axisEntry.value) ?? 0)
		);
		const spansSource = axisEntry.spans;
		const spans = Array.isArray(spansSource)
			? spansSource
					.map((item) => toSpan(item))
					.filter((item): item is NormalizedSpan => item !== null)
			: (spansByCode.get(code) ?? []);
		const rationaleValue =
			typeof axisEntry.rationale === 'string'
				? axisEntry.rationale
				: typeof axisEntry.reason === 'string'
					? axisEntry.reason
					: '';
		normalizedAxes.push({
			code,
			score_0_to_4: Number(score.toFixed(2)),
			auto_signals: axisEntry.auto_signals ?? axisEntry.autoSignals ?? [],
			spans,
			rationale: rationaleValue.trim().length > 0 ? rationaleValue : 'No significant issues noted.'
		});
		seenCodes.add(code);
	}
	for (const code of SLOP_AXIS_CODES) {
		if (seenCodes.has(code)) {
			continue;
		}
		normalizedAxes.push({
			code,
			score_0_to_4: 0,
			auto_signals: [],
			spans: spansByCode.get(code) ?? [],
			rationale: 'No significant issues noted.'
		});
	}

	const normalizedTopFixes = normaliseTopFixes(
		parsed.top_fixes ?? parsed.topFixes ?? parsed.recommended_fixes ?? parsed.actions
	);

	const rawDomain =
		parsed.domain ?? parsed.domain_type ?? parsed.domainType ?? parsed.domain_weighting;
	const normalizedDomain =
		typeof rawDomain === 'string' ? rawDomain.trim().toLowerCase() : undefined;
	const domain: 'news' | 'qa' | 'other' =
		normalizedDomain === 'news' || normalizedDomain === 'qa' || normalizedDomain === 'other'
			? normalizedDomain
			: 'qa';

	return {
		...parsed,
		domain,
		axes: normalizedAxes,
		top_fixes: normalizedTopFixes
	};
}

export function parseSlopJudgement(text: string): SlopJudgement {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error('Failed to parse slop judgement JSON', { cause: error });
	}
	const normalized = normaliseSlopJudgement(parsedJson);
	return SlopJudgementSchema.parse(normalized);
}
