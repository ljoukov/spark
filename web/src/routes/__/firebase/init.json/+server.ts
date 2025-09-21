import type { RequestHandler } from './$types';
import initJsonRaw from '../../../../vendor/firebase-auth-helpers/__/firebase/init.json?raw';

export const GET: RequestHandler = async ({ url }) => {
  // Parse the vendored init.json and rewrite authDomain dynamically to current host
  const upstream = JSON.parse(initJsonRaw);
  upstream.authDomain = url.host;
  const body = JSON.stringify(upstream, null, 2);

  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  });
};
