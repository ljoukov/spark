import { TASKS_INFO_PATH, createTask, fetchTaskService, resolveTaskServiceUrl } from '@spark/llm';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { TaskServiceInfoResponseSchema, getCurrentBuildInfo } from '$lib/server/buildInfo';

const startWelcomeSessionSchema = z.object({
	topic: z.string().trim().min(1, 'Topic is required')
});

function requireTasksEnv(): { serviceUrl: string; apiKey: string } {
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

async function fetchTaskRunnerInfo(): Promise<{
	build: z.infer<typeof TaskServiceInfoResponseSchema>['build'];
	endpointUrl: string;
}> {
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

export const load: PageServerLoad = async () => {
	return {
		uiBuildInfo: getCurrentBuildInfo(),
		loadedAt: new Date().toISOString()
	};
};

export const actions: Actions = {
	startHelloWorld: async () => {
		try {
			const tasksEnv = requireTasksEnv();
			await createTask({
				type: 'helloWorld'
			}, {
				serviceUrl: tasksEnv.serviceUrl,
				apiKey: tasksEnv.apiKey,
				serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ''
			});
			return { success: { message: 'Started Hello World task.' } as const };
		} catch (error) {
			console.error('Failed to enqueue helloWorld task', error);
			return fail(500, { error: 'Failed to start Hello World task.' });
		}
	},
	startWelcomeSession: async ({ request }) => {
		const formData = await request.formData();
		const parsed = startWelcomeSessionSchema.safeParse({
			topic: typeof formData.get('topic') === 'string' ? formData.get('topic') : ''
		});

		if (!parsed.success) {
			const [issue] = parsed.error.issues;
			return fail(400, { error: issue?.message ?? 'Topic is required.' });
		}

		const topic = parsed.data.topic;
		try {
			const tasksEnv = requireTasksEnv();
			await createTask({
				type: 'generateWelcomeSession',
				generateWelcomeSession: { topic }
			}, {
				serviceUrl: tasksEnv.serviceUrl,
				apiKey: tasksEnv.apiKey,
				serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ''
			});
			return {
				success: { message: `Started welcome session generation for "${topic}".` } as const
			};
		} catch (error) {
			console.error('Failed to enqueue welcome session generation task', { error, topic });
			return fail(500, { error: 'Failed to start welcome session generation.' });
		}
	},
	fetchTaskRunnerInfo: async () => {
		try {
			const taskRunnerInfo = await fetchTaskRunnerInfo();
			return {
				success: { message: 'Fetched task runner build info.' } as const,
				taskRunnerInfo
			};
		} catch (error) {
			console.error('Failed to fetch task runner build info', error);
			return fail(500, { error: 'Failed to retrieve task runner build info.' });
		}
	}
};
