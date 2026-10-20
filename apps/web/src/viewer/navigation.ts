import type { GestureEvent } from "@aex/protocol";
import { orbit, pan, type Turntable, zoom } from "./turntable.ts";

/** How strongly hand motion moves the camera. Positions are fractions of the camera frame. */
export interface NavigationGains {
  /** Degrees of azimuth per full frame width of hand movement. */
  orbitAzimuth: number;
  /** Degrees of elevation per full frame height of hand movement. */
  orbitElevation: number;
  /** Pan in view heights per full frame of two-hand midpoint movement. */
  pan: number;
  /** Degrees the view turns per degree the two pinching hands turn. */
  rotate: number;
}

export const DEFAULT_GAINS: NavigationGains = { orbitAzimuth: 270, orbitElevation: 120, pan: 1.2, rotate: 1 };

/** Turns of the two-hand line smaller than this per update are tracking jitter, not a rotation. */
const ROTATE_DEADZONE_DEG = 0.6;

/** How the camera is moving: per millisecond, in the units the camera changes in. */
export interface Motion {
  /** Degrees. */
  azimuth: number;
  elevation: number;
  /** Natural log of the distance factor (negative zooms in). */
  zoom: number;
  /** View heights, screen right and up. */
  panX: number;
  panY: number;
}

const STILL: Motion = { azimuth: 0, elevation: 0, zoom: 0, panX: 0, panY: 0 };

/** A flick is measured over the motion of this last stretch before the release. */
export const FLING_WINDOW_MS = 100;
/** After a flick the view coasts, slowing with this time constant (it travels about speed x this far). */
export const COAST_DECAY_MS = 320;
/** Slower than this (per millisecond) is not a flick, and a coast this slow stops. */
const MIN_SPEED: Motion = { azimuth: 0.04, elevation: 0.04, zoom: 0.0004, panX: 0.0003, panY: 0.0003 };
/** A flick never coasts faster than this, whatever tracking reported as the hand opened. */
const MAX_SPEED: Motion = { azimuth: 0.6, elevation: 0.3, zoom: 0.006, panX: 0.004, panY: 0.004 };

export interface NavigationInput {
  /** Last two-hand reading, to compute deltas between updates. */
  lastTwoHand: { distance: number; midpoint: [number, number]; angle: number } | null;
  /** What a one-hand drag does (the user's gesture setting). */
  dragMode: "orbit" | "pan";
  /** The camera changes of the running gesture, with their capture time, to measure a flick on release. */
  samples: Array<Motion & { ts: number }>;
  /** Set after a flick: the view keeps moving like this, slowing down, until it stops or is grabbed. */
  momentum: Motion | null;
}

export const initialInput = (): NavigationInput => ({
  lastTwoHand: null,
  dragMode: "orbit",
  samples: [],
  momentum: null,
});

const KEYS = Object.keys(STILL) as Array<keyof Motion>;
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Applies one camera change (amounts, not rates). */
function move(t: Turntable, m: Motion): Turntable {
  let next = t;
  if (m.azimuth || m.elevation) next = orbit(next, m.azimuth, m.elevation);
  if (m.zoom) next = zoom(next, Math.exp(m.zoom));
  if (m.panX || m.panY) next = pan(next, m.panX, m.panY);
  return next;
}

/** The release velocity of a gesture, if it was a flick: its motion over the last `FLING_WINDOW_MS`. */
export function fling(samples: Array<Motion & { ts: number }>, endTs: number): Motion | null {
  const recent = samples.filter((s) => s.ts >= endTs - FLING_WINDOW_MS);
  if (recent.length < 2) return null;
  const span = Math.max(16, endTs - (recent[0]?.ts ?? endTs));
  const velocity = { ...STILL };
  let fast = false;
  for (const key of KEYS) {
    const v = recent.reduce((sum, s) => sum + s[key], 0) / span;
    velocity[key] = Math.max(-MAX_SPEED[key], Math.min(MAX_SPEED[key], v));
    if (Math.abs(velocity[key]) >= MIN_SPEED[key]) fast = true;
  }
  return fast ? velocity : null;
}

