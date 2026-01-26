export type SseEvent = {
	event: string;
	data: string;
};

type SseHandlers = {
	onEvent: (event: SseEvent) => void;
	onOpen?: (response: Response) => void;
};

function parseEventBlock(block: string): SseEvent | null {
	const lines = block.split('\n');
	let event = 'message';
	const data: string[] = [];

	for (const line of lines) {
		if (!line || line.startsWith(':')) {
			continue;
		}
		if (line.startsWith('event:')) {
			event = line.slice(6).trim();
			continue;
		}
		if (line.startsWith('data:')) {
			data.push(line.slice(5).trimStart());
		}
	}

	if (data.length === 0) {
		return null;
	}

	return { event, data: data.join('\n') };
}

export async function streamSse(
	input: RequestInfo | URL,
	init: RequestInit,
	handlers: SseHandlers
): Promise<void> {
	const headers = new Headers(init.headers ?? {});
	if (!headers.has('accept')) {
		headers.set('accept', 'text/event-stream');
	}

	const response = await fetch(input, { ...init, headers });
	if (!response.ok) {
		let message = `Request failed with status ${response.status}`;
		try {
			const payload = await response.json();
			if (payload && typeof payload === 'object' && 'message' in payload) {
				message = String(payload.message);
			}
		} catch {
			// ignore
		}
		throw new Error(message);
	}

	handlers.onOpen?.(response);

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Streaming response body unavailable');
	}

	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		buffer = buffer.replace(/\r\n/g, '\n');

		let separatorIndex = buffer.indexOf('\n\n');
		while (separatorIndex !== -1) {
			const chunk = buffer.slice(0, separatorIndex);
			buffer = buffer.slice(separatorIndex + 2);
			const event = parseEventBlock(chunk);
			if (event) {
				handlers.onEvent(event);
			}
			separatorIndex = buffer.indexOf('\n\n');
		}
	}

	const trimmed = buffer.trim();
	if (trimmed.length > 0) {
		const event = parseEventBlock(trimmed);
		if (event) {
			handlers.onEvent(event);
		}
	}
}
