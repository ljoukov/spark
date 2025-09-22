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
- we use shadcn-svelte components library docs are in web/docs/shadcn-svelte.md

**Authentication**

- Why Firebase Hosting
  - We keep Firebase Hosting deployed only to make the Firebase Auth helper endpoints available at `__/auth/*` and to test client sign-in. See the lightweight demo page at `web/public/index.html`.
  - The SvelteKit app itself is deployed as a Cloudflare Worker; Hosting is not used for app routing.

- Admin and App Area (`/admin` and `/app`)
  - Uses Firebase Auth in the browser (both redirect and popup options are available) so the client can use Firestore real-time listeners freely. Example UI: `web/src/routes/app/+page.svelte`.
  - All app → server API calls must include a Firebase ID token (e.g., `Authorization: Bearer <idToken>`). The server validates tokens using the Firebase Admin SDK. See helpers in `web/src/lib/server/utils/firebaseAdmin.ts:68` and token verification utilities in `web/src/lib/server/utils/firebaseServer.ts:23`.

- Notes
  - Follow `docs/SPEC.md` for auth and validation requirements. All external inputs must be validated with `zod` and normalized before use.
