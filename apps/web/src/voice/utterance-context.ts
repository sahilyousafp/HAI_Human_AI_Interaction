import {
  type HeldTarget,
  MAX_HELD_POINTS,
  type Point3Mm,
  type RequestContext,
  type SceneDocument,
} from "@hai/protocol";
import { VOICE } from "./voice-config.ts";

/** A holding hand that stays within this of where it rests is still resting there, millimetres. */
export const REST_MM = 300;

const distance = (a: Point3Mm, b: Point3Mm) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** An element the user meant while speaking, as the agent receives it. */
export interface Reference {
  id: string;
  type: string;
  name: string;
}

/** What a spoken request refers to: what was pointed at or tapped (in order), the selection, the ground point, and a
 * held pinch's target and points. */
export type { RequestContext };

/**
 * Records what the user points at and taps while they speak, so "this" and "these" mean exactly those elements.
 * A hover counts once the pointer has rested on an element for `VOICE.dwellMs` (a brief pass-over does not);
 * elements tapped into the selection count at once. Captured elements keep their order and appear only once.
 */
export class UtteranceContext {
  private recording = false;
  private hovered: { id: string; since: number } | null = null;
  private captured: string[] = [];
  /** A held pinch's locked target ("this"), kept until cleared. */
  private locked: HeldTarget | null = null;
  /** Points a holding hand rested on while speaking, in order. */
  private rested: Point3Mm[] = [];
  /** Where a holding hand is resting now, away from any element, and since when. */
  private resting: { point: Point3Mm; since: number } | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Element ids captured so far, in order (for the numbered markers). */
  get ids(): string[] {
    return this.captured;
  }

  /** Points captured so far while holding and speaking, in order (P1, P2, ...). */
  get points(): Point3Mm[] {
    return this.rested;
  }

  get target(): HeldTarget | null {
    return this.locked;
  }

  /** A held pinch locked what it means by "this". */
  lock(target: HeldTarget | null): void {
    this.locked = target;
    this.changed();
  }

  /**
   * Where a holding hand is while the user speaks: a point it rests on for `VOICE.dwellMs` away from any element is
   * captured (once; a point within `REST_MM` of one already captured is the same point). Moving more than `REST_MM`
   * starts the wait again. Elements it rests on are captured through `hover`.
   */
  rest(point: Point3Mm | null, now: number): void {
    if (!this.recording || !point) {
      this.resting = null;
      return;
    }
    if (!this.resting || distance(this.resting.point, point) > REST_MM) {
      this.resting = { point, since: now };
      return;
    }
    this.settleRest(now);
  }

  get active(): boolean {
    return this.recording;
  }

  /** Speech started: start capturing. The element already under the pointer counts from now. */
  begin(now: number, hoveredId: string | null): void {
    this.recording = true;
    this.captured = [];
    this.hovered = hoveredId ? { id: hoveredId, since: now } : null;
    this.changed();
  }

  /** The element under the hand pointer changed (null over empty space). */
  hover(id: string | null, now: number): void {
    if (!this.recording) {
      this.hovered = id ? { id, since: now } : null;
      return;
    }
    this.settleHover(now);
    this.hovered = id ? { id, since: now } : null;
  }

  /** Called regularly while speaking, so an element the pointer keeps resting on is captured (and marked) on time. */
  tick(now: number): void {
    if (!this.recording) return;
    this.settleHover(now);
    this.settleRest(now);
  }

  /** The selection changed while speaking: newly selected elements (taps) count at once. */
  selected(ids: string[], previous: string[]): void {
    if (!this.recording) return;
    for (const id of ids) if (!previous.includes(id)) this.capture(id);
  }

  /** Speech ended: the element still under the pointer counts if it rested there long enough. */
  end(now: number): void {
    if (!this.recording) return;
    this.settleHover(now);
    this.settleRest(now);
    this.recording = false;
    this.changed();
  }

  /** Forgets everything captured and the locked target (sent or discarded). */
  clear(): void {
    this.recording = false;
    this.captured = [];
    this.locked = null;
    this.rested = [];
    this.resting = null;
    this.changed();
  }

  /**
   * The context to send: the captured elements, or the selection when nothing was captured, resolved against the
   * scene (ids no longer in the scene are dropped).
   */
  resolve(doc: SceneDocument | null, selection: string[], groundPoint: Point3Mm | null): RequestContext {
    const ids = this.captured.length > 0 ? this.captured : selection;
    const references = ids.flatMap((id) => {
      const element = doc?.elements[id];
      return element ? [{ id, type: element.type, name: element.name }] : [];
    });
    return {
      references,
      selection,
      groundPoint,
      ...(this.locked ? { target: this.locked } : {}),
      ...(this.rested.length > 0 ? { points: this.rested } : {}),
    };
  }

  private settleRest(now: number): void {
    const resting = this.resting;
    if (!resting || now - resting.since < VOICE.dwellMs) return;
    const { point } = resting;
    if (this.rested.length >= MAX_HELD_POINTS || this.rested.some((p) => distance(p, point) <= REST_MM))
      return;
    this.rested = [...this.rested, point];
    this.changed();
  }

  private settleHover(now: number): void {
    if (this.hovered && now - this.hovered.since >= VOICE.dwellMs) this.capture(this.hovered.id);
  }

  private capture(id: string): void {
    if (this.captured.includes(id)) return;
    this.captured = [...this.captured, id];
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
