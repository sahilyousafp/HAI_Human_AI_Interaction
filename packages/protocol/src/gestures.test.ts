import { describe, expect, it } from "vitest";
import { GestureEvent } from "./gestures.ts";

const ts = 1_760_000_000_000;
const two = { hand: "both", distance: 0.3, midpoint: [0.5, 0.5], angle: 2 };

const valid = [
  { type: "engaged", ts, confidence: 1 },
  { type: "disengaged", ts, confidence: 1, reason: "idle" },
  { type: "pinch.tap", ts, confidence: 0.9, hand: "Right", position: [0.4, 0.6] },
  { type: "pinch.drag.start", ts, confidence: 0.9, hand: "Left", position: [0.4, 0.6] },
  { type: "pinch.drag.update", ts, confidence: 0.9, hand: "Left", position: [0.42, 0.6], delta: [0.02, 0] },
  { type: "pinch.drag.end", ts, confidence: 0.9, hand: "Left", position: [0.42, 0.6] },
  { type: "clutch.start", ts, confidence: 0.8, hand: "Right" },
  { type: "clutch.end", ts, confidence: 0.8, hand: "Right" },
  { type: "twohand.start", ts, confidence: 0.9, ...two },
  { type: "twohand.update", ts, confidence: 0.9, ...two },
  { type: "twohand.end", ts, confidence: 0.9, ...two },
  { type: "head.nod", ts, confidence: 0.7 },
  { type: "head.shake", ts, confidence: 0.7 },
];

describe("GestureEvent", () => {
  it.each(valid.map((e) => [e.type, e]))("accepts %s", (_type, event) => {
    expect(GestureEvent.safeParse(event).success).toBe(true);
  });

  it.each([
    ["an unknown type", { type: "pinch.hold.forever", ts, confidence: 1 }],
    ["a missing hand", { type: "pinch.tap", ts, confidence: 1, position: [0, 0] }],
    ["a bad hand", { type: "pinch.tap", ts, confidence: 1, hand: "Both", position: [0, 0] }],
    ["confidence above 1", { type: "head.nod", ts, confidence: 1.2 }],
    ["an extra key", { type: "head.nod", ts, confidence: 1, extra: true }],
    ["a bad disengage reason", { type: "disengaged", ts, confidence: 1, reason: "bored" }],
  ])("rejects %s", (_label, event) => {
    expect(GestureEvent.safeParse(event).success).toBe(false);
  });
});
