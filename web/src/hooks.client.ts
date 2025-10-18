import type { HandleFetch } from '@sveltejs/kit';
import { ensureFreshIdToken } from '$lib/auth/tokenCookie';

export const handleFetch: HandleFetch = async ({ request, fetch }) => {
	if (typeof window !== 'undefined') {
		try {
			const target = new URL(request.url);
			const isInternalApi = target.origin === window.location.origin && target.pathname.startsWith('/api/');
			if (isInternalApi) {
				await ensureFreshIdToken();
			}
		} catch {
			// Ignore URL parsing errors and fall through.
		}
	}
	return fetch(request);
};
