import type { GestureEvent, Hand, Point2 } from "@aex/protocol";

/** Where the hand pointers are (mirrored, normalised preview coordinates) and when they were captured. */
export interface PointerSample {
  /** Each visible hand's pinch point: both hands point, hover and press alike. */
  hands: Partial<Record<Hand, Point2>>;
  /** Width / height of the camera frame the positions are in. */
  aspect?: number;
  ts: number;
}

type GestureListener = (events: GestureEvent[]) => void;
type PointerListener = (sample: PointerSample) => void;
type FlagListener = (value: boolean) => void;

/**
 * Carries hand input from the tracking panel to whatever consumes it (the viewer, later the tool palette).
 * End-to-end tests inject into the same bus, so they exercise exactly the path real gestures take.
 */
export class InputBus {
  private readonly gestureListeners = new Set<GestureListener>();
  private readonly pointerListeners = new Set<PointerListener>();
  private readonly engagedListeners = new Set<FlagListener>();
  private readonly stopArmedListeners = new Set<FlagListener>();
  private engagedNow = false;
  private stopArmedNow = false;

  get engaged(): boolean {
    return this.engagedNow;
  }

  /** Both hands are fists: opening them now stops the agents (the HUD says so). */
  get stopArmed(): boolean {
    return this.stopArmedNow;
  }

  onGestures(listener: GestureListener): () => void {
    this.gestureListeners.add(listener);
    return () => this.gestureListeners.delete(listener);
  }

  onPointer(listener: PointerListener): () => void {
    this.pointerListeners.add(listener);
    return () => this.pointerListeners.delete(listener);
  }

  onEngaged(listener: FlagListener): () => void {
    this.engagedListeners.add(listener);
    return () => this.engagedListeners.delete(listener);
  }

  onStopArmed(listener: FlagListener): () => void {
    this.stopArmedListeners.add(listener);
    return () => this.stopArmedListeners.delete(listener);
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

  setStopArmed(armed: boolean): void {
    if (armed === this.stopArmedNow) return;
    this.stopArmedNow = armed;
    for (const listener of this.stopArmedListeners) listener(armed);
  }
}
