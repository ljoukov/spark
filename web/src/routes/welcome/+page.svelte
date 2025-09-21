<script lang="ts">
  import { onMount } from 'svelte';

  // Mirror public/index.html behavior using Firebase compat SDK loaded via /__/firebase/*.
  type CompatUser = { uid: string; email?: string | null; displayName?: string | null } | null;

  let user: CompatUser = null;
  let statusText = 'Loading…';
  let resultText = '';

  function supportsStorage(api: Storage): boolean {
    try {
      const key = '__test__' + Math.random();
      api.setItem(key, '1');
      const ok = api.getItem(key) === '1';
      api.removeItem(key);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function dumpEnv(prefix: string) {
    if (typeof window === 'undefined') {
      return;
    }
    const info = {
      prefix,
      location: window.location.href,
      // @ts-expect-error firebase is a compat global from init.js
      sdkVersion: (window as any).firebase?.SDK_VERSION,
      // @ts-expect-error compat
      appOptions: (window as any).firebase?.app?.().options,
      // @ts-expect-error compat
      usingAuthDomain: (window as any).firebase?.app?.().options?.authDomain,
      hasLocalStorage: supportsStorage(window.localStorage),
      hasSessionStorage: supportsStorage(window.sessionStorage),
      localFirebaseKeys: Object.keys(window.localStorage || {}).filter((k) =>
        k.toLowerCase().includes('firebase')
      ),
      sessionFirebaseKeys: Object.keys(window.sessionStorage || {}).filter((k) =>
        k.toLowerCase().includes('firebase')
      )
    };
    // Keep in memory for UI; also log for devtools
    resultText = JSON.stringify(info, null, 2);
    console.log('[welcome]', info);
  }

  function setStatus(text: string) {
    statusText = text;
  }

  async function waitForFirebase(): Promise<any> {
    if (typeof window === 'undefined') {
      return null;
    }
    return await new Promise((resolve) => {
      const poll = () => {
        // @ts-expect-error compat global
        const fb = (window as any).firebase;
        if (fb && typeof fb.auth === 'function') {
          resolve(fb);
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });
  }

  async function withPersistence(auth: any) {
    // Try durable persistence; fall back to session
    try {
      await auth.setPersistence((window as any).firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      await auth.setPersistence((window as any).firebase.auth.Auth.Persistence.SESSION);
    }
  }

  async function handleRedirect() {
    const fb = await waitForFirebase();
    if (!fb) {
      return;
    }
    const auth = fb.auth();
    setStatus('Starting redirect…');
    await withPersistence(auth);
    const provider = new fb.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithRedirect(provider).catch((err: unknown) => {
      setStatus('Redirect error');
      dumpEnv('redirect-error');
      resultText += '\n' + (err instanceof Error ? err.message : String(err));
    });
  }

  async function handlePopup() {
    const fb = await waitForFirebase();
    if (!fb) {
      return;
    }
    const auth = fb.auth();
    setStatus('Opening popup…');
    await withPersistence(auth);
    const provider = new fb.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await auth.signInWithPopup(provider);
      dumpEnv('popup-success');
      resultText += '\n' + 'popup signed in';
      user = result.user;
      setStatus('Signed in');
    } catch (err) {
      dumpEnv('popup-error');
      resultText += '\n' + (err instanceof Error ? err.message : String(err));
      setStatus('Popup error');
    }
  }

  async function handleSignOut() {
    const fb = await waitForFirebase();
    if (!fb) {
      return;
    }
    const auth = fb.auth();
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  }

  onMount(() => {
    (async () => {
      const fb = await waitForFirebase();
      if (!fb) {
        return;
      }
      const auth = fb.auth();

      auth.onAuthStateChanged((u: any) => {
        user = u;
        setStatus(u ? 'Signed in' : 'Not signed in');
      });

      try {
        dumpEnv('page-load');
        await withPersistence(auth);
        const result = await auth.getRedirectResult();
        if (result && result.user) {
          dumpEnv('redirect-success');
          resultText += '\n' + 'redirect success';
          user = result.user;
          setStatus('Signed in');
        } else {
          resultText += '\n' + 'redirect no-result';
        }
      } catch (err) {
        dumpEnv('redirect-catch');
        resultText += '\n' + (err instanceof Error ? err.message : String(err));
        setStatus('Redirect error');
      }
    })();
  });
</script>

<svelte:head>
  <title>Welcome — Firebase Redirect Test</title>
  <meta name="robots" content="noindex" />
  <!-- Load the same compat SDKs and init as public/index.html via our /__/firebase proxy -->
  <script defer src="/__/firebase/12.3.0/firebase-app-compat.js"></script>
  <script defer src="/__/firebase/12.3.0/firebase-auth-compat.js"></script>
  <script defer src="/__/firebase/init.js?useEmulator=false"></script>
</svelte:head>

<main style="max-width: 720px; margin: 2rem auto; padding: 1rem; font: inherit;">
  <h1 style="margin-bottom: 1rem;">Firebase Sign-in (Redirect) Test</h1>

  {#if user}
    <div style="margin: 1rem 0; padding: 0.75rem 1rem; border: 1px solid #ddd; border-radius: 8px;">
      <p style="margin: 0 0 0.5rem 0;">Signed in as:</p>
      <p style="margin: 0.25rem 0; font-weight: 600;">{user?.displayName ?? user?.email ?? '(no display name)'}</p>
      <p style="margin: 0.25rem 0; color: #666; font-size: 0.9em;">uid: {user?.uid}</p>
      <div style="margin-top: 0.75rem;" class="row">
        <button on:click={handleSignOut} style="padding: 0.5rem 0.9rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;">Sign out</button>
      </div>
    </div>
  {:else}
    <p style="margin: 0.5rem 0 1rem 0;">Not signed in.</p>
    <div class="row">
      <button on:click={handleRedirect} style="padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;">Sign in with Google (redirect)</button>
      <button on:click={handlePopup} style="padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer;">Try popup</button>
    </div>
  {/if}

  <div style="margin-top: 1rem;">
    <p style="margin: 0.25rem 0; color: #666; font-size: 0.9em;">Status: {statusText}</p>
    <pre style="white-space: pre-wrap; background: #f8f8f8; border: 1px solid #eee; padding: 0.75rem; border-radius: 6px;">{resultText}</pre>
  </div>
</main>
