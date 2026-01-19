import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const raw = params.channelId;
	const channelId = raw && raw.trim().length > 0 ? raw : null;

	return { channelId };
};
