import type { RequestHandler } from './$types';
import iframeHtml from '../../../../vendor/firebase-auth-helpers/__/auth/iframe.html?raw';

export const GET: RequestHandler = async () => {
  return new Response(iframeHtml, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
