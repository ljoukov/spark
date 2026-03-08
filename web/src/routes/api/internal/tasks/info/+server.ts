import { json, type RequestHandler } from '@sveltejs/kit';
import { getCurrentBuildInfo } from '$lib/server/buildInfo';

export const GET: RequestHandler = async () => {
	return json(
		{
			build: getCurrentBuildInfo()
		},
		{ status: 200 }
	);
};
