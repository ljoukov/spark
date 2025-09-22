import type { RequestEvent } from '@sveltejs/kit';

export const FIREBASE_AUTH_HOST = 'pic2toon.firebaseapp.com';
export const FIREBASE_AUTH_ORIGIN = `https://${FIREBASE_AUTH_HOST}` as const;

/**
 * Reverse proxy for Firebase helper endpoints used by the Web SDK:
 *  - "/__/auth/*" (OAuth helper)
 *  - "/__/firebase/*" (e.g. init.json / init.js)
 *
 * Forwards requests to the project's firebaseapp.com origin while keeping
 * the browser on our domain. Location headers that point back to
 * firebaseapp.com/__/auth/* are rewritten so the browser stays on
 * our domain during the OAuth flow.
 */
export async function proxyFirebaseAuth(event: RequestEvent): Promise<Response> {
	const upstreamUrl = new URL(event.url.pathname + event.url.search, FIREBASE_AUTH_ORIGIN);

	const headers = new Headers(event.request.headers);
	headers.delete('host');
	headers.delete('connection');
	headers.delete('content-length');
	// Avoid upstream gzip/brotli so we can safely manage content-encoding ourselves
	headers.set('accept-encoding', 'identity');
	if (headers.has('origin')) {
		headers.set('origin', FIREBASE_AUTH_ORIGIN);
	}
	headers.set('x-forwarded-host', event.url.host);
	headers.set('x-forwarded-proto', event.url.protocol.replace(':', ''));

	const method = event.request.method;
	let body: BodyInit | undefined = undefined;
	if (method !== 'GET' && method !== 'HEAD') {
		const buf = await event.request.arrayBuffer();
		if (buf.byteLength > 0) {
			body = buf;
		}
	}

	const started = Date.now();
	console.log(`[auth-proxy] → ${method} ${event.url.pathname}${event.url.search}`);

	const upstreamRes = await event.fetch(upstreamUrl, {
		method,
		headers,
		body,
		redirect: 'manual'
	});

	const elapsed = Date.now() - started;
	const outHeaders = new Headers();
	upstreamRes.headers.forEach((value, key) => {
		const lower = key.toLowerCase();
		// Strip hop-by-hop and encoding-specific headers to prevent decoding mismatches
		if (
			lower === 'content-encoding' ||
			lower === 'transfer-encoding' ||
			lower === 'content-length' ||
			lower === 'connection'
		) {
			return;
		}
		outHeaders.append(key, value);
	});

	const loc = upstreamRes.headers.get('location');
	if (loc) {
		try {
			const locUrl = new URL(loc, FIREBASE_AUTH_ORIGIN);
			if (locUrl.origin === FIREBASE_AUTH_ORIGIN && locUrl.pathname.startsWith('/__/auth/')) {
				const rewritten = new URL(
					locUrl.pathname + locUrl.search + locUrl.hash,
					event.url.origin
				).toString();
				outHeaders.set('location', rewritten);
			}
		} catch {
			// ignore malformed locations; pass through as-is
		}
	}

	// Ensure correct content type for extensionless helper HTML pages.
	const path = event.url.pathname;
	const filename = path.substring(path.lastIndexOf('/') + 1);
	if (filename === 'iframe' || filename === 'handler' || filename === 'callback') {
		outHeaders.set('content-type', 'text/html; charset=utf-8');
		outHeaders.set('x-content-type-options', 'nosniff');
		// Remove any content-disposition that might trigger downloads
		outHeaders.delete('content-disposition');
	}

	console.log(`[auth-proxy] ← ${upstreamRes.status} ${filename || ''} (${elapsed}ms)`);

	return new Response(upstreamRes.body, {
		status: upstreamRes.status,
		statusText: upstreamRes.statusText,
		headers: outHeaders
	});
}
