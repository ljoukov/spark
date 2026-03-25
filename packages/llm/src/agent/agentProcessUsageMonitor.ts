export type AgentProcessUsageSnapshot = {
  readonly cpuTimeMs: number;
  readonly cpuUtilization: number;
  readonly rssPeakBytes: number;
};

export class AgentProcessUsageMonitor {
  private readonly startedAtMs = Date.now();
  private readonly startCpuUsage = process.cpuUsage();
  private rssPeakBytes = process.memoryUsage().rss;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  start(): void {
    this.sample();
    this.timer = setInterval(() => {
      this.sample();
    }, 5_000);
    this.timer.unref?.();
  }

  stop(): AgentProcessUsageSnapshot {
    if (this.stopped) {
      return this.snapshot();
    }
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.sample();
    return this.snapshot();
  }

  private sample(): void {
    const memory = process.memoryUsage();
    this.rssPeakBytes = Math.max(this.rssPeakBytes, memory.rss);
  }

  private snapshot(): AgentProcessUsageSnapshot {
    const cpuUsage = process.cpuUsage(this.startCpuUsage);
    const cpuTimeMs = (cpuUsage.user + cpuUsage.system) / 1_000;
    const wallclockMs = Math.max(1, Date.now() - this.startedAtMs);
    return {
      cpuTimeMs,
      cpuUtilization: cpuTimeMs / wallclockMs,
      rssPeakBytes: this.rssPeakBytes,
    };
  }
}
