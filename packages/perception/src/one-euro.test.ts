import { HAND_LANDMARK_COUNT, type TrackedHand, type TrackingFrame, type Vec3 } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { OneEuroVector } from "./one-euro.ts";
import { FrameSmoother, HAND_RESET_MS } from "./smoothing.ts";

const FRAME_MS = 1000 / 30;

/** Deterministic PRNG (mulberry32) and a Gaussian from it, so tests never flake. */
function gaussian(seed: number) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
}

const variance = (xs: number[]) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
};

describe("One Euro filter (spec: tracked points are smoothed without visible lag)", () => {
  it("still hand jitter: output variance is at most 25% of input variance", () => {
    const noise = gaussian(42);
    const filter = new OneEuroVector(1);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 600; i++) {
      const x = 0.5 + 0.005 * noise(); // 0.5% of the image width, typical landmark jitter
      raw.push(x);
      out.push(filter.filter([x], i * FRAME_MS)[0] ?? 0);
    }
    const settled = 60; // ignore the first 2 s while the filter settles
    const ratio = variance(out.slice(settled)) / variance(raw.slice(settled));
    expect(ratio).toBeLessThanOrEqual(0.25);
  });

  it("fast movement: a step of 30% of the image width is 90% followed within 2 frames at 30 fps", () => {
    const filter = new OneEuroVector(1);
    for (let i = 0; i < 30; i++) filter.filter([0.2], i * FRAME_MS);
    filter.filter([0.5], 30 * FRAME_MS);
    const second = filter.filter([0.5], 31 * FRAME_MS)[0] ?? 0;
    expect((second - 0.2) / 0.3).toBeGreaterThanOrEqual(0.9);
  });

  it("passes the first sample through unchanged", () => {
    expect(new OneEuroVector(2).filter([0.1, 0.9], 1000)).toEqual(new Float64Array([0.1, 0.9]));
  });
});

const hand = (handedness: TrackedHand["handedness"], x: number): TrackedHand => {
  const pts: Vec3[] = Array.from({ length: HAND_LANDMARK_COUNT }, () => [x, 0.5, 0]);
  return { handedness, score: 0.9, image: pts, world: pts };
};
const frame = (seq: number, ts: number, hands: TrackedHand[]): TrackingFrame => ({
  seq,
  captureTs: ts,
  inferenceDoneTs: ts + 10,
  backend: "CPU",
  hands,
});

describe("FrameSmoother", () => {
  it("keeps separate filters per hand", () => {
    const s = new FrameSmoother();
    s.smooth(frame(0, 1000, [hand("Left", 0.2), hand("Right", 0.8)]));
    const out = s.smooth(frame(1, 1000 + FRAME_MS, [hand("Left", 0.2), hand("Right", 0.8)]));
    expect(out.hands[0]?.image[0]?.[0]).toBeCloseTo(0.2, 6);
    expect(out.hands[1]?.image[0]?.[0]).toBeCloseTo(0.8, 6);
  });

  it("a hand absent for more than 200 ms re-enters at its new position", () => {
    const s = new FrameSmoother();
    s.smooth(frame(0, 1000, [hand("Right", 0.1)]));
    const back = s.smooth(frame(1, 1000 + HAND_RESET_MS + 50, [hand("Right", 0.9)]));
    expect(back.hands[0]?.image[0]?.[0]).toBeCloseTo(0.9, 6);
  });

  it("a hand absent briefly keeps smoothing (no jump)", () => {
    const s = new FrameSmoother();
    s.smooth(frame(0, 1000, [hand("Right", 0.1)]));
    const back = s.smooth(frame(1, 1000 + 100, [hand("Right", 0.9)]));
    expect(back.hands[0]?.image[0]?.[0]).toBeLessThan(0.9);
  });
});
