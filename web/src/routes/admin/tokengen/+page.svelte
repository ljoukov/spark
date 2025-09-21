<script lang="ts">
  let tokenCopied: boolean = false;

  function generateToken() {
    const array = new Uint8Array(64);
    crypto.getRandomValues(array);
    const token = btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    navigator.clipboard.writeText(token);
    tokenCopied = true;
  }
</script>

<div class="p-4">
  <div class="font-semibold uppercase mb-4">Token Generator</div>
  <button
    on:click={generateToken}
    class="text-white bg-blue-700 hover:bg-blue-500 px-4 py-2 rounded-xl shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-700 disabled:bg-blue-300"
    >Generate</button
  >
  <div class="mt-4 p-2">
    {#if tokenCopied}
      <span class="pr-1.5">✅</span>Token copied
    {/if}
  </div>
</div>
