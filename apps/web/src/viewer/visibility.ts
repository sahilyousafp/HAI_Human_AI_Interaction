const NONE: ReadonlySet<string> = new Set();

/**
 * Which elements the user has hidden from the view ("hide", "isolate"). It is what is drawn, picked and snapped to
 * here, not a change to the model: nothing is saved, undone or sent to the bridge.
 */
export class Visibility {
  private hidden: ReadonlySet<string> = NONE;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReadonlySet<string> => this.hidden;

  hide(ids: string[]): void {
    this.set(new Set([...this.hidden, ...ids]));
  }

  /** Hides everything in `all` that is not in `ids`; the ones in `ids` show even if they were hidden. */
  isolate(ids: string[], all: string[]): void {
    const keep = new Set(ids);
    this.set(new Set(all.filter((id) => !keep.has(id))));
  }

  showAll(): void {
    this.set(NONE);
  }

  private set(next: ReadonlySet<string>): void {
    if (
      next === this.hidden ||
      (next.size === this.hidden.size && [...next].every((id) => this.hidden.has(id)))
    ) {
      return;
    }
    this.hidden = next;
    for (const listener of this.listeners) listener();
  }
}
