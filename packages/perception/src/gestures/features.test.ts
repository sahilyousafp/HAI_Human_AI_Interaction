import { describe, expect, it } from "vitest";
import { loadFixture, loadPinchLabels } from "../testing/fixtures.ts";
import { DEFAULT_GESTURES } from "./config.ts";
import { othersExtension, palmFacing, pinchPoint, pinchRatio, posture, screenDistance } from "./features.ts";

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

  it("no near miss starts a pinch: a visible gap between thumb and index is never a touch", () => {
    expect(
      of("near-miss")
        .filter(startsPinch)
        .map((l) => `${l.clip}#${l.seq}`),
    ).toEqual([]);
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
