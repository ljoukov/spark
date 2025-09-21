import type { RequestHandler } from './$types';
import { clearUserAuthCookie } from '$lib/server/auth/cookie';
import { clientSideRedirect } from '$lib/server/utils/response';

export const GET: RequestHandler = async ({ url, cookies }) => {
	clearUserAuthCookie(cookies);
	return clientSideRedirect(new URL('/', url));
};
