import type { ViewRequest } from "@hai/protocol";
import type { BoundsMm } from "./bounds.ts";
import {
  DISTANCE_MAX,
  DISTANCE_MIN,
  ELEVATION_MAX,
  ELEVATION_MIN,
  frameBox,
  type Turntable,
} from "./turntable.ts";

/** How long the camera takes to reach a view the agent asked for. */
export const VIEW_ANIMATION_MS = 400;

const MM = 0.001;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A box in millimetres. */
export type BoxMm = BoundsMm;

/**
 * The camera the agent asked for, from the camera now. What the request leaves out stays as it is. Framing elements
 * puts their box in view from the current angle (or the one asked for); a target or a distance asked for as well win
 * over the framing.
 */
export function resolveView(
  current: Turntable,
  request: ViewRequest,
  boxOf: (ids: string[]) => BoxMm | null,
): Turntable {
  let next: Turntable = { ...current };
  if (request.frame) {
    const box = boxOf(request.frame);
    if (box) {
      const framed = frameBox(
        [box.min[0] * MM, box.min[1] * MM, box.min[2] * MM],
        [box.max[0] * MM, box.max[1] * MM, box.max[2] * MM],
      );
      next = { ...framed, azimuth: current.azimuth, elevation: current.elevation };
    }
  }
  if (request.target) next.target = [request.target[0] * MM, request.target[1] * MM, request.target[2] * MM];
  if (request.azimuth !== undefined) next.azimuth = ((request.azimuth % 360) + 360) % 360;
  if (request.elevation !== undefined)
    next.elevation = clamp(request.elevation, ELEVATION_MIN, ELEVATION_MAX);
  if (request.distance !== undefined)
    next.distance = clamp(request.distance * MM, DISTANCE_MIN, DISTANCE_MAX);
  return next;
}

/** An angle difference brought into -180..180 degrees, the short way round. */
const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The camera part of the way from one view to another (t from 0 to 1), turning the short way round. */
export function between(from: Turntable, to: Turntable, t: number): Turntable {
  const e = easeInOut(clamp(t, 0, 1));
  const mix = (a: number, b: number) => a + (b - a) * e;
  return {
    target: [
      mix(from.target[0], to.target[0]),
      mix(from.target[1], to.target[1]),
      mix(from.target[2], to.target[2]),
    ],
    azimuth: (((from.azimuth + wrap180(to.azimuth - from.azimuth) * e) % 360) + 360) % 360,
    elevation: mix(from.elevation, to.elevation),
    distance: mix(from.distance, to.distance),
  };
}
