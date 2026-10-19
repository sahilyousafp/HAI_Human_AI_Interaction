/** Hand tracking always runs; face tracking backs off to alternate frames when the frame rate sags. */
export interface SchedulerConfig {
  /** Back off when the smoothed rate stays below this for `backoffAfterMs`. */
  lowFps: number;
  /** Restore face tracking on every frame once the smoothed rate is above this. */
  highFps: number;
  backoffAfterMs: number;
  /** Weight of the newest frame in the frame-rate moving average. */
  emaAlpha: number;
}

export const DEFAULT_SCHEDULER: SchedulerConfig = {
  lowFps: 24,
  highFps: 28,
  backoffAfterMs: 2000,
  emaAlpha: 0.1,
};

export class AdaptiveScheduler {
  private lastTs: number | null = null;
  private emaFps: number | null = null;
  private lowSince: number | null = null;
  private faceEvery: 1 | 2 = 1;

  constructor(private readonly config: SchedulerConfig = DEFAULT_SCHEDULER) {}

  /** Record that a frame finished at `tsMs`; updates the smoothed rate and the face cadence. */
  frameDone(tsMs: number): void {
    if (this.lastTs !== null && tsMs > this.lastTs) {
      const fps = 1000 / (tsMs - this.lastTs);
      this.emaFps =
        this.emaFps === null ? fps : this.config.emaAlpha * fps + (1 - this.config.emaAlpha) * this.emaFps;
      if (this.emaFps < this.config.lowFps) {
        this.lowSince ??= tsMs;
        if (tsMs - this.lowSince >= this.config.backoffAfterMs) this.faceEvery = 2;
      } else {
        this.lowSince = null;
        if (this.emaFps > this.config.highFps) this.faceEvery = 1;
      }
    }
    this.lastTs = tsMs;
  }

  /** Whether face tracking should run on the frame with this sequence number. */
  shouldRunFace(seq: number): boolean {
    return this.faceEvery === 1 || seq % 2 === 0;
  }

  get fps(): number | null {
    return this.emaFps;
  }

  get faceCadence(): 1 | 2 {
    return this.faceEvery;
  }
}
