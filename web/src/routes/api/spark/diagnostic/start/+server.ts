import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	DiagnosticStartRequestSchema,
	serializeDiagnosticTestForClient,
	startDiagnosticTest
} from '$lib/server/diagnostic/service';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let input: z.infer<typeof DiagnosticStartRequestSchema>;
	try {
		input = DiagnosticStartRequestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	try {
		const diagnostic = await startDiagnosticTest({
			userId: authResult.user.uid,
			input
		});
		return json({ diagnostic: serializeDiagnosticTestForClient(diagnostic) }, { status: 201 });
	} catch (error) {
		console.error('[diagnostic] failed to start diagnostic test', {
			userId: authResult.user.uid,
			error
		});
		return json({ error: 'diagnostic_start_failed' }, { status: 500 });
	}
};
