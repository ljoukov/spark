import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	DiagnosticProfileSaveRequestSchema,
	saveDiagnosticProfile,
	serializeDiagnosticProfileForClient
} from '$lib/server/diagnostic/service';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

export const PUT: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let input: z.infer<typeof DiagnosticProfileSaveRequestSchema>;
	try {
		input = DiagnosticProfileSaveRequestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	try {
		const profile = await saveDiagnosticProfile(authResult.user.uid, input);
		return json({ profile: serializeDiagnosticProfileForClient(profile) }, { status: 200 });
	} catch (error) {
		console.error('[diagnostic] failed to save diagnostic profile', {
			userId: authResult.user.uid,
			error
		});
		return json({ error: 'diagnostic_profile_save_failed' }, { status: 500 });
	}
};
