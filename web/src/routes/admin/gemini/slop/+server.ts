import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	SlopJudgeRequestSchema,
	type SlopAxisCode,
	type SlopJudgeRequest,
	type SlopJudgeResponse
} from '$lib/types/slop';
import { computeAutoSignals } from '$lib/utils/textMetrics';
import { DOMAIN_WEIGHTS, runSlopJudge, SLOP_THRESHOLD } from '$lib/server/llm/slopJudge';

function computeWeightedRisk(response: SlopJudgeResponse, request: SlopJudgeRequest) {
	const weights = DOMAIN_WEIGHTS[request.domain];
	let risk = 0;
	for (const [axis, weight] of Object.entries(weights) as Array<[SlopAxisCode, number]>) {
		const match = response.axes.find((item) => item.code === axis);
		const normalised = match ? Math.min(Math.max(match.score_0_to_4 / 4, 0), 1) : 0;
		risk += normalised * weight;
	}
	return {
		risk,
		threshold: SLOP_THRESHOLD,
		weights
	};
}

export const POST: RequestHandler = async ({ request }) => {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch (error) {
		console.warn('Invalid slop judge payload', error);
		return json({ error: 'Invalid JSON payload.' }, { status: 400 });
	}

	const parsed = SlopJudgeRequestSchema.safeParse(payload);
	if (!parsed.success) {
		return json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const judgeRequest = parsed.data;
	const autoSignals = computeAutoSignals(judgeRequest.text);

	try {
		const result = await runSlopJudge({ request: judgeRequest, autoSignals });
		const weightedRisk = computeWeightedRisk(result, judgeRequest);
		const computedLabel = weightedRisk.risk >= weightedRisk.threshold ? 1 : 0;
		return json({ result, autoSignals, weightedRisk, computedLabel });
	} catch (error) {
		console.error('Failed to run slop judge', error);
		return json({ error: 'Gemini evaluation failed.' }, { status: 502 });
	}
};
