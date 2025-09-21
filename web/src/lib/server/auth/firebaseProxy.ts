import type { RequestEvent } from '@sveltejs/kit';

export const FIREBASE_AUTH_HOST = 'pic2toon.firebaseapp.com';
export const FIREBASE_AUTH_ORIGIN = `https://${FIREBASE_AUTH_HOST}` as const;

/**
 * Reverse proxy for Firebase Auth helper endpoints ("/__/auth/*").
 * Forwards requests to the project's firebaseapp.com origin while keeping
 * the browser on our domain. Location headers pointing back to the helper
 * paths are rewritten to our domain to avoid any 302 cross-site hops.
 */
export async function proxyFirebaseAuth(event: RequestEvent): Promise<Response> {
  const upstreamUrl = new URL(event.url.pathname + event.url.search, FIREBASE_AUTH_ORIGIN);

  const headers = new Headers(event.request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
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

  const upstreamRes = await event.fetch(upstreamUrl, {
    method,
    headers,
    body,
    redirect: 'manual'
  });

  const outHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
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

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders
  });
}

