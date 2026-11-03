import {
  type Hand,
  type LetterMarker,
  MAX_SKETCHES,
  type Point3Mm,
  type Sketch as SketchData,
} from "@hai/protocol";

/** A sketch as the viewer keeps it: what the agent receives, and the hand that drew it (for its colour). */
export interface Sketch extends SketchData {
  hand: Hand | null;
}

/** A sketch being drawn, shown before it is kept. */
export interface SketchDraft {
  kind: SketchData["kind"];
  points: Point3Mm[];
  hand: Hand | null;
}

export interface ReferenceSnapshot {
  sketches: Sketch[];
  draft: SketchDraft | null;
  /** The open project's lettered markers, as the bridge keeps them. */
  markers: LetterMarker[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * What the user pointed out for the agent and that is not part of the model: sketches (paths and outlines, kept in
 * this browser until a request carries them) and lettered markers (kept with the project by the bridge). Neither is
 * ever a scene transaction. A sketch tool's Undo and Redo step through the sketches here, and the model's undo never
 * touches them.
 */
export class ReferenceLayer {
  private snapshot: ReferenceSnapshot = { sketches: [], draft: null, markers: [] };
  private readonly listeners = new Set<() => void>();
  /** The number the next sketch's label takes; back to 1 once no sketch is left. */
  private nextNumber = 1;
  /** Called with the whole list when the user places or removes a marker (to save it with the project). */
  onMarkersChange: (markers: LetterMarker[]) => void = () => {};

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReferenceSnapshot => this.snapshot;

  get sketches(): Sketch[] {
    return this.snapshot.sketches;
  }

  get markers(): LetterMarker[] {
    return this.snapshot.markers;
  }

  setDraft(draft: SketchDraft | null): void {
    this.update({ draft });
  }

  /** Sketches undone since the last one was kept, for Redo; the next to come back is last. */
  private undoneSketches: Sketch[] = [];

  get canUndoSketch(): boolean {
    return this.snapshot.sketches.length > 0;
  }

  get canRedoSketch(): boolean {
    return this.undoneSketches.length > 0;
  }

  /** Takes back the newest sketch, keeping it for Redo; false when there is none. */
  undoSketch(): boolean {
    const newest = this.snapshot.sketches.at(-1);
    if (!newest) return false;
    const kept = [...this.undoneSketches, newest];
    this.setSketches(this.snapshot.sketches.slice(0, -1));
    this.undoneSketches = kept;
    return true;
  }

  /** Brings back the sketch undone last, under its own label; false when there is none. */
  redoSketch(): boolean {
    const next = this.undoneSketches.at(-1);
    if (!next) return false;
    this.undoneSketches = this.undoneSketches.slice(0, -1);
    this.nextNumber = Math.max(this.nextNumber, Number(next.label.slice(1)) + 1);
    this.update({ sketches: [...this.snapshot.sketches, next] });
    return true;
  }

  /** Keeps a finished sketch, labelled S1, S2 and so on; a ninth replaces the oldest. */
  addSketch(kind: SketchData["kind"], points: Point3Mm[], hand: Hand | null): Sketch {
    const sketch: Sketch = { label: `S${this.nextNumber++}`, kind, points, hand };
    this.undoneSketches = [];
    this.update({ sketches: [...this.snapshot.sketches, sketch].slice(-MAX_SKETCHES), draft: null });
    return sketch;
  }

  removeSketch(label: string): void {
    this.setSketches(this.snapshot.sketches.filter((s) => s.label !== label));
  }

  /** Clears every sketch (a request carried them, or the user pressed Escape). */
  clearSketches(): void {
    this.setSketches([]);
  }

  /** Places a marker with the first free letter; null when all 26 are used. */
  placeMarker(point: Point3Mm): LetterMarker | null {
    const used = new Set(this.snapshot.markers.map((m) => m.letter));
    const letter = [...LETTERS].find((l) => !used.has(l));
    if (!letter) return null;
    const marker = { letter, point };
    this.changeMarkers([...this.snapshot.markers, marker]);
    return marker;
  }

  removeMarker(letter: string): void {
    this.changeMarkers(this.snapshot.markers.filter((m) => m.letter !== letter));
  }

  /** Markers from the bridge (on connect, a project switch or another viewer's change), without echoing them back. */
  loadMarkers(markers: LetterMarker[]): void {
    this.update({ markers });
  }

  private changeMarkers(markers: LetterMarker[]): void {
    const sorted = [...markers].sort((a, b) => a.letter.localeCompare(b.letter));
    this.update({ markers: sorted });
    this.onMarkersChange(sorted);
  }

  private setSketches(sketches: Sketch[]): void {
    this.undoneSketches = [];
    if (sketches.length === 0) this.nextNumber = 1;
    this.update({ sketches });
  }

  private update(partial: Partial<ReferenceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}
