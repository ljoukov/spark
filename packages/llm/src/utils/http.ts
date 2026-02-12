import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

type GlobalHttpDispatcherOptions = {
  timeoutMs?: number;
};

let configuredProxyMode: "proxy" | "direct" | undefined;
let configuredTimeoutMs: number | undefined;

function readProxyEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

function shouldUseProxyFromEnv(): boolean {
  const proxyEnvNames = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
  ] as const;

  for (const name of proxyEnvNames) {
    if (readProxyEnv(name)) {
      return true;
    }
  }

  return false;
}

export function configureGlobalHttpDispatcher(
  options: GlobalHttpDispatcherOptions = {},
): void {
  const { timeoutMs } = options;
  const useProxy = shouldUseProxyFromEnv();

  if (useProxy) {
    if (configuredProxyMode === "proxy") {
      return;
    }
    setGlobalDispatcher(new EnvHttpProxyAgent());
    configuredProxyMode = "proxy";
    configuredTimeoutMs = undefined;
    return;
  }

  if (
    configuredProxyMode === "direct" &&
    configuredTimeoutMs === timeoutMs
  ) {
    return;
  }

  const directDispatcherOptions =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? {
          bodyTimeout: timeoutMs,
          headersTimeout: timeoutMs,
        }
      : {};

  setGlobalDispatcher(new Agent(directDispatcherOptions));

  configuredProxyMode = "direct";
  configuredTimeoutMs = timeoutMs;
}

