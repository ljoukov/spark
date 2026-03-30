import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { loadSparkSheetPageState } from '$lib/server/grader/sheetPageState';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

export const GET: RequestHandler = async ({ request, params }) => {
	const auth = await authenticateApiRequest(request);
	if (!auth.ok) {
		return auth.response;
	}

	try {
		const { sheetId } = paramsSchema.parse(params);
		const state = await loadSparkSheetPageState({
			userId: auth.user.uid,
			sheetId
		});
		if (!state) {
			return json({ error: 'sheet_not_found' }, { status: 404 });
		}
		return json(state);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		console.error('Failed to load sheet state', {
			error
		});
		return json(
			{ error: 'state_load_failed', message: 'Unable to load worksheet state.' },
			{ status: 500 }
		);
	}
};
