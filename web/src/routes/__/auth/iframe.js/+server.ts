import type { RequestHandler } from './$types';
import iframeJs from '../../../../vendor/firebase-auth-helpers/__/auth/iframe.js?raw';

export const GET: RequestHandler = async () => {
  return new Response(iframeJs, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
