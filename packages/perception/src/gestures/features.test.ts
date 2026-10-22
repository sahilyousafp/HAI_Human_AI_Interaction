import type { Point2, TrackedHand } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { loadFixture, loadPinchLabels } from "../testing/fixtures.ts";
import { DEFAULT_GESTURES } from "./config.ts";
import {
  othersExtension,
  palmFacing,
  palmPoint,
  pinchPoint,
  pinchRatio,
  posture,
  screenDistance,
} from "./features.ts";

const handsOf = (clip: Parameters<typeof loadFixture>[0]) => loadFixture(clip).flatMap((f) => f.hands);

describe("hand features on recorded footage", () => {
  it("open-palm clip: most hands read as an open palm facing the camera", () => {
    const hands = handsOf("open-palm");
    const open = hands.filter((h) => posture(h) === "open-palm");
    expect(open.length / hands.length).toBeGreaterThan(0.75);
    expect(hands.filter((h) => palmFacing(h) > DEFAULT_GESTURES.posture.palmFacing).length).toBeGreaterThan(
      hands.length * 0.8,
    );
  });

  it("one-hand-pinch clip: an OK-style pinch reads as a pinch, a pinch with every finger folded reads as a fist", () => {
    const hands = handsOf("one-hand-pinch");
    const pinched = hands.filter((h) => pinchRatio(h) < DEFAULT_GESTURES.pinch.press);
    const open = hands.filter((h) => pinchRatio(h) > DEFAULT_GESTURES.pinch.release);
    expect(open.length).toBeGreaterThan(pinched.length);
    // The clip has two pinches: one with the other fingers relaxed open (a pinch), and one with every finger
    // folded around the thumb, which is geometrically a fist and therefore the clutch, by design.
    expect(pinched.filter((h) => posture(h) !== "fist").length).toBeGreaterThan(5);
    expect(pinched.filter((h) => posture(h) === "fist").length).toBeGreaterThan(0);
  });

  it("two-hands clip: the fists are recognised as fists, not pinches", () => {
    const fists = handsOf("two-hands").filter((h) => posture(h) === "fist");
    expect(fists.length).toBeGreaterThan(5);
    // A fist also brings thumb and index tips together in the image, which is why posture is checked first.
    expect(fists.some((h) => pinchRatio(h) < DEFAULT_GESTURES.pinch.press)).toBe(true);
  });

  it("no-hands clip has nothing to classify", () => {
    expect(handsOf("no-hands")).toEqual([]);
  });
});

describe("pinch means the fingertips meet (frames labelled by eye)", () => {
  const P = DEFAULT_GESTURES.pinch;
  const labelled = loadPinchLabels();
  const of = (label: string) => labelled.filter((l) => l.label === label);
  /** What the hand machine needs to start a pinch, short of the minimum hold. */
  const startsPinch = ({ hand, aspect }: (typeof labelled)[number]) =>
    posture(hand) !== "fist" && pinchRatio(hand, aspect) < P.press && othersExtension(hand) >= P.othersMin;

  it("has enough of each kind", () => {
    expect(of("touch").length).toBeGreaterThan(40);
    expect(of("near-miss").length).toBeGreaterThan(20);
    expect(of("fist").length).toBeGreaterThan(40);
  });

  it("a visible gap never starts a pinch: only near misses inside the 5% buffer above 0.16 can", () => {
    const admitted = of("near-miss").filter(startsPinch);
    expect(admitted.every((l) => pinchRatio(l.hand, l.aspect) < 0.16 * 1.05)).toBe(true);
    expect(admitted.length).toBeLessThanOrEqual(1);
  });

  it("the buffer catches fingertips that only just meet: at least 53 of the 55 labelled touches pinch", () => {
    expect(of("touch").filter(startsPinch).length).toBeGreaterThanOrEqual(53);
  });

  it("no fist, or hand closing into or opening from one, starts a pinch", () => {
    expect(
      of("fist")
        .filter(startsPinch)
        .map((l) => `${l.clip}#${l.seq}`),
    ).toEqual([]);
  });

  it("touching fingertips start a pinch (all but the few frames of the fingers still closing)", () => {
    const touches = of("touch");
    expect(touches.filter(startsPinch).length / touches.length).toBeGreaterThanOrEqual(0.9);
    // Once touching, the hand stays pinched: no touching frame reads above release.
    expect(touches.filter((l) => pinchRatio(l.hand, l.aspect) > P.release)).toEqual([]);
  });
});

