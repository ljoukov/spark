import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	createNextPathwaySheetForUser,
	hasPathwayPersistenceConfig,
	PathwayCompleteError,
	PathwayNotFoundError,
	serializePathwayForClient
} from '$lib/server/pathways/service';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const paramsSchema = z
	.object({
		pathwayId: z.string().trim().min(1)
	})
	.strict();

const requestSchema = z
	.object({
		unitId: z.string().trim().min(1).optional()
	})
	.strict();

export const POST: RequestHandler = async ({ params, request }) => {
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

	const parsedParams = paramsSchema.safeParse(params);
	if (!parsedParams.success) {
		return json({ error: 'invalid_pathway', issues: parsedParams.error.issues }, { status: 400 });
	}

	let body: z.infer<typeof requestSchema>;
	try {
		const rawBody = await request.json().catch(() => ({}));
		body = requestSchema.parse(rawBody);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body' }, { status: 400 });
	}

	try {
		const result = await createNextPathwaySheetForUser({
			userId: authResult.user.uid,
			pathwayId: parsedParams.data.pathwayId,
			unitId: body.unitId
		});
		return json(
			{
				runId: result.runId,
				href: result.href,
				pathway: serializePathwayForClient(result.pathway)
			},
			{ status: 201 }
		);
	} catch (error) {
		if (error instanceof PathwayNotFoundError) {
			return json(
				{ error: 'pathway_not_found', message: 'That study path was not found.' },
				{ status: 404 }
			);
		}
		if (error instanceof PathwayCompleteError) {
			return json(
				{ error: 'pathway_complete', message: 'Every unit in this study path already has a sheet.' },
				{ status: 409 }
			);
		}
		console.error('[pathways] failed to start next sheet', {
			error,
			userId: authResult.user.uid,
			pathwayId: parsedParams.data.pathwayId
		});
		return json(
			{ error: 'pathway_sheet_failed', message: 'Unable to start the next worksheet.' },
			{ status: 500 }
		);
	}
};
