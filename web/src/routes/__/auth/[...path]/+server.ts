import type { RequestHandler } from './$types';
import { proxyFirebaseAuth } from '$lib/server/auth/firebaseProxy';

async function handle(event: Parameters<RequestHandler>[0]) {
	return proxyFirebaseAuth(event);
}

export const GET: RequestHandler = async (event) => {
	return handle(event);
};

export const HEAD: RequestHandler = async (event) => {
	return handle(event);
};

export const POST: RequestHandler = async (event) => {
	return handle(event);
};
