import { registerCheckMateRoutes } from '$lib/server/rpc/checkmateService';
import { logServerEvent } from '$lib/server/utils/logger';
import { createConnectRouter } from '@connectrpc/connect';
import { createFetchHandler } from '@connectrpc/connect/protocol';
import type { RequestEvent } from '@sveltejs/kit';

const requestPathPrefix = '/api/cm/rpc';
const router = createConnectRouter({
	connect: true,
	grpc: false,
	grpcWeb: false
});

registerCheckMateRoutes(router);

const handlers = new Map(
	router.handlers.map((handler) => [requestPathPrefix + handler.requestPath, handler])
);

async function handle(event: RequestEvent): Promise<Response> {
	const url = new URL(event.request.url);
	const handler = handlers.get(url.pathname);
	if (!handler) {
		logServerEvent({
			level: 'warn',
			message: 'CheckMate RPC handler not found.',
			context: {
				path: url.pathname
			}
		});
		return new Response(null, { status: 404 });
	}
	return createFetchHandler(handler, { httpVersion: '1.1' })(event.request);
}

export const POST = handle;
export const GET = handle;