/**
 * Moves the camera by `dtMs` of coasting and slows the momentum down; clears it once it is too slow to see.
 * Returns the new camera.
 */
export function coast(t: Turntable, input: NavigationInput, dtMs: number): Turntable {
  const m = input.momentum;
  if (!m) return t;
  // Exact distance for an exponentially slowing speed over dt: v * tau * (1 - e^(-dt/tau)).
  const decay = Math.exp(-dtMs / COAST_DECAY_MS);
  const travel = COAST_DECAY_MS * (1 - decay);
  const step = { ...STILL };
  let moving = false;
  for (const key of KEYS) {
    step[key] = m[key] * travel;
    m[key] *= decay;
    if (Math.abs(m[key]) >= MIN_SPEED[key] / 4) moving = true;
  }
  if (!moving) input.momentum = null;
  return move(t, step);
}

/**
 * Applies one gesture event to the camera. Pure apart from `input`: returns the new camera state.
 * - One-hand pinch drag orbits like dragging the model with the mouse: dragging right turns the camera to negative
 *   azimuth, dragging down raises the view. Set to pan, it moves the view like the two-hand midpoint does.
 * - Two-hand pinch: hands apart zooms in; the view pans opposite to the midpoint's motion; turning the hands like a
 *   dial turns the view.
 * - Releasing while still moving is a flick: `input.momentum` is set and `coast` keeps the view moving. Grabbing
 *   again stops it.
 */
export function navigate(
  t: Turntable,
  input: NavigationInput,
  event: GestureEvent,
  gains: NavigationGains = DEFAULT_GAINS,
): Turntable {
  const record = (m: Partial<Motion>) => {
    const change = { ...STILL, ...m };
    input.samples.push({ ...change, ts: event.ts });
    if (input.samples.length > 30) input.samples.shift();
    return move(t, change);
  };
  switch (event.type) {
    case "pinch.drag.start":
      input.momentum = null;
      input.samples = [];
      return t;
    case "pinch.drag.update":
      if (input.dragMode === "pan")
        return record({ panX: -event.delta[0] * gains.pan, panY: event.delta[1] * gains.pan });
      return record({
        azimuth: -event.delta[0] * gains.orbitAzimuth,
        elevation: event.delta[1] * gains.orbitElevation,
      });
    case "twohand.start":
      input.momentum = null;
      input.samples = [];
      input.lastTwoHand = { distance: event.distance, midpoint: event.midpoint, angle: event.angle };
      return t;
    case "twohand.update": {
      const last = input.lastTwoHand;
      if (!last || event.distance <= 0) return t;
      const turn = wrap180(event.angle - last.angle);
      const turned = Math.abs(turn) >= ROTATE_DEADZONE_DEG;
      input.lastTwoHand = {
        distance: event.distance,
        midpoint: event.midpoint,
        angle: turned ? event.angle : last.angle, // small turns add up until they clear the dead zone
      };
      return record({
        zoom: Math.log(last.distance / event.distance),
        panX: -(event.midpoint[0] - last.midpoint[0]) * gains.pan,
        panY: (event.midpoint[1] - last.midpoint[1]) * gains.pan,
        // Turning the hands clockwise on screen turns the model clockwise, like turning it on a table.
        azimuth: turned ? turn * gains.rotate : 0,
      });
    }
    case "pinch.drag.end":
    case "twohand.end":
      input.momentum = fling(input.samples, event.ts);
      input.samples = [];
      input.lastTwoHand = null;
      return t;
    default:
      return t;
  }
}

/** True for the events that move the camera (used to stamp gesture-to-render latency). */
export const movesCamera = (event: GestureEvent): boolean =>
  event.type === "pinch.drag.update" || event.type === "twohand.update";
