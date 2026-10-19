/** Every gesture threshold in one place. docs/gestures.md is checked against these values by a unit test. */
export interface GestureConfig {
  engage: {
    /** Open palm held this long engages. */
    openPalmMs: number;
    /** No hand visible this long disengages. */
    noHandsMs: number;
    /** No gesture this long disengages. */
    idleMs: number;
  };
  pinch: {
    /** Thumb-index distance / hand size (image space) below this starts a pinch... */
    press: number;
    /** ...and above this ends it (hysteresis). */
    release: number;
    /** The ratio must stay below `press` this long before a pinch starts. */
    minHoldMs: number;
    /** A pinch shorter than this that moves less than `tapMaxMove` is a tap. */
    tapMaxMs: number;
    /** Fraction of the frame width. */
    tapMaxMove: number;
  };
  posture: {
    /** Tip-to-wrist / knuckle-to-wrist above this means the finger is extended. */
    extended: number;
    /** ...and below this means it is curled. */
    curled: number;
    /** Thumb tip to index knuckle / hand size above this means the thumb is spread. */
    thumbSpread: number;
    /** Palm normal toward the camera (-1..1) above this counts as facing it. */
    palmFacing: number;
  };
  clutch: {
    /** A fist must hold (or be released) this long before clutch starts (or ends). */
    debounceMs: number;
  };
  head: {
    windowMs: number;
    nodDegrees: number;
    shakeDegrees: number;
    /** Reversals needed inside the window. */
    reversals: number;
    /** After a nod or shake, ignore head motion this long so one gesture fires once. */
    cooldownMs: number;
  };
}

/**
 * Thresholds from the spec, with posture values measured on recorded footage (test-assets/landmarks):
 * extended fingers read 1.5-1.9, curled 0.75-0.95; pinched hands 0.12-0.17, open hands about 1.2.
 */
export const DEFAULT_GESTURES: GestureConfig = {
  engage: { openPalmMs: 300, noHandsMs: 1500, idleMs: 10_000 },
  pinch: { press: 0.25, release: 0.35, minHoldMs: 60, tapMaxMs: 250, tapMaxMove: 0.02 },
  posture: { extended: 1.35, curled: 1.15, thumbSpread: 0.45, palmFacing: 0.5 },
  clutch: { debounceMs: 100 },
  head: { windowMs: 1200, nodDegrees: 8, shakeDegrees: 10, reversals: 2, cooldownMs: 1000 },
};
