import { tts, ttsRequestSchema } from '@spark/llm';
import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const input = (url.searchParams.get('input') ?? '').trim();
	const voice = (url.searchParams.get('voice') ?? '').trim();

	if (!input) {
		return json({ error: 'invalid_request', message: 'input is required' }, { status: 400 });
	}

	const parsed = ttsRequestSchema.safeParse({ input, voice });
	if (!parsed.success) {
		return json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
	}

	try {
		const stream = await tts(parsed.data);
		return new Response(stream, {
			headers: {
				'Cache-Control': 'no-store',
				'Content-Type': 'audio/mpeg',
				'Content-Disposition': 'inline; filename="spark-tts.mp3"'
			}
		});
	} catch (error) {
		console.error('[admin tts] synthesis failed', error);
		return json(
			{
				error: 'tts_failed',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
