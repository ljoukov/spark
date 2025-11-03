import { json, type RequestHandler } from '@sveltejs/kit';
// Import just the schema module to avoid pulling in heavy server deps
import { TaskSchema } from '@spark/llm';

export const POST: RequestHandler = async ({ request }) => {
	const bodyText = await request.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	const result = TaskSchema.safeParse(parsed);
	if (!result.success) {
		return json({ error: 'invalid_task', issues: result.error.issues }, { status: 400 });
	}

	const task = result.data;
	if (task.type === 'generateQuiz') {
		const { userId, quizId } = task.generateQuiz;
		console.log(`[internal task] generateQuiz userId=${userId} quizId=${quizId}`);
	} else {
		console.log('[internal task] Hello World');
	}

	return json({ status: 'accepted' }, { status: 202 });
};
