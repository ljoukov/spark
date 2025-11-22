import { createRequire } from "node:module";

type SharpModule = typeof import("sharp");

let cachedSharp: SharpModule | undefined;

export function getSharp(): SharpModule {
  if (cachedSharp) {
    return cachedSharp;
  }
  const requireSharp = createRequire(import.meta.url);
  const loaded = requireSharp("sharp") as SharpModule & {
    default?: SharpModule;
  };
  cachedSharp = loaded.default ?? loaded;
  return cachedSharp;
}
