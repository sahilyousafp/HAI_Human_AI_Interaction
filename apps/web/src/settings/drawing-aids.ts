import {
  DEFAULT_DRAWING_AIDS,
  type DrawingAidChoices,
  type DrawingAidId,
  type DrawingAids,
  resolveDrawingAids,
} from "@hai/protocol";

/**
 * Which drawing aids are on (Settings > Drawing aids). The bridge keeps the choices in the workspace settings, so
 * every browser has the same aids; tools read the aids at the moment they place a point.
 */
export class DrawingAidsStore {
  private aids: DrawingAids = DEFAULT_DRAWING_AIDS;
  private readonly listeners = new Set<() => void>();

  /** `save` sends one changed aid to the bridge; false if it is offline. */
  constructor(private readonly save: (choice: DrawingAidChoices) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DrawingAids => this.aids;

  on(id: DrawingAidId): boolean {
    return this.aids[id];
  }

  /** The stored choices arrived from the bridge. */
  load(stored: DrawingAidChoices | null | undefined): void {
    this.update(resolveDrawingAids(stored));
  }

  set(id: DrawingAidId, on: boolean): void {
    this.update({ ...this.aids, [id]: on });
    this.save({ [id]: on });
  }

  private update(aids: DrawingAids): void {
    this.aids = aids;
    for (const listener of this.listeners) listener();
  }
}
