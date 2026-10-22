import type { Hand, TrackedHand, TrackingFrame } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { HandIdentity, IDENTITY_LOST_MS } from "./hand-identity.ts";
import { loadFixture } from "./testing/fixtures.ts";

const STEP = 1000 / 30;
const template = loadFixture("open-palm").flatMap((f) => f.hands)[0] as TrackedHand;
const templateX = template.image[0]?.[0] ?? 0.5;

/** The template hand with its wrist at raw image x, labelled as MediaPipe would report it. */
const handAt = (x: number, label: Hand, score = 0.9): TrackedHand => ({
  ...template,
  handedness: label,
  score,
  image: template.image.map(([px, py, pz]) => [px - templateX + x, py, pz]),
});
const frame = (i: number, hands: TrackedHand[]): TrackingFrame => ({
  seq: i,
  captureTs: 1_000_000 + i * STEP,
  inferenceDoneTs: 1_000_000 + i * STEP + 20,
  backend: "GPU",
  aspect: 4 / 3,
  hands,
});
const wristX = (h: TrackedHand) => h.image[0]?.[0] ?? 0;
/** Label given to the hand nearest raw image x. */
const labelAt = (f: TrackingFrame, x: number) =>
  [...f.hands].sort((a, b) => Math.abs(wristX(a) - x) - Math.abs(wristX(b) - x))[0]?.handedness;

describe("HandIdentity", () => {
  it("keeps a hand's label while MediaPipe flips it as the hand crosses the face to the other side", () => {
    // The user's right hand starts on the image left (unmirrored) and sweeps across to the right; MediaPipe calls
    // it "Left" once it is past the face.
    const id = new HandIdentity();
    const labels = Array.from({ length: 40 }, (_, i) => {
      const x = 0.2 + i * 0.015;
      return id.assign(frame(i, [handAt(x, x > 0.5 ? "Left" : "Right")])).hands[0]?.handedness;
    });
    expect(new Set(labels)).toEqual(new Set(["Right"]));
  });

  it("two hands never share a label, even when MediaPipe gives both the same one", () => {
    const id = new HandIdentity();
    for (let i = 0; i < 10; i++) id.assign(frame(i, [handAt(0.3, "Right"), handAt(0.7, "Left")]));
    // The right hand comes near the left one; MediaPipe now calls both "Left".
    for (let i = 10; i < 30; i++) {
      const out = id.assign(frame(i, [handAt(0.3 + (i - 10) * 0.012, "Left"), handAt(0.7, "Left")]));
      expect(out.hands.map((h) => h.handedness).sort()).toEqual(["Left", "Right"]);
      expect(labelAt(out, 0.7)).toBe("Left");
    }
  });

  it("hands that swap MediaPipe labels for a frame keep their own", () => {
    const id = new HandIdentity();
    for (let i = 0; i < 5; i++) id.assign(frame(i, [handAt(0.3, "Right"), handAt(0.7, "Left")]));
    const out = id.assign(frame(5, [handAt(0.31, "Left"), handAt(0.69, "Right")]));
    expect(labelAt(out, 0.3)).toBe("Right");
    expect(labelAt(out, 0.7)).toBe("Left");
  });

  it("drops a hand reported twice in the same place, keeping the more confident detection", () => {
    const id = new HandIdentity();
    const out = id.assign(frame(0, [handAt(0.4, "Right", 0.6), handAt(0.405, "Left", 0.95)]));
    expect(out.hands).toHaveLength(1);
    expect(out.hands[0]?.score).toBe(0.95);
  });

  it("drops a ghost hand fitted inside a real one on a blurred frame, even with its wrist elsewhere", () => {
    // The ghost: the real hand squeezed into the top part of its own box, so its palm centre is well away.
    const real = handAt(0.75, "Left", 0.96);
    const ys = real.image.map((p) => p[1]);
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    const ghost: TrackedHand = {
      ...real,
      handedness: "Right",
      score: 0.69,
      image: real.image.map(([x, y, z]) => [x, top + (y - top) * 0.5, z]),
    };
    const id = new HandIdentity();
    id.assign(frame(0, [real]));
    const out = id.assign(frame(1, [real, ghost]));
    expect(out.hands).toHaveLength(1);
    expect(out.hands[0]?.score).toBe(0.96);
    expect(bottom - top).toBeGreaterThan(0.1); // the ghost really is displaced, not a near copy
  });

  it("two real hands side by side are both kept", () => {
    const out = new HandIdentity().assign(frame(0, [handAt(0.3, "Right"), handAt(0.6, "Left")]));
    expect(out.hands).toHaveLength(2);
  });

  it("a hand that left and comes back takes MediaPipe's label again", () => {
    const id = new HandIdentity();
    for (let i = 0; i < 5; i++) id.assign(frame(i, [handAt(0.3, "Right")]));
    const gap = Math.ceil(IDENTITY_LOST_MS / STEP) + 2;
    for (let i = 5; i < 5 + gap; i++) id.assign(frame(i, []));
    expect(id.assign(frame(5 + gap, [handAt(0.7, "Left")])).hands[0]?.handedness).toBe("Left");
  });

  it("a new hand appearing while one is tracked gets the free label", () => {
    const id = new HandIdentity();
    for (let i = 0; i < 5; i++) id.assign(frame(i, [handAt(0.3, "Right")]));
    // MediaPipe calls the newcomer "Right" too.
    const out = id.assign(frame(5, [handAt(0.3, "Right"), handAt(0.75, "Right")]));
    expect(labelAt(out, 0.3)).toBe("Right");
    expect(labelAt(out, 0.75)).toBe("Left");
  });

  it("passes the recorded clips through unchanged (their labels are already consistent)", () => {
    for (const clip of ["two-hands", "one-hand-pinch", "open-palm"] as const) {
      const id = new HandIdentity();
      for (const f of loadFixture(clip)) {
        const out = id.assign(f);
        expect(out.hands.map((h) => h.handedness).sort()).toEqual(f.hands.map((h) => h.handedness).sort());
      }
    }
  });
});
