import { createTask } from '@spark/llm';
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	startHelloWorld: async () => {
		try {
			await createTask({
				type: 'helloWorld'
			});
			return { success: true as const };
		} catch (error) {
			console.error('Failed to enqueue helloWorld task', error);
			return fail(500, { error: 'Failed to start Hello World task.' });
		}
	}
};
