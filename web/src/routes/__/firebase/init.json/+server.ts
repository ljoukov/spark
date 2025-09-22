import type { RequestHandler } from './$types';
import { FIREBASE_AUTH_HOST, FIREBASE_AUTH_ORIGIN } from '$lib/server/auth/firebaseProxy';
import { z } from 'zod';

const initSchema = z
	.object({
		apiKey: z.string(),
		authDomain: z.string().optional(),
		databaseURL: z.string().optional().nullable(),
		messagingSenderId: z.string().optional(),
		projectId: z.string(),
		storageBucket: z.string().optional()
	})
	.loose();

async function fetchAndRewrite(host: string, fetchFn: typeof fetch) {
	const started = Date.now();
	console.log(`[auth-init] → GET /__/firebase/init.json (upstream ${FIREBASE_AUTH_HOST})`);

	const res = await fetchFn(`${FIREBASE_AUTH_ORIGIN}/__/firebase/init.json`, {
		redirect: 'follow'
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		console.error(`[auth-init] upstream ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
		return new Response('Bad gateway', { status: 502 });
	}
	const json = await res.json().catch(() => null);
	const parsed = initSchema.safeParse(json);
	if (!parsed.success) {
		console.error('[auth-init] invalid upstream init.json', parsed.error?.message);
		return new Response('Upstream payload invalid', { status: 502 });
	}
	const upstream = parsed.data;
	upstream.authDomain = host;
	const body = JSON.stringify(upstream, null, 2);

	const elapsed = Date.now() - started;
	console.log(`[auth-init] ← 200 init.json (${elapsed}ms)`);
	return new Response(body, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'public, max-age=300, stale-while-revalidate=60'
		}
	});
}

export const GET: RequestHandler = async ({ url, fetch }) => fetchAndRewrite(url.host, fetch);

export const HEAD: RequestHandler = async ({ url, fetch }) => {
	const res = await fetchAndRewrite(url.host, fetch);
	// Return headers only for HEAD
	return new Response(null, { status: res.status, headers: res.headers });
};
