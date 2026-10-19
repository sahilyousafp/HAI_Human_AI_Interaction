import type { RecognizerState } from "@aex/perception";
import type { GestureEvent } from "@aex/protocol";

/** How long the last gesture stays on the HUD, so short gestures like a tap are readable. */
export const LAST_GESTURE_HOLD_MS = 1500;

export interface GestureSnapshot {
  state: RecognizerState;
  last: { event: GestureEvent; shownAt: number } | null;
  /** Rolling average time in the recogniser, ms. */
  gestureMs: number;
}

const EMPTY: GestureSnapshot = {
  state: { engaged: false, hands: {}, twoHand: false, lastHead: null },
  last: null,
  gestureMs: 0,
};

/** Tiny external store so only the gesture panel re-renders at frame rate, not the whole tracking panel. */
export class GestureStore {
  private snapshot = EMPTY;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GestureSnapshot => this.snapshot;

  push(events: GestureEvent[], state: RecognizerState, gestureMs: number): void {
    // Show the most meaningful event: drag updates and two-hand updates are too frequent to read.
    const shown = [...events].reverse().find((e) => !e.type.endsWith(".update"));
    const last = shown ? { event: shown, shownAt: performance.now() } : this.snapshot.last;
    this.snapshot = {
      state,
      last,
      gestureMs: this.snapshot.gestureMs * 0.9 + gestureMs * 0.1,
    };
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    this.snapshot = EMPTY;
    for (const listener of this.listeners) listener();
  }
}