describe("geometry helpers", () => {
  it("pinchPoint mirrors x to match the preview", () => {
    const hand = handsOf("one-hand-pinch")[0];
    if (!hand) throw new Error("fixture has no hand");
    const [x] = pinchPoint(hand);
    const raw = ((hand.image[4]?.[0] ?? 0) + (hand.image[8]?.[0] ?? 0)) / 2;
    expect(x).toBeCloseTo(1 - raw, 9);
  });

  it("screenDistance measures in fractions of the frame width", () => {
    expect(screenDistance([0.2, 0.5], [0.5, 0.5])).toBeCloseTo(0.3, 9);
    expect(screenDistance([0.5, 0.2], [0.5, 0.5], 4 / 3)).toBeCloseTo(0.225, 9);
  });
});

describe("palm point", () => {
  it("is the mirrored mean of the wrist and the four knuckles", () => {
    const image: TrackedHand["image"] = Array.from({ length: 21 }, () => [0, 0, 0]);
    image[0] = [0.2, 0.8, 0]; // wrist
    image[5] = [0.4, 0.4, 0]; // index knuckle
    image[9] = [0.5, 0.4, 0]; // middle knuckle
    image[13] = [0.6, 0.4, 0]; // ring knuckle
    image[17] = [0.8, 0.4, 0]; // little knuckle
    const hand: TrackedHand = { handedness: "Right", score: 1, image, world: image };
    const [x, y] = palmPoint(hand);
    expect(x).toBeCloseTo(1 - 0.5, 9);
    expect(y).toBeCloseTo(0.48, 9);
  });

  it("stays put as a hand closes into a fist, where the fingertips travel (design decision 3)", () => {
    // Recorded fists: the pinch point (thumb and index tips) moves 7-10% of the frame width while the hand closes
    // and up to 3.6% while it is held; the palm point moves at most 1.4% and 0.9%.
    type Sample = { ts: number; aspect: number; hand: TrackedHand };
    /** How far a point strays from where it was in the first sample, as a fraction of the frame width. */
    const spread = ([first, ...rest]: Sample[], point: (h: TrackedHand) => Point2) =>
      first ? Math.max(0, ...rest.map((x) => screenDistance(point(first.hand), point(x.hand), x.aspect))) : 0;
    let closingPinch = 0;
    let closingPalm = 0;
    let heldPalm = 0;
    for (const clip of ["two-hands", "one-hand-pinch", "open-palm"] as const) {
      const frames = loadFixture(clip);
      for (const side of ["Left", "Right"] as const) {
        const track = frames.flatMap((f): Sample[] => {
          const hand = f.hands.find((h) => h.handedness === side);
          return hand ? [{ ts: f.captureTs, aspect: f.aspect ?? 4 / 3, hand }] : [];
        });
        const isFist = (x?: Sample) => x !== undefined && posture(x.hand) === "fist";
        for (const [i, first] of track.entries()) {
          if (!isFist(first) || isFist(track[i - 1])) continue; // only the frame a fist forms
          let end = i;
          while (isFist(track[end + 1])) end++;
          const closing = track.slice(Math.max(0, i - 8), i + 1).filter((x) => first.ts - x.ts <= 300);
          const held = track.slice(i, end + 1).filter((x) => x.ts - first.ts >= 100);
          closingPinch = Math.max(closingPinch, spread(closing, pinchPoint));
          closingPalm = Math.max(closingPalm, spread(closing, palmPoint));
          heldPalm = Math.max(heldPalm, spread(held, palmPoint));
        }
      }
    }
    expect(closingPinch).toBeGreaterThan(0.05);
    expect(closingPalm).toBeLessThan(closingPinch / 4);
    expect(heldPalm).toBeLessThan(0.015);
  });
});
