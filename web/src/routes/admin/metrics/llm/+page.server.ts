import type { PageServerLoad } from './$types';
import { loadLlmMetricsDashboard, resolveMetricsWindow } from '$lib/server/admin/metrics';

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return 'Unknown error';
}

export const load: PageServerLoad = async ({ url }) => {
	const windowKey = resolveMetricsWindow(url);
	try {
		return {
			windowKey,
			dashboard: await loadLlmMetricsDashboard(windowKey),
			error: null
		};
	} catch (error) {
		console.warn('LLM metrics failed to load', error);
		return {
			windowKey,
			dashboard: null,
			error: getErrorMessage(error)
		};
	}
};
