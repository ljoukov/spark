import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	DiagnosticSubmitRequestSchema,
	serializeDiagnosticTestForClient,
	submitDiagnosticSheet
} from '$lib/server/diagnostic/service';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z.object({
	diagnosticId: z.string().trim().min(1)
});

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_params', issues: parsedParams.error.issues }, { status: 400 });
	}

	let input: z.infer<typeof DiagnosticSubmitRequestSchema>;
	try {
		input = DiagnosticSubmitRequestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	try {
		const diagnostic = await submitDiagnosticSheet({
			userId: authResult.user.uid,
			testId: parsedParams.data.diagnosticId,
			input
		});
		return json({ diagnostic: serializeDiagnosticTestForClient(diagnostic) }, { status: 200 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'diagnostic_test_not_found' || message === 'diagnostic_sheet_not_found') {
			return json({ error: message }, { status: 404 });
		}
		if (message === 'diagnostic_sheet_out_of_sequence') {
			return json({ error: message }, { status: 409 });
		}
		console.error('[diagnostic] failed to submit diagnostic sheet', {
			userId: authResult.user.uid,
			testId: parsedParams.data.diagnosticId,
			error
		});
		return json({ error: 'diagnostic_submit_failed' }, { status: 500 });
	}
};
