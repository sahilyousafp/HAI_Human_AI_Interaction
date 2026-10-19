// One Euro filter (Casiez, Roussel, Vogel, CHI 2012): an adaptive low-pass filter whose cutoff rises
// with speed, so still points stay still and fast motion is followed with little lag.

export interface OneEuroParams {
  /** Hz. Lower = smoother when still. */
  minCutoff: number;
  /** How quickly the cutoff rises with speed. Tuned for normalised image coordinates (0..1). */
  beta: number;
  /** Hz. Cutoff for the speed estimate. */
  dCutoff: number;
}

/** Tuned so a still hand's jitter drops below 25% of its variance and a 30%-wide step is 90% followed in 2 frames at 30 fps. */
export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.0, beta: 6.0, dCutoff: 2.0 };

const alpha = (cutoffHz: number, dtSec: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
};

/** Filters a fixed-length vector of values that share one timestamp (e.g. all coordinates of a hand). */
export class OneEuroVector {
  private readonly x: Float64Array;
  private readonly dx: Float64Array;
  private lastTs: number | null = null;

  constructor(
    readonly size: number,
    private readonly params: OneEuroParams = DEFAULT_ONE_EURO,
  ) {
    this.x = new Float64Array(size);
    this.dx = new Float64Array(size);
  }

  /** Filters `values` (length `size`) observed at `tsMs`; writes the result into `out` and returns it. */
  filter(
    values: ArrayLike<number>,
    tsMs: number,
    out: Float64Array = new Float64Array(this.size),
  ): Float64Array {
    if (this.lastTs === null || tsMs <= this.lastTs) {
      for (let i = 0; i < this.size; i++) {
        const v = values[i] ?? 0;
        this.x[i] = v;
        this.dx[i] = 0;
        out[i] = v;
      }
      this.lastTs = tsMs;
      return out;
    }
    const dt = (tsMs - this.lastTs) / 1000;
    this.lastTs = tsMs;
    const aD = alpha(this.params.dCutoff, dt);
    for (let i = 0; i < this.size; i++) {
      const v = values[i] ?? 0;
      const prev = this.x[i] ?? 0;
      const rawDx = (v - prev) / dt;
      const dxHat = aD * rawDx + (1 - aD) * (this.dx[i] ?? 0);
      this.dx[i] = dxHat;
      const cutoff = this.params.minCutoff + this.params.beta * Math.abs(dxHat);
      const a = alpha(cutoff, dt);
      const filtered = a * v + (1 - a) * prev;
      this.x[i] = filtered;
      out[i] = filtered;
    }
    return out;
  }

  reset(): void {
    this.lastTs = null;
  }

  get lastTimestamp(): number | null {
    return this.lastTs;
  }
}
