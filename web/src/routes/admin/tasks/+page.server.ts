import { createTask } from '@spark/llm';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions } from './$types';

const startWelcomeSessionSchema = z.object({
	topic: z.string().trim().min(1, 'Topic is required')
});

export const actions: Actions = {
	startHelloWorld: async () => {
		try {
			await createTask({
				type: 'helloWorld'
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
			await createTask({
				type: 'generateWelcomeSession',
				generateWelcomeSession: { topic }
			});
			return {
				success: { message: `Started welcome session generation for "${topic}".` } as const
			};
		} catch (error) {
			console.error('Failed to enqueue welcome session generation task', { error, topic });
			return fail(500, { error: 'Failed to start welcome session generation.' });
		}
	}
};
