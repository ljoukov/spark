import { extractBearerToken } from '$lib/server/auth/apiAuth';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { logServerEvent } from '$lib/server/utils/logger';
import { CheckMateService } from '$proto';
import type { ConnectRouter, HandlerContext } from '@connectrpc/connect';
import { Code, ConnectError } from '@connectrpc/connect';
import { z } from 'zod';

const GreetRequestSchema = z.object({
	name: z.string().min(1)
});

async function requireAuth(context: HandlerContext): Promise<void> {
	const authHeader = context.requestHeader.get('authorization');
	const token = extractBearerToken(authHeader);
	if (!token) {
		logServerEvent({
			level: 'warn',
			message: 'CheckMate auth missing.',
			context: {
				hasAuthHeader: Boolean(authHeader)
			}
		});
		throw new ConnectError('Missing authentication token.', Code.Unauthenticated);
	}
	try {
		await verifyFirebaseIdToken(token);
	} catch (error) {
		logServerEvent({
			level: 'warn',
			message: 'CheckMate auth failed.',
			context: {
				error: error instanceof Error ? error.message : String(error)
			}
		});
		throw new ConnectError('Invalid or expired authentication token.', Code.Unauthenticated);
	}
}

export function registerCheckMateRoutes(router: ConnectRouter): void {
	router.service(CheckMateService, {
		async greet(request, context) {
			logServerEvent({
				message: 'CheckMate Greet request received.',
				context: {
					nameLength: request.name.length
				}
			});
			await requireAuth(context);
			const parsed = GreetRequestSchema.safeParse(request);
			if (!parsed.success) {
				logServerEvent({
					level: 'warn',
					message: 'CheckMate Greet request invalid.',
					context: {
						issues: parsed.error.issues.map((issue) => issue.message)
					}
				});
				throw new ConnectError('Invalid request payload.', Code.InvalidArgument);
			}
			const response = { message: `Hello ${parsed.data.name}` };
			logServerEvent({
				message: 'CheckMate Greet response sent.',
				context: {
					nameLength: parsed.data.name.length
				}
			});
			return response;
		}
	});
}
