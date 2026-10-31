import type { Point2 } from "@hai/protocol";
import { type PaletteSpace, slotAt } from "./palette.ts";

/** Silence after the hold fired before the ring is shown, ms. */
export const RING_AFTER_MS = 600;

/**
 * One hand's long pinch bound to hold to talk:
 * - `held`: the hold fired; the target is locked and the microphone is listening;
 * - `flicking`: the hand moved past the ring's centre before any speech, toward `slot`;
 * - `speaking`: speech is going on; the hand points, and no slot is chosen. When it stops (a pause, or a sound that was
 *   not speech) the hold is `held` again: the ring comes back after the silence, and a release still sends what was
 *   said, unless the hand flicked to a slot.
 */
export type HoldPhase = "held" | "flicking" | "speaking";

/** What releasing the pinch does. */
export type HoldOutcome =
  | { kind: "send" }
  | { kind: "choose"; slot: number }
  /** Released in the ring's centre (or over an empty slot) without speaking: nothing happens. */
  | { kind: "cancel" };

export interface HoldState {
  phase: HoldPhase;
  /** The slot the hand points toward, while flicking. */
  slot: number | null;
  /** Whether the ring is shown: while flicking, or once the hold has been silent for `RING_AFTER_MS`. */
  ringShown: boolean;
}

/**
 * Decides what one held pinch does, from its moves, the speech it heard and the clock. Speech wins any race: once it
 * starts, no slot is chosen however the hand moves, and a release sends what was said.
 */
export class HoldMachine {
  private phase: HoldPhase = "held";
  private slot: number | null = null;
  private started: number;
  /** Whether any speech was heard during the hold, even if it has stopped. */
  private spoke = false;

  constructor(
    private readonly space: PaletteSpace,
    now: number,
  ) {
    this.started = now;
  }

  state(now: number): HoldState {
    const silentLongEnough = this.phase === "held" && now - this.started >= RING_AFTER_MS;
    return { phase: this.phase, slot: this.slot, ringShown: this.phase === "flicking" || silentLongEnough };
  }

  /** The hand moved (in the space the hold began in). */
  move(at: Point2): void {
    if (this.phase === "speaking") return;
    this.slot = slotAt(this.space, at);
    this.phase = this.slot === null ? "held" : "flicking";
  }

  /** Whether speech was heard at any time in the hold, even if it has stopped. */
  get heardSpeech(): boolean {
    return this.spoke;
  }

  /** Speech started: the ring is dropped and the hand points while it goes on. */
  speech(): void {
    this.phase = "speaking";
    this.slot = null;
    this.spoke = true;
  }

  /** The speech stopped: the hold is silent again, and the ring comes back after `RING_AFTER_MS` of it. */
  quiet(now: number): void {
    if (this.phase !== "speaking") return;
    this.phase = "held";
    this.started = now;
  }

  release(): HoldOutcome {
    if (this.phase === "speaking") return { kind: "send" };
    if (this.phase === "flicking" && this.slot !== null) return { kind: "choose", slot: this.slot };
    return this.spoke ? { kind: "send" } : { kind: "cancel" };
  }
}
