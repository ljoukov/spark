function currentHostAuthDomain(): string {
  if (typeof window !== 'undefined') {
    // Use the current host so the SDK targets our domain for /__/auth/*
    // (this will flow through the reverse proxy in hooks.server.ts).
    return window.location.host;
  }
  // On the server (SSR), fall back to the original Firebase auth domain.
  return 'pic2toon.firebaseapp.com';
}

export const clientFirebaseConfig = {
  apiKey: 'AIzaSyDy9h1WEveGy10w_8m6Aa-Bax9mNF2OKuw',
  authDomain: currentHostAuthDomain(),
  projectId: 'pic2toon',
  storageBucket: 'pic2toon.firebasestorage.app',
  messagingSenderId: '1083072308192',
  appId: '1:1083072308192:web:db604280a19f025e938185',
  measurementId: 'G-V068HR5F8T'
} as const;
