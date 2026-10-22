import type { RecognizerState } from "@hai/perception";
import type { GestureEvent, Hand, TrackedHand, TrackingFrame } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { type DetectionSample, DetectionStore, stripSegments } from "./detection-store.ts";

const STEP = 1000 / 30;
const hand = (handedness: Hand): TrackedHand => ({
  handedness,
  score: 0.9,
  image: Array.from({ length: 21 }, () => [0.5, 0.5, 0]),
  world: Array.from({ length: 21 }, () => [0, 0, 0]),
});
const frame = (seq: number, hands: Hand[], captureTs = 1_000_000 + seq * STEP): TrackingFrame => ({
  seq,
  captureTs,
  inferenceDoneTs: captureTs + 20,
  backend: "GPU",
  hands: hands.map(hand),
});
const state = (hands: RecognizerState["hands"] = {}): RecognizerState => ({
  engaged: true,
  hands,
  pinch: {},
  twoHand: false,
  stopArmed: false,
  lastHead: null,
});

describe("DetectionStore", () => {
  it("reports the share of frames each hand was found in over the last 5 seconds", () => {
    let now = 0;
    const store = new DetectionStore(() => now);
    for (let i = 0; i < 300; i++) {
      // 10 s at 30 fps: the right hand is always there; the left only in the last 2.5 s.
      const f = frame(i, i >= 225 ? ["Left", "Right"] : ["Right"]);
      now = f.captureTs + 40;
      store.push(f, true, state(), []);
    }
    const { rates, samples } = store.getSnapshot();
    expect(samples.length).toBeGreaterThanOrEqual(149);
    expect(samples.length).toBeLessThanOrEqual(151);
    expect(rates.right).toBe(1);
    expect(rates.left).toBeCloseTo(0.5, 1);
  });

  it("counts face detection only on frames where face tracking ran", () => {
    const store = new DetectionStore(() => 0);
    for (let i = 0; i < 10; i++) {
      const f = frame(i, []);
      // Face tracking runs on even frames and finds a face on 3 of the 5.
      const ran = i % 2 === 0;
      const withFace = ran && i < 6;
      store.push(
        withFace
          ? {
              ...f,
              face: {
                landmarks: [],
                blendshapes: {},
                headPose: { yaw: 0, pitch: 0, roll: 0 },
              },
            }
          : f,
        ran,
        state(),
        [],
      );
    }
    expect(store.getSnapshot().rates.face).toBeCloseTo(3 / 5, 9);
  });

  it("measures camera to gesture as the time from capture to the frame arriving", () => {
    let now = 0;
    const store = new DetectionStore(() => now);
    for (let i = 0; i < 20; i++) {
      const f = frame(i, ["Right"]);
      now = f.captureTs + (i === 19 ? 120 : 40); // one slow frame of twenty: under the 90th percentile
      store.push(f, true, state(), []);
    }
    expect(store.getSnapshot().cameraToGestureP90).toBeCloseTo(40, 6);
  });

  it("counts taps, drags and two-hand gestures, and reset clears everything", () => {
    const store = new DetectionStore(() => 0);
    const at = (type: string) =>
      ({ type, ts: 0, confidence: 1, hand: "Right", position: [0.5, 0.5] }) as GestureEvent;
    store.push(frame(0, ["Right"]), true, state(), [
      at("pinch.tap"),
      at("pinch.drag.start"),
      at("pinch.drag.update"),
    ]);
    store.push(frame(1, ["Right"]), true, state(), [at("pinch.tap")]);
    expect(store.getSnapshot().counts).toEqual({ taps: 2, drags: 1, twoHand: 0 });
    store.reset();
    expect(store.getSnapshot().counts).toEqual({ taps: 0, drags: 0, twoHand: 0 });
    expect(store.getSnapshot().samples).toEqual([]);
  });

  it("marks frames where the hand machine is pinching", () => {
    const store = new DetectionStore(() => 0);
    store.push(frame(0, ["Right"]), true, state({ Right: "pinch" }), []);
    store.push(frame(1, ["Right"]), true, state({ Right: "open-palm" }), []);
    expect(store.getSnapshot().samples.map((s) => s.right)).toEqual(["pinched", "seen"]);
  });
});

describe("stripSegments", () => {
  const samples = (pattern: string, startTs = 0): DetectionSample[] =>
    [...pattern].map((c, i) => ({
      ts: startTs + i * STEP,
      left: "none",
      right: c === "R" ? "seen" : c === "P" ? "pinched" : "none",
      face: c === "f" ? null : true,
    }));

  it("merges consecutive frames into found and pinching segments", () => {
    const kinds = stripSegments(samples("RRRPPPRR"), "right").map((s) => s.kind);
    expect(kinds).toEqual(["seen", "pinched", "seen"]);
  });

  it("a short gap between detections is a dropout; a long one is the hand out of view", () => {
    // 3 missing frames (100 ms): dropped. 30 missing frames (1 s): left blank.
    const segs = stripSegments(samples(`RRR...RRR${".".repeat(30)}RRR`), "right");
    expect(segs.map((s) => s.kind)).toEqual(["seen", "dropped", "seen", "seen"]);
    const dropped = segs[1];
    expect(dropped?.to).toBeCloseTo(6 * STEP, 6);
  });

  it("a hand missing at the start or the end of the window is not a dropout", () => {
    expect(stripSegments(samples("..RRR.."), "right").map((s) => s.kind)).toEqual(["seen"]);
  });

  it("a hand that never appears draws nothing", () => {
    expect(stripSegments(samples("RRRR"), "left")).toEqual([]);
  });

  it("face frames where face tracking did not run keep the last result", () => {
    const segs = stripSegments(samples("RfRfRf"), "face");
    expect(segs).toHaveLength(1);
    expect(segs[0]?.kind).toBe("seen");
  });
});
