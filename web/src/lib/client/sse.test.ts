import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamSse, type SseEvent } from './sse';

function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
}

function mockSseResponse(chunks: readonly string[]): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			return new Response(streamFromChunks(chunks), {
				status: 200,
				headers: { 'content-type': 'text/event-stream' }
			});
		})
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('streamSse', () => {
	it('preserves token-leading spaces in data payloads', async () => {
		mockSseResponse([
			'event: thought\n',
			'data:  leading\n',
			'\n',
			'event: thought\n',
			'data:   spaces\n',
			'\n'
		]);
		const events: SseEvent[] = [];

		await streamSse(
			'/sse',
			{ method: 'POST' },
			{
				onEvent: (event) => {
					events.push(event);
				}
			}
		);

		expect(events).toEqual([
			{ event: 'thought', data: ' leading' },
			{ event: 'thought', data: '  spaces' }
		]);
	});

	it('keeps whitespace-only deltas in trailing blocks', async () => {
		mockSseResponse(['event: text\ndata:  \n']);
		const events: SseEvent[] = [];

		await streamSse(
			'/sse',
			{ method: 'POST' },
			{
				onEvent: (event) => {
					events.push(event);
				}
			}
		);

		expect(events).toEqual([{ event: 'text', data: ' ' }]);
	});
});
