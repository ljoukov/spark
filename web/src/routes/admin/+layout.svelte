<script lang="ts">
  import * as Card from '$lib/components/ui/card/index.js';
  import { buttonVariants } from '$lib/components/ui/button/index.js';
  import { startGoogleSignInRedirect } from '$lib/utils/firebaseClient';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { startIdTokenCookieSync } from '$lib/auth/tokenCookie';
  import { getFirebaseApp } from '$lib/utils/firebaseClient';
  import { getAuth, onIdTokenChanged } from 'firebase/auth';

  let { data, children }: {
    data: {
      user: { uid: string; email: string | null } | null;
      isAdmin: boolean;
    };
    children: Snippet;
  } = $props();

  const showLogin = $derived(!data.user);

  const ui = $state({ signingIn: false });

  async function handleGoogleSignIn(): Promise<void> {
    ui.signingIn = true;
    try {
      await startGoogleSignInRedirect();
    } finally {
      ui.signingIn = false;
    }
  }

  onMount(() => {
    const stopCookieSync = startIdTokenCookieSync();
    const auth = getAuth(getFirebaseApp());
    let refreshed = false;
    const stopAuth = onIdTokenChanged(auth, (user) => {
      if (user && !refreshed) {
        refreshed = true;
        setTimeout(() => { void invalidateAll(); }, 0);
      }
    });
    return () => { stopCookieSync(); stopAuth(); };
  });
</script>

{@render children?.()}

{#if showLogin}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <Card.Root class="w-full max-w-md border-border bg-card/95 shadow-xl backdrop-blur">
      <Card.Header>
        <Card.Title>Admin Sign In</Card.Title>
        <Card.Description>
          Sign in with Google to access the admin area.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <button
          type="button"
          class={cn(buttonVariants({ variant: 'default', size: 'default' }), 'w-full')}
          onclick={handleGoogleSignIn}
          disabled={ui.signingIn}
        >
          {#if ui.signingIn}
            Signing in…
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 533.5 544.3" class="mr-2 h-4 w-4" aria-hidden="true">
              <path fill="#4285f4" d="M533.5 278.4c0-17.4-1.5-34.1-4.4-50.2H272v95h147.2c-6.4 34.6-25.9 63.9-55.1 83.5v69h88.9c52.1-47.9 80.5-118.4 80.5-197.3z" />
              <path fill="#34a853" d="M272 544.3c74.7 0 137.4-24.7 183.2-67.6l-88.9-69c-24.7 16.6-56.3 26.4-94.3 26.4-72.6 0-134-49-155.9-114.9H24.2v72.3C69.4 482.2 162.5 544.3 272 544.3z" />
              <path fill="#fbbc04" d="M116.1 318.9c-4.2-12.6-6.6-26.1-6.6-40s2.4-27.4 6.6-40V166.6H24.2C9 196.3 0 231.4 0 268.9s9 72.6 24.2 102.3l91.9-72.3z" />
              <path fill="#ea4335" d="M272 107.7c40.8 0 77.3 14 106.1 41.4l79.6-79.6C409.4 24.8 346.7 0 272 0 162.5 0 69.4 62.1 24.2 166.6l91.9 72.3C138 156.7 199.4 107.7 272 107.7z" />
            </svg>
            Sign in with Google
          {/if}
        </button>
      </Card.Content>
    </Card.Root>
  </div>
{/if}
