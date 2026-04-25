import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getDiagnosticStatus } from '$lib/server/diagnostic/service';
import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const status = await getDiagnosticStatus(authResult.user.uid);
	return json(status, { status: 200 });
};
