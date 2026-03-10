import type { PageServerLoad } from './$types';
import { getCurrentBuildInfo } from '$lib/server/buildInfo';

export const load: PageServerLoad = async () => {
	return {
		uiBuildInfo: getCurrentBuildInfo(),
		loadedAt: new Date().toISOString()
	};
};
