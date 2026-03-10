import type { PageServerLoad } from './$types';
import { getCurrentBuildInfo } from '$lib/server/buildInfo';
import { fetchTaskRunnerInfo } from '$lib/server/taskService';

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	return 'Unknown error';
}

export const load: PageServerLoad = async () => {
	const uiBuildInfo = getCurrentBuildInfo();
	const loadedAt = new Date().toISOString();

	try {
		return {
			uiBuildInfo,
			loadedAt,
			taskRunnerInfo: await fetchTaskRunnerInfo(),
			taskRunnerInfoError: null
		};
	} catch (error) {
		console.warn('Task runner build info unavailable on /admin', error);
		return {
			uiBuildInfo,
			loadedAt,
			taskRunnerInfo: null,
			taskRunnerInfoError: getErrorMessage(error)
		};
	}
};
