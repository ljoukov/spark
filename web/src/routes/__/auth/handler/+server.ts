import type { RequestHandler } from './$types';
import handlerHtml from '../../../../vendor/firebase-auth-helpers/__/auth/handler.html?raw';

export const GET: RequestHandler = async () => {
  return new Response(handlerHtml, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
