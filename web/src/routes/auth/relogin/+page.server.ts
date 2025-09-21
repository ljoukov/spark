import { clearUserAuthCookie } from '$lib/server/auth/cookie';
import type { PageServerLoad } from './$types';

export const load = (async ({ cookies }) => {
  clearUserAuthCookie(cookies);
  return {};
}) satisfies PageServerLoad;
