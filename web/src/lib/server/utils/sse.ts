type SseEvent = {
	event?: string;
	data?: string;
	id?: string;
	retry?: number;
};

type SseStream = {
	stream: ReadableStream<Uint8Array>;
	send: (event: SseEvent) => void;
	close: () => void;
};

function encodeEvent(event: SseEvent): Uint8Array {
	const lines: string[] = [];
	if (event.id) {
		lines.push(`id: ${event.id}`);
	}
	if (event.event) {
		lines.push(`event: ${event.event}`);
	}
	if (typeof event.retry === 'number') {
		lines.push(`retry: ${event.retry}`);
	}
	const payload = event.data ?? '';
	const dataLines = payload.split(/\r?\n/u);
	for (const line of dataLines) {
		lines.push(`data: ${line}`);
	}
	lines.push('');
	const encoder = new TextEncoder();
	return encoder.encode(`${lines.join('\n')}\n`);
}

export function createSseStream(options?: { signal?: AbortSignal }): SseStream {
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let closed = false;

	const stream = new ReadableStream<Uint8Array>({
		start(ctrl) {
			controller = ctrl;
		},
		cancel() {
			closed = true;
		}
	});

	const send = (event: SseEvent) => {
		if (!controller || closed) {
			return;
		}
		controller.enqueue(encodeEvent(event));
	};

	const close = () => {
		if (!controller || closed) {
			return;
		}
		closed = true;
		controller.close();
	};

	if (options?.signal) {
		if (options.signal.aborted) {
			close();
		} else {
			options.signal.addEventListener('abort', close, { once: true });
		}
	}

	return { stream, send, close };
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
}
