import { json, type RequestHandler } from '@sveltejs/kit';
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
	switch (task.type) {
		case 'generateQuiz': {
			const { userId, quizId } = task.generateQuiz;
			console.log(`[internal task] generateQuiz userId=${userId} quizId=${quizId}`);
			break;
		}
		default: {
			// Exhaustiveness guard via discriminated union; unreachable
			return json({ error: 'unsupported_task' }, { status: 400 });
		}
	}

	return json({ status: 'accepted' }, { status: 202 });
};
