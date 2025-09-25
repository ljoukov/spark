import { type Part } from '@google/genai';

import { computeSlopAutoSignals } from '$lib/slop/metrics';
import {
	DEFAULT_SLOP_RISK_THRESHOLD,
	buildSlopJudgePrompt,
	computeWeightedRisk,
	parseSlopJudgement,
	toPartsFromPrompt
} from '$lib/slop/judge';
import type { SlopAutoSignals, SlopJudgement } from '$lib/llm/schemas';

import { runGeminiCall } from '../utils/gemini';

export interface SlopJudgeOptions {
	readonly domain: 'news' | 'qa' | 'other';
	readonly text: string;
	readonly context?: string | null;
	readonly requestId?: string;
	readonly autoSignals?: SlopAutoSignals;
}

export interface SlopJudgeResult {
	readonly judgement: SlopJudgement;
	readonly autoSignals: SlopAutoSignals;
	readonly riskScore: number;
	readonly recommendedLabel: 0 | 1;
	readonly threshold: number;
	readonly contributions: ReturnType<typeof computeWeightedRisk>['contributions'];
}

export async function runSlopJudge(options: SlopJudgeOptions): Promise<SlopJudgeResult> {
	const autoSignals = options.autoSignals ?? computeSlopAutoSignals(options.text);
	const prompt = buildSlopJudgePrompt({
		domain: options.domain,
		text: options.text,
		context: options.context,
		autoSignals,
		requestId: options.requestId
	});
	const parts: Part[] = toPartsFromPrompt(prompt);
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
				temperature: 0.1
			}
		})
	);
	const text = response.text;
	if (!text) {
		throw new Error('Gemini slop judge returned empty response');
	}
	const judgement = parseSlopJudgement(text);
	const { riskScore, contributions } = computeWeightedRisk(judgement, options.domain);
	const recommendedLabel: 0 | 1 = riskScore >= DEFAULT_SLOP_RISK_THRESHOLD ? 1 : 0;
	return {
		judgement,
		autoSignals,
		riskScore,
		recommendedLabel,
		threshold: DEFAULT_SLOP_RISK_THRESHOLD,
		contributions
	};
}
