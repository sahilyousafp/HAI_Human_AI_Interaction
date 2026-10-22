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
    /**
     * A pinch released before `holdMs` that moved less than this fraction of the frame width is a tap; moving this far
     * starts a drag.
     */
    tapMaxMove: number;
    /**
     * Mean extension of the middle, ring and little fingers must reach this for a pinch to start, so a hand closing
     * into (or opening from) a fist, whose thumb passes the index on the way, is never read as a pinch.
     */
    othersMin: number;
    /** A pinching hand that tracking loses for less than this (fast sweeps, passing the face) is still pinching. */
    lostGraceMs: number;
    /** A pinch held this long... */
    holdMs: number;
    /** ...while moving less than this fraction of the frame width is a hold (long pinch). */
    holdMaxMove: number;
    /**
     * A tap counts only once the fingers open past this ratio within `tapOpenMs` of letting go, so a hand that
     * closes toward a pinch and stays half closed (sweeping past the face, say) never clicks.
     */
    tapOpen: number;
    tapOpenMs: number;
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
    /**
     * A fist that moves this fraction of the frame width from where it closed is a fist drag (it pans), and never a
     * hold (cancel). Measured on the palm point, which stays put while the fingers curl.
     */
    moveMin: number;
  };
  twoHand: {
    /**
     * Both pinches must begin within this of each other to become a two-hand pinch (navigation). A hand that already
     * holds (a ring is open) or drags on its own keeps its own gesture, and the other hand's pinch stays separate.
     */
    startWindowMs: number;
  };
  stop: {
    /** Both hands closed into fists together this long arms the stop... */
    fistsMs: number;
    /** ...and both palms opened toward the camera within this of the fists opening stops. */
    openMs: number;
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
 * Values measured on recorded footage (test-assets/landmarks): extended fingers read 1.5-1.9, curled 0.75-0.95.
 * Pinch values come from frames labelled by eye (test-assets/landmarks/pinch-labels.json.gz): fingertips touching
 * read 0.12-0.15 when held, a near miss with a visible 1-3 mm gap 0.18-0.21, open hands about 1.2. In real pinches
 * the other fingers' mean extension is 1.38 or more; hands passing into or out of a fist read 1.17 or less.
 */
export const DEFAULT_GESTURES: GestureConfig = {
  engage: { openPalmMs: 300, noHandsMs: 1500, idleMs: 10_000 },
  pinch: {
    // 0.16 plus a 5% buffer, so fingertips that only just meet still pinch (one labelled near miss, at 0.166,
    // falls inside the buffer; every visible gap above it does not).
    press: 0.168,
    release: 0.2,
    minHoldMs: 60,
    tapMaxMove: 0.04,
    othersMin: 1.3,
    lostGraceMs: 250,
    holdMs: 800,
    holdMaxMove: 0.04,
    tapOpen: 0.3,
    tapOpenMs: 200,
  },
  posture: { extended: 1.35, curled: 1.15, thumbSpread: 0.45, palmFacing: 0.5 },
  clutch: { debounceMs: 100, moveMin: 0.03 },
  twoHand: { startWindowMs: 300 },
  stop: { fistsMs: 250, openMs: 1000 },
  head: { windowMs: 1200, nodDegrees: 8, shakeDegrees: 10, reversals: 2, cooldownMs: 1000 },
};
