import {
  type BindingKey,
  changedBindings,
  DEFAULT_BINDINGS,
  defaultBindings,
  type GestureAction,
  type GestureBindings,
  type Hand,
  resolveBindings,
} from "@hai/protocol";

/**
 * What each gesture does, as the user set it (one-hand gestures for each hand on its own). The bridge keeps the choice (in .hai/settings.json), so it follows the
 * workspace across browsers and restarts; the input router reads it on every gesture. Only the choices that differ
 * from the defaults are kept, so a gesture the user never set follows its role when the dominant hand changes.
 */
export class GestureSettings {
  private stored: Partial<Record<string, string>> = {};
  private dominant: Hand = "Right";
  private bindings: GestureBindings = DEFAULT_BINDINGS;
  private readonly listeners = new Set<() => void>();

  /** `save` sends the user's choices to the bridge; false if it is offline. */
  constructor(private readonly save: (bindings: Partial<GestureBindings>) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GestureBindings => this.bindings;

  /** What each gesture does out of the box for the current dominant hand. */
  defaults(): GestureBindings {
    return defaultBindings(this.dominant);
  }

  /** The stored choices arrived from the bridge (anything missing or no longer offered keeps its default). */
  load(stored: Partial<Record<string, string>> | null | undefined): void {
    this.stored = { ...stored };
    this.update();
  }

  /** The dominant hand changed: gestures the user never set take the defaults of their new role. */
  setDominant(hand: Hand): void {
    if (hand === this.dominant) return;
    this.dominant = hand;
    this.update();
  }

  set(key: BindingKey, action: GestureAction): void {
    this.stored = changedBindings({ ...this.bindings, [key]: action }, this.dominant);
    this.update();
    this.save(this.stored as Partial<GestureBindings>);
  }

  reset(): void {
    this.stored = {};
    this.update();
    this.save({});
  }

  private update(): void {
    this.bindings = resolveBindings(this.stored, this.dominant);
    for (const listener of this.listeners) listener();
  }
}
