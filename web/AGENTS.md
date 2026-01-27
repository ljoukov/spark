This is a SvelteKit app, it usees latest version of Svelte and SvelteKit, docs are here: https://svelte.dev/llms.txt

- Product spec and flows: see `../docs/SPEC.md`.
- Signed-in home is `/spark` (Spark AI Agent). `/` is the login screen. `/welcome` now redirects to `/`.

# Technology Stack

- Use SvelteKit
- USe TypeScript
- Run npm lint and fix errors
- Use TailwindCSS (it is already installed)
- SvelteKit has had several important changes: runes and remote functions (see web/docs/sveltekit-docs.md)
- Svelte 5 gotcha: avoid capturing reactive `data` from `$props` in top-level initializers. Use `$derived`, `$effect`, or lazy functions so values stay in sync and avoid `state_referenced_locally` warnings.
- routes/api endpoints are for the mobile app only, do not call them directly in SvelteKit app, use native SvelteKit way to call the server instead (see web/docs/sveltekit-docs.md)
- use zod to validate JSON and data coming from storage, LLMs or network
- we use shadcn-svelte components library docs are in web/docs/shadcn-svelte.md
- Use absolute imports (unless current directory)
- Use $lib/ and $proto/ aliases, e.g. `import { runGeminiCall } from '@spark/llm/utils/gemini';`
- Prefer static imports. Do **not** use dynamic `import()` in the web app unless specifically asked—mixing modes prevents Vite
  from emitting separate chunks and surfaces warnings during build.

**Authentication**

- Admin and App Area (`/admin` and `/app`)
  - Uses Firebase Auth in the browser (both redirect and popup options are available) so the client can use Firestore real-time listeners freely. Example UI: `web/src/routes/app/+page.svelte`.
  - All app → server API calls must include a Firebase ID token (e.g., `Authorization: Bearer <idToken>`). The server validates tokens using the Firebase Admin SDK via the shared `@spark/llm/utils/firebaseAdmin` helpers and token verification utilities in `web/src/lib/server/utils/firebaseServer.ts:23`.

  - We keep Firebase Hosting deployed only to make the Firebase Auth helper endpoints available at `__/auth/*` and to test client sign-in. See the lightweight demo page at `web/public/index.html`.
  - The SvelteKit app itself is deployed to Vercel; Hosting is not used for app routing.

- Notes
  - Follow `docs/SPEC.md` for auth and validation requirements. All external inputs must be validated with `zod` and normalized before use.
  - Local testing uses a real Firebase user via `/login-with-email`, configured by `TEST_USER_EMAIL_ID_PASSWORD` in `web/.env.local` (see `docs/SPEC.md`). Auth is not bypassed.

**Gemini**

Gemini API

- Model selection: Hardcode model IDs per task based on evals. Default to `gemini-2.5-flash` for the quiz extraction/generation/judging pipeline (validated in integration tests). Escalate to `gemini-2.5-pro` only for new tasks that demonstrably require heavier OCR or long-form reasoning. Do not use a `GEMINI_MODEL` env var.
- API route: `POST /api/admin/chat` — body `{ messages: {role:'user'|'model', content:string}[] }`, streams plain text.
- Service auth: set `GOOGLE_SERVICE_ACCOUNT_JSON`; shared helpers handle Gemini/TTS access tokens.

Gemini Prompting & Structured Output

- Prompting guide: use structured output to get JSON the server can validate.
  Docs: https://ai.google.dev/gemini-api/docs/structured-output#javascript

Example (Node/TS) using the shared helper:

```ts
import { Type } from '@google/genai';
import { runGeminiCall } from '@spark/llm/utils/gemini';

export async function exampleStructuredOutput() {
	const response = await runGeminiCall((client) =>
		client.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: 'List a few popular cookie recipes, and include the amounts of ingredients.',
			config: {
				responseMimeType: 'application/json',
				responseSchema: {
					type: Type.ARRAY,
					items: {
						type: Type.OBJECT,
						properties: {
							recipeName: { type: Type.STRING },
							ingredients: { type: Type.ARRAY, items: { type: Type.STRING } }
						}
					}
				}
			}
		}),
	);

	return response.text; // JSON string per responseMimeType
}
```

Validation and retries

- Always validate model JSON with `zod` before use. Normalize with `transform()`.
- On validation error or transient Gemini error, retry once (max retries = 2 total attempts).
- Handle known error classes:
  - Rate-limited: back off (e.g., 500–1000ms jitter) and retry once.
  - Quota/insufficient funds: do not retry; return 402/429 style error to client.
  - Invalid request/schema mismatch: log and fix prompt/schema; do not retry blindly.
- Never trust unvalidated model output for writes; only write validated, typed data.

Model policy examples

- Quiz extraction/judging flows → `gemini-2.5-flash` (escalate only if flash regresses).
- Free-text grading with rubric → `gemini-2.5-pro`.
- MCQ/TF/short generation from notes → `gemini-2.5-flash` (escalate to `-pro` on low confidence).
- Summary bullets → `gemini-2.5-flash`.

**Testing**

- use vitest
- use name.test.ts file generally located right in the same dir as the file they test (name.ts and name.test.ts)
- web/src/tests directory for utilities specifically for testing (eg proxy setup)
- Vite emits bundler warnings (for example, about dynamic imports) during `npm run build`. Run the build when touching import
  graphs to catch these early.
- `npm run all-tests` runs lint, check, test, and build sequentially. Codex is encouraged to run it for larger changes before
  submitting work.
