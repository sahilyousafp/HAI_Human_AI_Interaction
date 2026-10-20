import {
  DEFAULT_BINDINGS,
  type GestureAction,
  type GestureBindings,
  type GestureSlot,
  resolveBindings,
} from "@aex/protocol";

/**
 * What each gesture does, as the user set it. The bridge keeps the choice (in .aex/settings.json), so it follows the
 * workspace across browsers and restarts; the input router reads it on every gesture.
 */
export class GestureSettings {
  private bindings: GestureBindings = DEFAULT_BINDINGS;
  private readonly listeners = new Set<() => void>();

  /** `save` sends the whole set of bindings to the bridge; false if it is offline. */
  constructor(private readonly save: (bindings: GestureBindings) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GestureBindings => this.bindings;

  /** The stored choices arrived from the bridge (anything missing or no longer offered keeps its default). */
  load(stored: Partial<Record<string, string>> | null | undefined): void {
    this.update(resolveBindings(stored));
  }

  set(slot: GestureSlot, action: GestureAction): void {
    this.update({ ...this.bindings, [slot]: action });
    this.save(this.bindings);
  }

  reset(): void {
    this.update(DEFAULT_BINDINGS);
    this.save(this.bindings);
  }

  private update(bindings: GestureBindings): void {
    this.bindings = bindings;
    for (const listener of this.listeners) listener();
  }
}
