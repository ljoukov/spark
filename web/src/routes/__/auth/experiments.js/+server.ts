import type { RequestHandler } from './$types';
import experimentsJs from '../../../../vendor/firebase-auth-helpers/__/auth/experiments.js?raw';

export const GET: RequestHandler = async () => {
  return new Response(experimentsJs, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
