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
}

export const DEFAULT_GAINS: NavigationGains = { orbitAzimuth: 270, orbitElevation: 120, pan: 1.2 };

export interface NavigationInput {
  /** Last two-hand reading, to compute deltas between updates. */
  lastTwoHand: { distance: number; midpoint: [number, number] } | null;
}

export const initialInput = (): NavigationInput => ({ lastTwoHand: null });

/**
 * Applies one gesture event to the camera. Pure: returns the new camera state.
 * - One-hand pinch drag orbits: dragging right turns the model with positive azimuth, dragging up raises the view.
 * - Two-hand pinch: hands apart zooms in, midpoint motion pans.
 */
export function navigate(
  t: Turntable,
  input: NavigationInput,
  event: GestureEvent,
  gains: NavigationGains = DEFAULT_GAINS,
): Turntable {
  switch (event.type) {
    case "pinch.drag.update":
      return orbit(t, event.delta[0] * gains.orbitAzimuth, -event.delta[1] * gains.orbitElevation);
    case "twohand.start":
      input.lastTwoHand = { distance: event.distance, midpoint: event.midpoint };
      return t;
    case "twohand.update": {
      const last = input.lastTwoHand;
      input.lastTwoHand = { distance: event.distance, midpoint: event.midpoint };
      if (!last || event.distance <= 0) return t;
      const zoomed = zoom(t, last.distance / event.distance);
      const dx = event.midpoint[0] - last.midpoint[0];
      const dy = event.midpoint[1] - last.midpoint[1];
      return pan(zoomed, dx * gains.pan, -dy * gains.pan);
    }
    case "twohand.end":
      input.lastTwoHand = null;
      return t;
    default:
      return t;
  }
}

/** True for the events that move the camera (used to stamp gesture-to-render latency). */
export const movesCamera = (event: GestureEvent): boolean =>
  event.type === "pinch.drag.update" || event.type === "twohand.update";
