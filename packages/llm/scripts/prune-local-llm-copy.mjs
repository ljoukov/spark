import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, rm } from "node:fs/promises";

const packageRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const vendorScopeDir = path.join(packageRootDir, "node_modules", "@ljoukov");
const vendorPackageDir = path.join(vendorScopeDir, "llm");

await rm(vendorPackageDir, { recursive: true, force: true });

try {
  const remaining = await readdir(vendorScopeDir);
  if (remaining.length === 0) {
    await rm(vendorScopeDir, { recursive: true, force: true });
  }
} catch {
  // Ignore missing scope directory.
}
