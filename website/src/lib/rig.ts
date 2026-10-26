// A small 3D rig for the 21 MediaPipe hand landmarks: finger flex and spread, thumb opposition and flex,
// and named gestures. The hero projects it onto the SVG hand, so the hand can turn, wave and gesture in 3D
// while looking like HAI's own tracking overlay.
//
// Units are roughly centimetres. The palm faces the viewer (+z), fingers point up (+y), thumb on the left.

export type Vec = [number, number, number];

const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** Rotate v about a unit axis by `r` radians (Rodrigues). */
const turn = (v: Vec, k: Vec, r: number): Vec => {
  const c = Math.cos(r);
  const s = Math.sin(r);
  const kxv = cross(k, v);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + kxv[0] * s + k[0] * d * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * d * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * d * (1 - c),
  ];
};
export const rad = (d: number) => (d * Math.PI) / 180;

const THUMB_BASE: Vec = [-1.9, 1.1, 0.35];
const KNUCKLES: Vec[] = [
  [-1.55, 4.55, 0.05],
  [-0.45, 4.8, 0],
  [0.65, 4.6, -0.02],
  [1.65, 4.05, -0.05],
];
const LENGTHS = [
  [2.35, 1.45, 1.05],
  [2.65, 1.65, 1.15],
  [2.45, 1.55, 1.05],
  [1.95, 1.15, 0.95],
];
const THUMB_LENGTHS = [1.6, 1.3, 1.05];
// Resting fan of each finger in degrees (positive leans towards the thumb), scaled by `spread`.
const FAN = [7, 1.5, -4, -10];
const THUMB_OPEN = norm([-0.62, 0.72, 0.32]);
const THUMB_ACROSS = norm([0.62, 0.42, 0.66]);
const PALM_NORMAL: Vec = [0, 0, 1];

/** A hand pose. Angles in degrees. */
export interface Shape {
  /** Thumb opposition: 0 out to the side, 1 across the palm. */
  thumbO: number;
  /** Thumb flex, 0 to 1. */
  thumbF: number;
  /** Flex at the knuckle, middle and end joint of the index, middle, ring and little finger. */
  fingers: number[][];
  spread: number;
  /** Turn about the wrist in the screen plane, and about the hand's long axis. */
  roll: number;
  yaw: number;
}

/** The 21 landmarks of a shape, in hand space. */
export function landmarks(s: Shape): Vec[] {
  const pts: Vec[] = new Array(21);
  pts[0] = [0, 0, 0];

  // Thumb: its direction swings from out to the side towards across the palm, then curls about the axis
  // between that direction and the palm's normal.
  const d1 = norm(lerp(THUMB_OPEN, THUMB_ACROSS, s.thumbO));
  const axis = norm(cross(PALM_NORMAL, d1));
  const d2 = turn(d1, axis, rad(55 * s.thumbF));
  const d3 = turn(d2, axis, rad(65 * s.thumbF));
  pts[1] = THUMB_BASE;
  pts[2] = add(pts[1], d1, THUMB_LENGTHS[0]);
  pts[3] = add(pts[2], d2, THUMB_LENGTHS[1]);
  pts[4] = add(pts[3], d3, THUMB_LENGTHS[2]);

  // Fingers: flex accumulates along the finger, curling it towards the viewer and down into the palm.
  for (let f = 0; f < 4; f++) {
    const base = 5 + f * 4;
    const splay = rad(FAN[f] * s.spread);
    let phi = 0;
    pts[base] = KNUCKLES[f];
    for (let j = 0; j < 3; j++) {
      phi += rad(s.fingers[f][j]);
      const along = Math.cos(phi);
      pts[base + j + 1] = add(
        pts[base + j],
        [-Math.sin(splay) * along, Math.cos(splay) * along, Math.sin(phi)],
        LENGTHS[f][j],
      );
    }
  }
  return pts;
}

export const RELAXED = [6, 8, 4];
const STRAIGHT = [0, 0, 0];
const FOLDED = [88, 100, 62];

const shape = (o: Partial<Shape>): Shape => ({
  thumbO: 0,
  thumbF: 0.15,
  fingers: [RELAXED, RELAXED, RELAXED, RELAXED],
  spread: 1,
  roll: 0,
  yaw: 0,
  ...o,
});

export const SHAPES = {
  open: shape({}),
  fist: shape({ thumbO: 0.75, thumbF: 0.85, fingers: [FOLDED, FOLDED, FOLDED, FOLDED], spread: 0 }),
  point: shape({ thumbO: 0.7, thumbF: 0.8, fingers: [STRAIGHT, FOLDED, FOLDED, FOLDED], spread: 0.3 }),
  peace: shape({ thumbO: 0.7, thumbF: 0.85, fingers: [STRAIGHT, STRAIGHT, FOLDED, FOLDED], spread: 2 }),
  three: shape({ thumbO: 0.7, thumbF: 0.85, fingers: [STRAIGHT, STRAIGHT, STRAIGHT, FOLDED], spread: 1.4 }),
  four: shape({ thumbO: 0.85, thumbF: 0.7, fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], spread: 1.3 }),
  ok: shape({ thumbO: 0.42, thumbF: 0.62, fingers: [[38, 72, 48], RELAXED, RELAXED, RELAXED], spread: 1.2 }),
  rock: shape({ thumbO: 0.65, thumbF: 0.75, fingers: [STRAIGHT, FOLDED, FOLDED, STRAIGHT], spread: 1.6 }),
  callMe: shape({ thumbF: 0, fingers: [FOLDED, FOLDED, FOLDED, STRAIGHT], spread: 1.8, roll: -18 }),
  thumbsUp: shape({ thumbF: 0, fingers: [FOLDED, FOLDED, FOLDED, FOLDED], spread: 0, roll: -38, yaw: 35 }),
};
export type ShapeName = keyof typeof SHAPES;

/** Turn hand-space points: yaw and pitch about the middle of the palm, then roll about the wrist. */
export function orient(pts: Vec[], yaw: number, pitch: number, roll: number): Vec[] {
  const cy = Math.cos(rad(yaw));
  const sy = Math.sin(rad(yaw));
  const cp = Math.cos(rad(pitch));
  const sp = Math.sin(rad(pitch));
  const cr = Math.cos(rad(roll));
  const sr = Math.sin(rad(roll));
  const PIVOT_Y = 4;
  return pts.map(([x, y0, z]) => {
    const y = y0 - PIVOT_Y;
    // Yaw about the vertical axis, then pitch about the horizontal one.
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const y3 = y2 + PIVOT_Y;
    return [x1 * cr - y3 * sr, x1 * sr + y3 * cr, z2];
  });
}
