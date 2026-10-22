import type { Point3Mm, SceneDocument } from "@hai/protocol";
import { VOICE } from "./voice-config.ts";

/** An element the user meant while speaking, as the agent receives it. */
export interface Reference {
  id: string;
  type: string;
  name: string;
}

/** What a spoken request refers to: what was pointed at or tapped (in order), the selection, and the ground point. */
export interface RequestContext {
  references: Reference[];
  selection: string[];
  /** Where the hand pointer met the ground when the utterance ended, millimetres. */
  groundPoint: Point3Mm | null;
}

/**
 * Records what the user points at and taps while they speak, so "this" and "these" mean exactly those elements.
 * A hover counts once the pointer has rested on an element for `VOICE.dwellMs` (a brief pass-over does not);
 * elements tapped into the selection count at once. Captured elements keep their order and appear only once.
 */
export class UtteranceContext {
  private recording = false;
  private hovered: { id: string; since: number } | null = null;
  private captured: string[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Element ids captured so far, in order (for the numbered markers). */
  get ids(): string[] {
    return this.captured;
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
    if (this.recording) this.settleHover(now);
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
    this.recording = false;
    this.changed();
  }

  /** Forgets everything captured (sent or discarded). */
  clear(): void {
    this.recording = false;
    this.captured = [];
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
    return { references, selection, groundPoint };
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
