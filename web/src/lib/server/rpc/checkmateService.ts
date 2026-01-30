import { extractBearerToken } from '$lib/server/auth/apiAuth';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { CheckMateService } from '$proto';
import type { ConnectRouter, HandlerContext } from '@connectrpc/connect';
import { Code, ConnectError } from '@connectrpc/connect';
import { z } from 'zod';

const GreetRequestSchema = z.object({
	name: z.string().min(1)
});

async function requireAuth(context: HandlerContext): Promise<void> {
	const token = extractBearerToken(context.requestHeader.get('authorization'));
	if (!token) {
		throw new ConnectError('Missing authentication token.', Code.Unauthenticated);
	}
	try {
		await verifyFirebaseIdToken(token);
	} catch {
		throw new ConnectError('Invalid or expired authentication token.', Code.Unauthenticated);
	}
}

export function registerCheckMateRoutes(router: ConnectRouter): void {
	router.service(CheckMateService, {
		async greet(request, context) {
			await requireAuth(context);
			const parsed = GreetRequestSchema.safeParse(request);
			if (!parsed.success) {
				throw new ConnectError('Invalid request payload.', Code.InvalidArgument);
			}
			return { message: `Hello ${parsed.data.name}` };
		}
	});
}
