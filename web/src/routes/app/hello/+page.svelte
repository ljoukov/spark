<!-- Experimental page: validates server-side session and shows the UID. -->
<script lang="ts">
  export let data: { uid: string; email: string | null };
  const emailText = data.email ?? '(no email)';
  const uidText = data.uid;
  // Experimental page: shows server-resolved identity from cookie-validated token.
</script>

<svelte:head>
  <title>App Hello (Experimental)</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto max-w-xl p-6">
  <h1 class="text-2xl font-semibold mb-4">Hello from the App</h1>
  <p class="mb-6 text-sm text-gray-500">This is an experimental page with a server-side sign-in check.</p>
  <div class="rounded-md border p-4 space-y-2">
    <div>
      <p class="text-sm text-gray-600">Signed-in user ID:</p>
      <p class="font-mono text-lg">{uidText}</p>
    </div>
    <div>
      <p class="text-sm text-gray-600">Email:</p>
      <p class="font-mono text-lg">{emailText}</p>
    </div>
  </div>
</main>
