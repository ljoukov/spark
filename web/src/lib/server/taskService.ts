import { env } from '$env/dynamic/private';
import { TASKS_INFO_PATH, fetchTaskService, resolveTaskServiceUrl } from '@spark/llm';
import type { TaskServiceInfoResponse } from '$lib/server/buildInfo';
import { TaskServiceInfoResponseSchema } from '$lib/server/buildInfo';

export type TaskRunnerInfo = {
	build: TaskServiceInfoResponse['build'];
	endpointUrl: string;
};

export function requireTasksEnv(): { serviceUrl: string; apiKey: string } {
	const serviceUrl = env.TASKS_SERVICE_URL ?? '';
	if (serviceUrl.trim().length === 0) {
		throw new Error('TASKS_SERVICE_URL is missing');
	}

	const apiKey = env.TASKS_API_KEY ?? '';
	if (apiKey.trim().length === 0) {
		throw new Error('TASKS_API_KEY is missing');
	}

	return { serviceUrl, apiKey };
}

export async function fetchTaskRunnerInfo(): Promise<TaskRunnerInfo> {
	const tasksEnv = requireTasksEnv();
	const endpointUrl = resolveTaskServiceUrl(tasksEnv.serviceUrl, {
		pathname: TASKS_INFO_PATH
	});
	const response = await fetchTaskService({
		serviceUrl: tasksEnv.serviceUrl,
		apiKey: tasksEnv.apiKey,
		pathname: TASKS_INFO_PATH,
		method: 'GET'
	});
	const bodyText = await response.text();
	if (!response.ok) {
		throw new Error(
			`Task service returned ${response.status.toString()} ${response.statusText}: ${bodyText}`
		);
	}

	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(bodyText);
	} catch (error) {
		throw new Error(
			`Task service returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}

	const parsed = TaskServiceInfoResponseSchema.safeParse(parsedBody);
	if (!parsed.success) {
		throw new Error(`Task service returned invalid build info: ${parsed.error.message}`);
	}

	return {
		build: parsed.data.build,
		endpointUrl
	};
}
