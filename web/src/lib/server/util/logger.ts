export type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  level?: LogLevel;
  message: string;
  context?: Record<string, unknown>;
};

const LEVEL_TO_CONSOLE: Record<LogLevel, typeof console.log> = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

export function logServerEvent({ level = "info", message, context = {} }: LogPayload): void {
  const logFn = LEVEL_TO_CONSOLE[level] ?? console.log;
  if (context && Object.keys(context).length > 0) {
    logFn(`[server] ${message}`, context);
  } else {
    logFn(`[server] ${message}`);
  }
}
