import type { RequestHandler } from './$types';
import handlerJs from '../../../../vendor/firebase-auth-helpers/__/auth/handler.js?raw';

export const GET: RequestHandler = async () => {
  return new Response(handlerJs, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
