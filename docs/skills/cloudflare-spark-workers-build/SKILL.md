---
name: cloudflare-spark-workers-build
description: Debug and fix Spark's Cloudflare Workers Git deployments (Workers Builds) for the /web SvelteKit app and keep env vars in sync.
---

# Cloudflare Spark Workers Builds (Git Deploy) Workflow

This workflow assumes Spark’s SvelteKit app (`web/`) is deployed to the Cloudflare **Worker** named `spark` via **Workers Builds** (Git integration).

## Inputs

- `CLOUDFLARE_API_TOKEN` with:
  - Account: Workers Builds (Read/Write recommended)
  - Account: Workers Scripts (Read/Write recommended)
  - Account: Workers KV/Secrets as needed for your app
- `CLOUDFLARE_ACCOUNT_ID` (Spark account)
- Worker name: `spark`

Sanity-check the token first:

```bash
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

## Identify The Build Configuration

Workers Builds are attached to a **script_tag** (not always the same as the worker name).

1. Get the current `script_tag` for the Worker:

```bash
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/services\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\" \\
  | python3 -c 'import json,sys; p=json.load(sys.stdin); \nfor s in p.get(\"result\",[]):\n  if s.get(\"id\")==\"spark\":\n    print(s[\"default_environment\"][\"script_tag\"])'
```

2. Fetch the build config (this returns Git repo, root directory, build/deploy commands, and env vars):

```bash
SCRIPT_TAG=\"<script_tag_from_step_1>\"
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$SCRIPT_TAG\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

Key fields to confirm:
- `root_directory` (expected: `/web`)
- `build_command` (expected: `bun run build:cloudflare`)
- `deploy_command` (expected: `bunx wrangler deploy`)
- `environment_variables` (build-time injected variables)
- `trigger.trigger_uuid` (used to patch env vars and trigger builds)

## Pull Logs For The Latest Failing Build

1. List recent builds for this script:

```bash
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$SCRIPT_TAG/builds\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

2. Pick `build_uuid`, then fetch full build status + trigger metadata:

```bash
BUILD_UUID=\"<build_uuid>\"
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/builds/$BUILD_UUID\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

3. Fetch build logs:

```bash
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/builds/$BUILD_UUID/logs\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

## Common Failure Class A: `bun install --frozen-lockfile` lockfile mismatch

Symptom in logs:
- Bun lockfile mismatch / frozen lockfile failure

Fix:
- Ensure `bun.lock` is updated and committed.
- For Spark’s layout, Workers Builds runs in `root_directory=/web`, but the install can still consult workspace metadata. Keep workspace `package.json` files and the root `bun.lock` consistent.

Typical local fix:

```bash
rm -rf node_modules
bun install
git add bun.lock
git commit -m \"[fix] sync lockfile\"
git push
```

## Common Failure Class B: Missing `$env/static/private` exports during `vite build`

Symptom in logs:
- `\"FOO\" is not exported by \"virtual:env/static/private\"`

Cause:
- SvelteKit’s `$env/static/private` only includes variables that are present at build time.

Fix:
- Add the missing variable to **Workers Builds trigger env vars**.

1. Read the trigger UUID from build metadata:
- `result.trigger.trigger_uuid` OR `result.build_trigger_metadata.trigger.trigger_uuid`

2. Patch env vars:

```bash
TRIGGER_UUID=\"<trigger_uuid>\"
curl -sS -X PATCH \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/triggers/$TRIGGER_UUID/environment_variables\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\" \\
  -H \"Content-Type: application/json\" \\
  --data-raw '{\"TASKS_API_KEY\":{\"value\":\"<value>\",\"is_secret\":true}}'
```

Notes:
- `is_secret=true` hides the value; the API will echo `null` for the value afterward, which is expected.
- If your token is missing the **Workers Builds** permission group, Workers Builds API calls often fail with `code=12006` / `"Invalid token"` even if the same token works for Workers Scripts endpoints.

## Common Failure Class C: Deploy step fails during `wrangler deploy`

Symptom in logs:
- `Success: Build command completed`
- then `Executing user deploy command: bunx wrangler deploy`
- followed by bundling/import errors

Cause:
- Wrangler bundles server code for Workers. Some Node-only packages (or their transitive deps) can break bundling.

Fix approach:
1. Identify the transitive dependency chain from the error.
2. Remove/replace the offending dependency (prefer Node built-ins when possible).
3. Re-run Workers Build.

Example seen in Spark:
- `npm-run-path` importing `toPath` from `unicorn-magic` caused bundling failure.
- Root cause was pulling in `execa` (Node-only helper) through `@spark/llm`.
- Fix was to remove `execa` and use `node:child_process` directly for ffmpeg helpers.

## Runtime vs Build-Time Env Vars (Important)

Workers Builds env vars are used for **build** and **deploy** steps. The deployed Worker also has its own:
- **Secrets** (`wrangler secret put`)
- **Vars** (plain env vars)

If the app complains at runtime (after a successful deployment) that `GOOGLE_SERVICE_ACCOUNT_JSON` is missing:
- Set it as a Worker secret, not just a Workers Builds env var.

```bash
cd web
printf '%s' \"<service_account_json>\" | bunx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --name spark
```

Verify names:

```bash
bunx wrangler secret list --name spark
```

## Common Runtime Failure: Firestore Admin SDK In Workers

Symptom:
- 500s on API routes that touch Firestore with:
  - `EvalError: Code generation from strings disallowed for this context`

Cause:
- Firebase Admin Firestore uses gRPC/protobuf codegen that can be blocked in the Workers runtime.

Fix approach:
- Replace Firestore Admin usage in Worker-executed routes with Firestore REST calls (OAuth JWT flow via WebCrypto).
- Treat persistence as mandatory: fail with a clear error message if writes cannot be persisted.

## Trigger A Manual Build

To validate fixes without waiting for Git:

```bash
TRIGGER_UUID=\"<trigger_uuid>\"
curl -sS -X POST \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/triggers/$TRIGGER_UUID/builds\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\" \\
  -H \"Content-Type: application/json\" \\
  --data-raw '{\"branch\":\"main\"}'
```

Poll status:

```bash
BUILD_UUID=\"<build_uuid_from_trigger>\"
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/builds/$BUILD_UUID\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

## Confirm Deployment Landed

After a successful build/deploy, check the latest Worker version:

```bash
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/spark/versions\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

## Alternative: Verify Git Deploys Via Wrangler (No Builds API Needed)

If you don't have a token that can access the Workers Builds API, you can still confirm that Git deploys are succeeding by inspecting Worker **Versions** and their annotations.

List recent versions (newest at the bottom unless you sort):

```bash
export CLOUDFLARE_ACCOUNT_ID=\"<account_id>\"
export CLOUDFLARE_API_TOKEN=\"<token>\"
bunx wrangler versions list --name spark --json
```

Useful fields (per version object):
- `metadata.created_on` — upload time
- `annotations.workers/triggered_by` — e.g. `version_upload` or `secret`
- `annotations.workers/alias` — present for non-production Git builds (typically the branch name)

View a specific version:

```bash
bunx wrangler versions view <version_id> --name spark --json
```

Workers.dev preview URL for an alias:
- First find your Workers.dev subdomain:

```bash
curl -sS \"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain\" \\
  -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"
```

- Preview URL pattern:
  - `https://<alias>-spark.<subdomain>.workers.dev/`
