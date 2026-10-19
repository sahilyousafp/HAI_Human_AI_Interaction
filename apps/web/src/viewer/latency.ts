/** Rolling latency samples (gesture to render, camera to gesture) with a p90, kept for the last few seconds. */
export class LatencyTracker {
  private samples: Array<{ at: number; ms: number }> = [];

  constructor(private readonly windowMs = 3000) {}

  add(ms: number, at = performance.now()): void {
    this.samples.push({ at, ms });
    const since = at - this.windowMs;
    while (this.samples.length > 0 && (this.samples[0]?.at ?? 0) < since) this.samples.shift();
  }

  /** 90th percentile of recent samples, or null when there are none. */
  p90(now = performance.now()): number | null {
    const recent = this.samples.filter((s) => s.at >= now - this.windowMs).map((s) => s.ms);
    if (recent.length === 0) return null;
    recent.sort((a, b) => a - b);
    return recent[Math.min(recent.length - 1, Math.floor(recent.length * 0.9))] ?? null;
  }

  get latest(): number | null {
    return this.samples.at(-1)?.ms ?? null;
  }

  clear(): void {
    this.samples = [];
  }
}
