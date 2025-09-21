#!/usr/bin/env node
/*
  Downloads Firebase Auth sign-in helper files (Option 4) and stores them under
  `static/__/auth/*` and `static/__/firebase/init.json` so the app can self-host
  the OAuth redirect/iframe helpers on its own domain.

  Usage:
    FIREBASE_AUTH_HOST=pic2toon.firebaseapp.com node scripts/sync-signin-helpers.mjs
  or just:
    npm run sync:signin-helpers

  Notes:
  - Keep these files up to date by running this periodically, or wire it to `prebuild`.
  - Only Google sign-in is guaranteed with Option 4; Apple/SAML require proxy/Hosting.
*/

import fs from 'node:fs/promises';
import path from 'node:path';

const AUTH_HOST = process.env.FIREBASE_AUTH_HOST || 'pic2toon.firebaseapp.com';
const ORIGIN = `https://${AUTH_HOST}`;

// For Option 4: put all helper files under static/__ (served as static assets),
// except init.json which goes into the route folder for dynamic rewriting.
const targets = [
  { url: `${ORIGIN}/__/auth/handler`, out: 'static/__/auth/handler', kind: 'binary' },
  { url: `${ORIGIN}/__/auth/iframe`, out: 'static/__/auth/iframe', kind: 'binary' },
  { url: `${ORIGIN}/__/auth/handler.js`, out: 'static/__/auth/handler.js', kind: 'binary' },
  { url: `${ORIGIN}/__/auth/experiments.js`, out: 'static/__/auth/experiments.js', kind: 'binary' },
  { url: `${ORIGIN}/__/auth/iframe.js`, out: 'static/__/auth/iframe.js', kind: 'binary' },
  { url: `${ORIGIN}/__/firebase/init.json`, out: 'src/routes/__/firebase/init.json/original.json', kind: 'initjson' }
];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}\n${text}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

async function main() {
  console.log(`[sync] Using source: ${ORIGIN}`);
  const SELF_DOMAIN = process.env.SELF_HOST_AUTH_DOMAIN || 'spark.flipflop.workers.dev';
  for (const t of targets) {
    const dir = path.dirname(t.out);
    console.log(`[sync] GET ${t.url}`);
    const data = await download(t.url);
    // Store original upstream content; init.json will be rewritten dynamically at runtime
    await ensureDir(dir);
    await fs.writeFile(t.out, data);
    console.log(`[sync] WROTE ${t.out} (${data.length} bytes)`);
  }
  console.log('[sync] Done');
}

main().catch((err) => {
  console.error('[sync] Error:', err?.stack || err);
  process.exit(1);
});
