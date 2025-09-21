import type { Handle, RequestEvent } from '@sveltejs/kit';
import { firebaseAuthHelperOrigin } from '$lib/config/firebase';

const FIREBASE_AUTH_PATH_PREFIX = '/__/auth';
const FIREBASE_INIT_PATHS = new Set([
	'/__/firebase/init.json',
	'/__/firebase/init.js',
	'/__/firebase/init.js.map'
]);

export const handle: Handle = async ({ event, resolve }) => {
	if (shouldProxyFirebaseHelper(event.url.pathname)) {
		return proxyFirebaseHelper(event);
	}

	return resolve(event);
};

function shouldProxyFirebaseHelper(pathname: string): boolean {
	if (pathname === FIREBASE_AUTH_PATH_PREFIX) {
		return true;
	}
	if (pathname.startsWith(`${FIREBASE_AUTH_PATH_PREFIX}/`)) {
		return true;
	}
	if (FIREBASE_INIT_PATHS.has(pathname)) {
		return true;
	}
	return false;
}

async function proxyFirebaseHelper(event: RequestEvent): Promise<Response> {
	const targetUrl = new URL(`${event.url.pathname}${event.url.search}`, firebaseAuthHelperOrigin);
	const forwardedHeaders = buildForwardHeaders(event);
	const method = event.request.method.toUpperCase();
	const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
	let body: ArrayBuffer | undefined;

	if (hasBody) {
		const cloned = event.request.clone();
		body = await cloned.arrayBuffer();
	}

	try {
		const upstreamResponse = await event.fetch(targetUrl, {
			method: event.request.method,
			headers: forwardedHeaders,
			body,
			redirect: 'manual'
		});

		return rewriteFirebaseResponse(upstreamResponse, event.url);
	} catch (error) {
		console.error('Failed to proxy Firebase auth helper request', error);
		return new Response('Firebase auth helper unavailable', { status: 502 });
	}
}

function buildForwardHeaders(event: RequestEvent): Headers {
	const headers = new Headers();

	event.request.headers.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (lowerKey === 'host' || lowerKey === 'content-length') {
			return;
		}
		if (lowerKey === 'origin' || lowerKey === 'referer') {
			return;
		}
		headers.set(key, value);
	});

	const originalHost = event.request.headers.get('host');
	if (originalHost) {
		headers.set('x-forwarded-host', originalHost);
	}
	const protocol = event.url.protocol.replace(':', '');
	headers.set('x-forwarded-proto', protocol);
	return headers;
}

function rewriteFirebaseResponse(response: Response, requestUrl: URL): Response {
	const headers = new Headers(response.headers);
	const location = headers.get('location');

	if (location) {
		headers.set('location', rewriteLocationHeader(location, requestUrl));
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function rewriteLocationHeader(location: string, requestUrl: URL): string {
	try {
		const proxied = new URL(location, firebaseAuthHelperOrigin);
		if (proxied.origin === firebaseAuthHelperOrigin) {
			const rewritten = new URL(
				`${proxied.pathname}${proxied.search}${proxied.hash}`,
				requestUrl.origin
			);
			return rewritten.toString();
		}
		return location;
	} catch (error) {
		if (location.startsWith('/')) {
			const rewritten = new URL(location, requestUrl.origin);
			return rewritten.toString();
		}
		console.error('Failed to rewrite Firebase Location header', error);
		return location;
	}
}
