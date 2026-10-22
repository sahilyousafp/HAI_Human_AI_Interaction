import type { TrackedHand } from "@hai/protocol";

type Px = [number, number];

/** One finger bone as a tapered capsule: centre line from `a` to `b`, widths at each end, depth for ordering. */
export interface Capsule {
  kind: "bone";
  a: Px;
  b: Px;
  widthA: number;
  widthB: number;
  /** MediaPipe's relative depth (smaller is nearer the camera). */
  depth: number;
}

/** The palm as a filled polygon, with how much to round its corners (an outline width, px). */
export interface Palm {
  kind: "palm";
  points: Px[];
  roundness: number;
  depth: number;
}

export type HandPiece = Capsule | Palm;

/** Bones per finger, wrist side first (MediaPipe hand landmark indices). */
const FINGERS: number[][] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
/** The palm outline: wrist, thumb base, and the four finger knuckles back round to the wrist. */
const PALM = [0, 1, 2, 5, 9, 13, 17];

/** Finger width at the knuckle and at the tip, as a share of the hand's size (wrist to middle knuckle). */
const WIDTH_BASE = 0.24;
const WIDTH_TIP = 0.17;
/** The thumb is a little thicker. */
const THUMB_SCALE = 1.15;
/** How much nearer (smaller z) widens a piece, and the limits, so depth reads as 2.5D without distorting. */
const DEPTH_GAIN = 2.5;
const DEPTH_MIN = 0.8;
const DEPTH_MAX = 1.35;

/**
 * Where a hand is drawn on screen: its pinch point (between thumb and index tips) sits on `anchor`, the hand's
 * pointer, and it keeps its proportions at `scale` pixels per unit of camera height. The image is mirrored, as in
 * the preview, so the drawn hand moves like a reflection of the user's own.
 *
 * Only landmarks are used: no camera image ever reaches the page.
 */
export function handPieces(hand: TrackedHand, anchor: Px, scale: number, aspect: number): HandPiece[] {
  const thumb = hand.image[4];
  const index = hand.image[8];
  if (!thumb || !index) return [];
  // The pinch point, mirrored: the same point the pointer follows.
  const pinchX = 1 - (thumb[0] + index[0]) / 2;
  const pinchY = (thumb[1] + index[1]) / 2;
  const at = (i: number): Px => {
    const p = hand.image[i] ?? [0, 0, 0];
    return [anchor[0] + (1 - p[0] - pinchX) * aspect * scale, anchor[1] + (p[1] - pinchY) * scale];
  };
  const depthOf = (i: number) => hand.image[i]?.[2] ?? 0;
  const near = (z: number) => Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, 1 - z * DEPTH_GAIN));
  const wrist = at(0);
  const knuckle = at(9);
  const size = Math.hypot(knuckle[0] - wrist[0], knuckle[1] - wrist[1]);

  const pieces: HandPiece[] = [
    {
      kind: "palm",
      points: PALM.map(at),
      roundness: WIDTH_BASE * size,
      depth: PALM.reduce((sum, i) => sum + depthOf(i), 0) / PALM.length,
    },
  ];
  for (const [f, finger] of FINGERS.entries()) {
    const widthScale = f === 0 ? THUMB_SCALE : 1;
    for (let j = 0; j < finger.length - 1; j++) {
      const ia = finger[j] as number;
      const ib = finger[j + 1] as number;
      // Taper from knuckle to tip along the finger's three bones.
      const wa = WIDTH_BASE + ((WIDTH_TIP - WIDTH_BASE) * j) / (finger.length - 1);
      const wb = WIDTH_BASE + ((WIDTH_TIP - WIDTH_BASE) * (j + 1)) / (finger.length - 1);
      pieces.push({
        kind: "bone",
        a: at(ia),
        b: at(ib),
        widthA: wa * size * widthScale * near(depthOf(ia)),
        widthB: wb * size * widthScale * near(depthOf(ib)),
        depth: (depthOf(ia) + depthOf(ib)) / 2,
      });
    }
  }
  // Farther pieces first, so nearer fingers are drawn over them.
  return pieces.sort((p, q) => q.depth - p.depth);
}
