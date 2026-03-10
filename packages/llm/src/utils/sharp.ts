import { createRequire } from "node:module";

import { assertNodeRuntime } from "./runtime";

type SharpModule = typeof import("sharp");

let cachedSharp: SharpModule | undefined;

export function getSharp(): SharpModule {
  assertNodeRuntime("sharp image processing");
  if (cachedSharp !== undefined) {
    return cachedSharp;
  }
  const requireSharp = createRequire(import.meta.url);
  const loaded = requireSharp("sharp") as SharpModule & {
    default?: SharpModule;
  };
  cachedSharp = loaded.default ?? loaded;
  return cachedSharp;
}
