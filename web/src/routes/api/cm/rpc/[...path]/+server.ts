import { registerCheckMateRoutes } from '$lib/server/rpc/checkmateService';
import { CheckMateWaitUntilContextKey } from '$lib/server/rpc/checkmateContext';
import { logServerEvent } from '$lib/server/utils/logger';
import { createConnectRouter, createContextValues } from '@connectrpc/connect';
import {
	universalServerRequestFromFetch,
	universalServerResponseToFetch
} from '@connectrpc/connect/protocol';
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
	const waitUntil =
		(event.platform as { context?: { waitUntil?: (promise: Promise<void>) => void } } | undefined)
			?.context?.waitUntil ?? (event as { waitUntil?: (promise: Promise<void>) => void }).waitUntil;
	const contextValues = createContextValues().set(CheckMateWaitUntilContextKey, waitUntil ?? null);
	const request = universalServerRequestFromFetch(event.request, { httpVersion: '1.1' });
	request.contextValues = contextValues;
	const response = await handler(request);
	return universalServerResponseToFetch(response);
}

export const POST = handle;
export const GET = handle;
