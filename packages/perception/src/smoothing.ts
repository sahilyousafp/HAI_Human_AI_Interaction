import type { TrackedFace, TrackedHand, TrackingFrame, Vec3 } from "@aex/protocol";
import { DEFAULT_ONE_EURO, type OneEuroParams, OneEuroVector } from "./one-euro.ts";

/** A hand that disappears for longer than this re-enters fresh instead of sliding in from its old position. */
export const HAND_RESET_MS = 200;

const flatten = (points: Vec3[], out: Float64Array, offset = 0) => {
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Vec3;
    out[offset + i * 3] = p[0];
    out[offset + i * 3 + 1] = p[1];
    out[offset + i * 3 + 2] = p[2];
  }
};

const unflatten = (data: Float64Array, count: number, offset = 0): Vec3[] =>
  Array.from({ length: count }, (_, i) => [
    data[offset + i * 3] ?? 0,
    data[offset + i * 3 + 1] ?? 0,
    data[offset + i * 3 + 2] ?? 0,
  ]);

class HandFilter {
  private readonly filter: OneEuroVector;
  private readonly input: Float64Array;
  private readonly output: Float64Array;
  constructor(
    private readonly count: number,
    params: OneEuroParams,
  ) {
    this.filter = new OneEuroVector(count * 6, params);
    this.input = new Float64Array(count * 6);
    this.output = new Float64Array(count * 6);
  }
  apply(hand: TrackedHand, ts: number): TrackedHand {
    flatten(hand.image, this.input, 0);
    flatten(hand.world, this.input, this.count * 3);
    this.filter.filter(this.input, ts, this.output);
    return {
      ...hand,
      image: unflatten(this.output, this.count, 0),
      world: unflatten(this.output, this.count, this.count * 3),
    };
  }
  reset() {
    this.filter.reset();
  }
  get lastTs() {
    return this.filter.lastTimestamp;
  }
}

/** Smooths every point of a tracking frame: per-hand banks keyed by handedness, plus face landmarks and head pose. */
export class FrameSmoother {
  private readonly hands = new Map<TrackedHand["handedness"], HandFilter>();
  private faceFilter: OneEuroVector | null = null;
  private readonly headFilter: OneEuroVector;

  constructor(private readonly params: OneEuroParams = DEFAULT_ONE_EURO) {
    // Head pose is in degrees, so scale beta down to keep the same feel as normalised coordinates.
    this.headFilter = new OneEuroVector(3, { ...params, beta: params.beta / 100 });
  }

  smooth(frame: TrackingFrame): TrackingFrame {
    const ts = frame.captureTs;
    const seen = new Set<TrackedHand["handedness"]>();
    const hands = frame.hands.map((hand) => {
      seen.add(hand.handedness);
      let filter = this.hands.get(hand.handedness);
      if (!filter) {
        filter = new HandFilter(hand.image.length, this.params);
        this.hands.set(hand.handedness, filter);
      } else if (filter.lastTs !== null && ts - filter.lastTs > HAND_RESET_MS) {
        filter.reset();
      }
      return filter.apply(hand, ts);
    });
    for (const [side, filter] of this.hands) {
      if (!seen.has(side) && filter.lastTs !== null && ts - filter.lastTs > HAND_RESET_MS) filter.reset();
    }
    return { ...frame, hands, ...(frame.face ? { face: this.smoothFace(frame.face, ts) } : {}) };
  }

  private smoothFace(face: TrackedFace, ts: number): TrackedFace {
    const n = face.landmarks.length;
    if (!this.faceFilter || this.faceFilter.size !== n * 3)
      this.faceFilter = new OneEuroVector(n * 3, this.params);
    const flat = new Float64Array(n * 3);
    flatten(face.landmarks, flat);
    const out = this.faceFilter.filter(flat, ts);
    const pose = this.headFilter.filter([face.headPose.yaw, face.headPose.pitch, face.headPose.roll], ts);
    return {
      ...face,
      landmarks: unflatten(out, n),
      headPose: { yaw: pose[0] ?? 0, pitch: pose[1] ?? 0, roll: pose[2] ?? 0 },
    };
  }
}
