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
- `build_command` (expected: `npm run build:cloudflare`)
- `deploy_command` (expected: `npx wrangler deploy`)
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

## Common Failure Class A: `npm ci` lockfile mismatch

Symptom in logs:
- `npm ci can only install packages when your package.json and package-lock.json ... are in sync`

Fix:
- Ensure the lockfile(s) Cloudflare uses are updated and committed.
- For Spark’s layout, Cloudflare runs `npm clean-install` in `root_directory=/web`, but the install can still consult workspace metadata. Keep repo lockfiles consistent.

Typical local fix:

```bash
npm install --package-lock-only
git add package-lock.json
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

## Common Failure Class C: Deploy step fails during `wrangler deploy`

Symptom in logs:
- `Success: Build command completed`
- then `Executing user deploy command: npx wrangler deploy`
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
printf '%s' \"<service_account_json>\" | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --name spark
```

Verify names:

```bash
npx wrangler secret list --name spark
```

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

