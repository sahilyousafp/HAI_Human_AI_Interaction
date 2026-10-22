import {
  DEFAULT_FEATURES,
  type FeatureChoices,
  type FeatureId,
  type Features,
  resolveFeatures,
} from "@hai/protocol";

/**
 * Which features are on (Settings > Features). The bridge keeps the choices in the workspace settings, so every
 * browser shows the same features; everything that a switch gates reads `on(id)` at the moment it acts.
 */
export class FeatureFlags {
  private features: Features = DEFAULT_FEATURES;
  private readonly listeners = new Set<() => void>();

  /** `save` sends one changed feature to the bridge; false if it is offline. */
  constructor(private readonly save: (choice: FeatureChoices) => boolean) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Features => this.features;

  on(id: FeatureId): boolean {
    return this.features[id];
  }

  /** The stored choices arrived from the bridge. */
  load(stored: FeatureChoices | null | undefined): void {
    this.update(resolveFeatures(stored));
  }

  set(id: FeatureId, on: boolean): void {
    this.update({ ...this.features, [id]: on });
    this.save({ [id]: on });
  }

  private update(features: Features): void {
    this.features = features;
    for (const listener of this.listeners) listener();
  }
}
