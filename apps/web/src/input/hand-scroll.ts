import type { ScrollGrab } from "../tools/controller.ts";

/** Released faster than this (px per ms), a scrolled area coasts on. */
export const FLICK_MIN_PX_PER_MS = 0.3;
/** Coasting slows down with this time constant, ms (about 3 s to a stop from a fast flick). */
export const COAST_TAU_MS = 325;
/** The release speed is measured over the last this many ms of the drag. */
export const VELOCITY_WINDOW_MS = 100;
/** Coasting stops below this speed, px per ms. */
const COAST_STOP_PX_PER_MS = 0.02;

/** Speed (px per ms) over the last `VELOCITY_WINDOW_MS` of position samples, or 0 if too few. */
export function releaseVelocity(samples: Array<{ t: number; y: number }>, now: number): number {
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || last.t - first.t < 16) return 0;
  return (last.y - first.y) / (last.t - first.t);
}

/** One step of coasting: how far it moves in `dt` ms and the speed after, slowing exponentially. */
export function coastStep(velocity: number, dt: number): { move: number; velocity: number } {
  const decay = Math.exp(-dt / COAST_TAU_MS);
  // The exact integral of an exponentially slowing speed over dt.
  return { move: velocity * COAST_TAU_MS * (1 - decay), velocity: velocity * decay };
}

/** Each area's running coast, so grabbing it again catches it, as a finger does on a phone. */
const coasting = new WeakMap<HTMLElement, () => void>();

export interface ScrollClock {
  now(): number;
  frame(callback: (t: number) => void): number;
  cancel(id: number): void;
}

const browserClock: ScrollClock = {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * Grabs a scrolled area for a hand: the content follows the hand (moving the hand down shows what is above, like a
 * finger on a phone), and a quick release coasts on and slows down.
 */
export function grabScroll(
  el: HTMLElement,
  /** Height of the space hand movements are measured in (the viewer), px. */
  spacePx: () => number,
  clock: ScrollClock = browserClock,
): ScrollGrab {
  coasting.get(el)?.();
  const samples: Array<{ t: number; y: number }> = [];
  let handY = 0;
  return {
    move(dy) {
      const px = dy * spacePx();
      handY += px;
      el.scrollTop -= px;
      const t = clock.now();
      samples.push({ t, y: handY });
      while (samples.length > 0 && t - (samples[0]?.t ?? t) > VELOCITY_WINDOW_MS) samples.shift();
    },
    release() {
      let velocity = -releaseVelocity(samples, clock.now());
      if (Math.abs(velocity) < FLICK_MIN_PX_PER_MS) return;
      let last = clock.now();
      let id = 0;
      const stop = () => {
        clock.cancel(id);
        coasting.delete(el);
      };
      const step = (t: number) => {
        const { move, velocity: next } = coastStep(velocity, t - last);
        last = t;
        velocity = next;
        const before = el.scrollTop;
        el.scrollTop += move;
        // Stops when slow enough, or at either end of the content.
        if (Math.abs(velocity) < COAST_STOP_PX_PER_MS || el.scrollTop === before) {
          stop();
          return;
        }
        id = clock.frame(step);
      };
      coasting.set(el, stop);
      id = clock.frame(step);
    },
  };
}
