import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFromFile } from "../src/utils/env";

function resolveRepoRoot(): string {
  const filePath = fileURLToPath(import.meta.url);
  const dir = path.dirname(filePath);
  return path.resolve(dir, "../../..");
}

const repoRoot = resolveRepoRoot();

// Load env from common workspace locations (tests run with cwd=packages/llm).
loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });
loadEnvFromFile(path.join(repoRoot, "web", ".env.local"), { override: false });
loadEnvFromFile(path.join(repoRoot, "eval", ".env.local"), { override: false });
loadEnvFromFile(path.join(repoRoot, "packages", "llm", ".env.local"), {
  override: false,
});
