import type { Point2, TrackedHand, Vec3 } from "@hai/protocol";
import { DEFAULT_GESTURES, type GestureConfig } from "./config.ts";

export const DEFAULT_ASPECT = 4 / 3;

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;
const FINGERS = {
  index: [8, 5],
  middle: [12, 9],
  ring: [16, 13],
  pinky: [20, 17],
} as const;
export type Finger = keyof typeof FINGERS;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length3 = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const point = (points: Vec3[], i: number): Vec3 => points[i] ?? [0, 0, 0];

/** Image-space distance with x scaled by the aspect ratio, so x and y use the same unit. */
function imageDistance(a: Vec3, b: Vec3, aspect: number): number {
  return Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
}

/**
 * Thumb-tip to index-tip distance divided by hand size (wrist to middle knuckle), in image space.
 * Measured on footage, image space separates touching (0.12-0.15) from open (about 1.2) hands far better than
 * MediaPipe's world coordinates, whose fingertip depth is noisy (a real pinch read 0.40 there). Other normalisers
 * (palm width, finger segment lengths) were tried on the labelled frames and separated touch from near miss no
 * better.
 */
export function pinchRatio(hand: TrackedHand, aspect = DEFAULT_ASPECT): number {
  const size = imageDistance(point(hand.image, WRIST), point(hand.image, MIDDLE_MCP), aspect);
  if (size === 0) return Number.POSITIVE_INFINITY;
  return imageDistance(point(hand.image, THUMB_TIP), point(hand.image, INDEX_TIP), aspect) / size;
}

/** Tip-to-wrist / knuckle-to-wrist in world space: about 1.5-1.9 extended, under 1 curled. */
export function fingerExtension(hand: TrackedHand, finger: Finger): number {
  const [tip, mcp] = FINGERS[finger];
  const wrist = point(hand.world, WRIST);
  const base = length3(sub(point(hand.world, mcp), wrist));
  return base === 0 ? 0 : length3(sub(point(hand.world, tip), wrist)) / base;
}

/** Mean extension of the middle, ring and little fingers: about 1.4-1.7 in a pinch, under 1.2 in or near a fist. */
export function othersExtension(hand: TrackedHand): number {
  return (
    (fingerExtension(hand, "middle") + fingerExtension(hand, "ring") + fingerExtension(hand, "pinky")) / 3
  );
}

/** Thumb tip to index knuckle, relative to hand size (world space). */
export function thumbSpread(hand: TrackedHand): number {
  const size = length3(sub(point(hand.world, MIDDLE_MCP), point(hand.world, WRIST)));
  return size === 0 ? 0 : length3(sub(point(hand.world, THUMB_TIP), point(hand.world, INDEX_MCP))) / size;
}

/**
 * How directly the palm faces the camera, -1..1. The palm normal comes from wrist, index and pinky knuckles;
 * its z sign flips with handedness (measured: a left palm facing the camera gives +0.95, a right one -0.95).
 */
export function palmFacing(hand: TrackedHand): number {
  const wrist = point(hand.world, WRIST);
  const a = sub(point(hand.world, INDEX_MCP), wrist);
  const b = sub(point(hand.world, PINKY_MCP), wrist);
  const n: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = length3(n);
  if (len === 0) return 0;
  const z = n[2] / len;
  return hand.handedness === "Left" ? z : -z;
}

export type Posture = "open-palm" | "fist" | "other";

export function posture(hand: TrackedHand, config: GestureConfig = DEFAULT_GESTURES): Posture {
  const p = config.posture;
  const ext = (Object.keys(FINGERS) as Finger[]).map((f) => fingerExtension(hand, f));
  if (ext.every((e) => e < p.curled)) return "fist";
  if (
    ext.every((e) => e > p.extended) &&
    thumbSpread(hand) > p.thumbSpread &&
    palmFacing(hand) > p.palmFacing
  ) {
    return "open-palm";
  }
  return "other";
}

/** Midpoint of thumb and index tips, mirrored to match the preview the user sees. */
export function pinchPoint(hand: TrackedHand): Point2 {
  const t = point(hand.image, THUMB_TIP);
  const i = point(hand.image, INDEX_TIP);
  return [1 - (t[0] + i[0]) / 2, (t[1] + i[1]) / 2];
}

/**
 * Centre of the palm (the wrist and the four finger knuckles), mirrored like `pinchPoint`. Unlike the fingertips it
 * does not move as the fingers curl, so it is the point a closed fist is followed by.
 */
export function palmPoint(hand: TrackedHand): Point2 {
  const joints = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP].map((i) => point(hand.image, i));
  const n = joints.length;
  return [1 - joints.reduce((sum, j) => sum + j[0], 0) / n, joints.reduce((sum, j) => sum + j[1], 0) / n];
}

/** Distance between two normalised points, in fractions of the frame width. */
export function screenDistance(a: Point2, b: Point2, aspect = DEFAULT_ASPECT): number {
  return Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
}
