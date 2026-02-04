export function isNodeRuntime(): boolean {
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
