import type { TrackedHand } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { type Capsule, handPieces } from "./hand-geometry.ts";

/** A flat right hand: wrist low, fingers up, thumb and index tips meeting at (0.5, 0.3) in the image. */
function hand(depth: (i: number) => number = () => 0): TrackedHand {
  const image = Array.from({ length: 21 }, (_, i) => {
    const finger = i === 0 ? -1 : Math.floor((i - 1) / 4);
    const joint = i === 0 ? 0 : (i - 1) % 4;
    const x = i === 0 ? 0.5 : 0.42 + finger * 0.04;
    const y = i === 0 ? 0.7 : 0.6 - joint * 0.06;
    return [x, y, depth(i)] as [number, number, number];
  });
  image[4] = [0.5, 0.3, depth(4)];
  image[8] = [0.5, 0.3, depth(8)];
  return {
    handedness: "Right",
    score: 1,
    image,
    world: image.map(() => [0, 0, 0] as [number, number, number]),
  };
}

const bones = (pieces: ReturnType<typeof handPieces>) =>
  pieces.filter((p): p is Capsule => p.kind === "bone");

describe("hand overlay geometry", () => {
  it("the pinch point lands on the anchor, the hand's pointer", () => {
    const pieces = handPieces(hand(), [400, 300], 1000, 4 / 3);
    const thumbTip = bones(pieces).find((b) => b.widthB > 0 && b.b[1] === 300 && b.b[0] === 400);
    expect(thumbTip).toBeDefined();
  });

  it("keeps the hand's proportions: one scale for both axes (x in camera widths)", () => {
    const pieces = handPieces(hand(), [0, 0], 1000, 4 / 3);
    const palm = pieces.find((p) => p.kind === "palm");
    if (palm?.kind !== "palm") throw new Error("no palm");
    const [wrist] = palm.points;
    // The wrist is 0.4 of the camera height below the pinch point: 400 px at this scale.
    expect(wrist?.[1]).toBeCloseTo(400);
    // Index knuckle (x 0.46 in the image) lies 0.04 camera widths right of the pinch point once mirrored.
    const indexKnuckle = palm.points[3];
    expect(indexKnuckle?.[0]).toBeCloseTo(0.04 * (4 / 3) * 1000);
  });

  it("a finger nearer the camera is drawn wider, and over the farther ones", () => {
    const flat = bones(handPieces(hand(), [0, 0], 1000, 4 / 3));
    const nearIndex = (i: number) => (i >= 5 && i <= 8 ? -0.08 : 0);
    const raised = handPieces(hand(nearIndex), [0, 0], 1000, 4 / 3);
    const indexWidth = (list: Capsule[]) =>
      Math.max(...list.filter((b) => b.depth < 0).map((b) => b.widthA), 0);
    expect(indexWidth(bones(raised))).toBeGreaterThan(Math.max(...flat.map((b) => b.widthA)));
    // Drawn back to front: the near index bones come last.
    expect(raised.at(-1)?.depth).toBeLessThan(0);
  });

  it("fingers taper from knuckle to tip", () => {
    const list = bones(handPieces(hand(), [0, 0], 1000, 4 / 3));
    for (const b of list) expect(b.widthB).toBeLessThan(b.widthA);
  });
});
