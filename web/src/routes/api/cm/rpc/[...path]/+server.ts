import { registerCheckMateRoutes } from '$lib/server/rpc/checkmateService';
import { createConnectRouter } from '@connectrpc/connect';
import { createFetchHandler } from '@connectrpc/connect/protocol';

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

async function handle(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const handler = handlers.get(url.pathname);
	if (!handler) {
		return new Response(null, { status: 404 });
	}
	return createFetchHandler(handler, { httpVersion: '1.1' })(request);
}

export const POST = handle;
export const GET = handle;
