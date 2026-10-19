import type { GestureEvent, Point2 } from "@aex/protocol";

/** Where the hand pointer is (mirrored, normalised preview coordinates) and when it was captured. */
export interface PointerSample {
  position: Point2 | null;
  ts: number;
}

type GestureListener = (events: GestureEvent[]) => void;
type PointerListener = (sample: PointerSample) => void;
type EngagedListener = (engaged: boolean) => void;

/**
 * Carries hand input from the tracking panel to whatever consumes it (the viewer, later the tool palette).
 * End-to-end tests inject into the same bus, so they exercise exactly the path real gestures take.
 */
export class InputBus {
  private readonly gestureListeners = new Set<GestureListener>();
  private readonly pointerListeners = new Set<PointerListener>();
  private readonly engagedListeners = new Set<EngagedListener>();
  private engagedNow = false;

  get engaged(): boolean {
    return this.engagedNow;
  }

  onGestures(listener: GestureListener): () => void {
    this.gestureListeners.add(listener);
    return () => this.gestureListeners.delete(listener);
  }

  onPointer(listener: PointerListener): () => void {
    this.pointerListeners.add(listener);
    return () => this.pointerListeners.delete(listener);
  }

  onEngaged(listener: EngagedListener): () => void {
    this.engagedListeners.add(listener);
    return () => this.engagedListeners.delete(listener);
  }

  emitGestures(events: GestureEvent[]): void {
    if (events.length === 0) return;
    for (const listener of this.gestureListeners) listener(events);
  }

  emitPointer(sample: PointerSample): void {
    for (const listener of this.pointerListeners) listener(sample);
  }

  setEngaged(engaged: boolean): void {
    if (engaged === this.engagedNow) return;
    this.engagedNow = engaged;
    for (const listener of this.engagedListeners) listener(engaged);
  }
}
