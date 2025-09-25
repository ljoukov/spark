import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';

import { computeSlopAutoSignals } from '$lib/slop/metrics';
import { evaluateSlop } from '$lib/server/llm/slopJudge';

const RequestSchema = z.object({
	text: z.string().trim().min(20, 'Provide at least 20 characters to evaluate.'),
	context: z.string().trim().optional(),
	domain: z.enum(['news', 'qa', 'other'])
});

export const POST: RequestHandler = async ({ request }) => {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ error: 'Invalid JSON payload.' }, { status: 400 });
	}
	const parsed = RequestSchema.safeParse(payload);
	if (!parsed.success) {
		const issues = parsed.error.flatten();
		return json({ error: 'Validation failed.', issues }, { status: 400 });
	}

	const { text, context, domain } = parsed.data;
	const autoSignals = computeSlopAutoSignals(text);
	try {
		const result = await evaluateSlop({
			text,
			context,
			domain,
			autoSignals
		});
		return json({ result, autoSignals });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unable to run slop detection.';
		return json({ error: message }, { status: 500 });
	}
};
