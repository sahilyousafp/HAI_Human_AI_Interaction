import { describe, expect, it } from "vitest";
import { AdaptiveScheduler } from "./scheduler.ts";

/** Feeds `seconds` of frames at `fps` starting at `startMs`; returns the end time. */
function run(s: AdaptiveScheduler, fps: number, seconds: number, startMs: number): number {
  const step = 1000 / fps;
  let t = startMs;
  for (let i = 0; i < fps * seconds; i++) {
    t += step;
    s.frameDone(t);
  }
  return t;
}

describe("AdaptiveScheduler (spec: tracking load adapts to keep hands responsive)", () => {
  it("runs face tracking on every frame at a healthy rate", () => {
    const s = new AdaptiveScheduler();
    run(s, 30, 5, 0);
    expect(s.faceCadence).toBe(1);
    expect([0, 1, 2, 3].every((seq) => s.shouldRunFace(seq))).toBe(true);
  });

  it("backs off to alternate frames after 2 s below 24 fps", () => {
    const s = new AdaptiveScheduler();
    let t = run(s, 30, 2, 0);
    t = run(s, 20, 1.5, t);
    expect(s.faceCadence).toBe(1); // the smoothed rate is low, but not for 2 s yet
    run(s, 20, 2, t);
    expect(s.faceCadence).toBe(2);
    expect([0, 1, 2, 3].map((seq) => s.shouldRunFace(seq))).toEqual([true, false, true, false]);
  });

  it("does not back off for a short dip", () => {
    const s = new AdaptiveScheduler();
    let t = run(s, 30, 2, 0);
    t = run(s, 15, 1, t);
    run(s, 30, 3, t);
    expect(s.faceCadence).toBe(1);
  });

  it("recovers once the rate is back above 28 fps", () => {
    const s = new AdaptiveScheduler();
    let t = run(s, 20, 5, 0);
    expect(s.faceCadence).toBe(2);
    t = run(s, 26, 3, t);
    expect(s.faceCadence).toBe(2); // between the thresholds: hysteresis holds the back-off
    run(s, 30, 3, t);
    expect(s.faceCadence).toBe(1);
  });
});
