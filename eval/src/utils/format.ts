const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return integerFormatter.format(Math.max(0, Math.round(value)));
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const decimals = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[index]}`;
}

export function formatMillis(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    const decimals = seconds >= 10 ? 1 : 2;
    return `${seconds.toFixed(decimals)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds - minutes * 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00.00";
  }
  const totalMilliseconds = Math.round(seconds * 1000);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const millis = totalMilliseconds % 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const hundredths = Math.floor(millis / 10)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${secs.toString().padStart(2, "0")}.${hundredths}`;
}
