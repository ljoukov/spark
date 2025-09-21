This is a SvelteKit app, it usees latest version of Svelte and SvelteKit, docs are here: https://svelte.dev/llms.txt

- Product spec and flows: see `../docs/SPEC.md`.

# Technology Stack

- Use SvelteKit
- USe TypeScript
- Run npm lint and fix errors
- Use TailwindCSS (it is already installed)
- SvelteKit has had several important changes: runes and remote functions (see web/docs/sveltekit-docs.md)
- routes/api endpoints are for the mobile app only, do not call them directly in SvelteKit app, use native SvelteKit way to call the server instead (see web/docs/sveltekit-docs.md)
- use zod to validate JSON and data coming from storage, LLMs or network
