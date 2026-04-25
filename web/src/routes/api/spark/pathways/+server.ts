import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	createPathwayForUser,
	hasPathwayPersistenceConfig,
	listPathwaysForUser,
	serializePathwayForClient,
	serializePathwaysForClient,
	UnsupportedPathwaySelectionError
} from '$lib/server/pathways/service';
import { json, type RequestHandler } from '@sveltejs/kit';
import { SparkLearningProfileSelectionSchema } from '@spark/schemas';
import { z } from 'zod';

const requestSchema = z
	.object({
		selection: SparkLearningProfileSelectionSchema
	})
	.strict();

export const GET: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	if (!hasPathwayPersistenceConfig()) {
		return json(
			{ error: 'pathways_unavailable', message: 'Pathways storage is not configured.' },
			{ status: 503 }
		);
	}

	const pathways = await listPathwaysForUser(authResult.user.uid);
	return json({ pathways: serializePathwaysForClient(pathways) }, { status: 200 });
};

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	if (!hasPathwayPersistenceConfig()) {
		return json(
			{ error: 'pathways_unavailable', message: 'Pathways storage is not configured.' },
			{ status: 503 }
		);
	}

	let body: z.infer<typeof requestSchema>;
	try {
		body = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	try {
		const pathway = await createPathwayForUser({
			userId: authResult.user.uid,
			selection: body.selection
		});
		return json({ pathway: serializePathwayForClient(pathway) }, { status: 201 });
	} catch (error) {
		if (error instanceof UnsupportedPathwaySelectionError) {
			return json(
				{
					error: 'unsupported_pathway_selection',
					message: 'Pathways currently support UK AQA GCSE Triple Science subjects.'
				},
				{ status: 400 }
			);
		}
		console.error('[pathways] failed to create pathway', {
			error,
			userId: authResult.user.uid
		});
		return json(
			{ error: 'pathway_creation_failed', message: 'Unable to create this study path.' },
			{ status: 500 }
		);
	}
};
