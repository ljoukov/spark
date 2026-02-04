export function isNodeRuntime(): boolean {
  // Cloudflare Workers can enable `nodejs_compat`, which provides a `process`
  // polyfill (including `process.versions.node`). The Firebase Admin SDK uses
  // gRPC/protobuf codegen that is blocked in Workers (EvalError: codegen from
  // strings disallowed), so we must treat Workers as *not* a Node runtime.
  const globalProps = globalThis as unknown as Record<string, unknown>;
  const navigatorValue = globalProps["navigator"];
  const userAgent =
    typeof navigatorValue === "object" &&
    navigatorValue !== null &&
    typeof (navigatorValue as { userAgent?: unknown }).userAgent === "string"
      ? (navigatorValue as { userAgent: string }).userAgent
      : null;
  if (
    typeof userAgent === "string" &&
    userAgent.toLowerCase().includes("cloudflare")
  ) {
    return false;
  }
  if ("WebSocketPair" in globalProps && "caches" in globalProps) {
    return false;
  }

  return (
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string" &&
    process.versions.node.length > 0
  );
}

export function assertNodeRuntime(feature: string): void {
  if (!isNodeRuntime()) {
    throw new Error(`${feature} is only supported in Node runtimes.`);
  }
}
