import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const now = new Date();
	return {
		todayIso: now.toISOString()
	};
};
