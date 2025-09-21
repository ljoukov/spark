import { dev } from '$app/environment';

function currentHostAuthDomain(): string {
  if (typeof window !== 'undefined') {
    return window.location.host; // self-hosted auth helpers live under this domain
  }
  // SSR fallback: prefer localhost in dev so any server-side code that
  // stringifies config is consistent during local development.
  return dev ? 'localhost:8080' : 'spark.flipflop.workers.dev';
}

export const clientFirebaseConfig = {
  apiKey: 'AIzaSyDy9h1WEveGy10w_8m6Aa-Bax9mNF2OKuw',
  // Option 4 (self-hosted helpers): point authDomain to our app domain so
  // Firebase SDK targets https://<host>/__/auth/handler etc.
  authDomain: currentHostAuthDomain(),
  projectId: 'pic2toon',
  storageBucket: 'pic2toon.firebasestorage.app',
  messagingSenderId: '1083072308192',
  appId: '1:1083072308192:web:db604280a19f025e938185',
  measurementId: 'G-V068HR5F8T'
} as const;
