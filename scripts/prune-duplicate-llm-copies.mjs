import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, rm } from "node:fs/promises";

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const duplicatePackageDirs = [
  path.join(repoRootDir, "packages", "llm", "node_modules", "@ljoukov", "llm"),
  path.join(
    repoRootDir,
    "eval",
    "node_modules",
    "@spark",
    "llm",
    "node_modules",
    "@ljoukov",
    "llm",
  ),
  path.join(
    repoRootDir,
    "web",
    "node_modules",
    "@spark",
    "llm",
    "node_modules",
    "@ljoukov",
    "llm",
  ),
];

async function pruneScopedPackage(packageDir) {
  await rm(packageDir, { recursive: true, force: true });
  const scopeDir = path.dirname(packageDir);
  try {
    const remaining = await readdir(scopeDir);
    if (remaining.length === 0) {
      await rm(scopeDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore missing scope directories.
  }
}

await Promise.all(duplicatePackageDirs.map((packageDir) => pruneScopedPackage(packageDir)));
