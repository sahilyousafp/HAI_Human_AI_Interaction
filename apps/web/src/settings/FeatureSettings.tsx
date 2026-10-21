import { FEATURES } from "@aex/protocol";
import { useSyncExternalStore } from "react";
import { ListGroup, ListRow, Switch } from "../ui/controls.tsx";
import type { FeatureFlags } from "./feature-flags.ts";

/**
 * Settings > Features: one switch per feature. A switched-off feature leaves the interface and ignores its
 * gestures, so a demo or a release shows exactly what is turned on. The choice is kept for the workspace.
 */
export function FeatureSettings({ flags }: { flags: FeatureFlags }) {
  const features = useSyncExternalStore(flags.subscribe, flags.getSnapshot);
  return (
    <div className="settings-page-body" data-testid="feature-settings">
      <ListGroup footer="Switched-off features leave the interface and ignore their gestures. The choice is kept for this workspace, in every browser.">
        {FEATURES.map((feature) => (
          <ListRow
            key={feature.id}
            label={feature.label}
            detail={feature.description}
            control={
              <Switch
                label={feature.label}
                testId={`feature-${feature.id}`}
                checked={features[feature.id]}
                onChange={(on) => flags.set(feature.id, on)}
              />
            }
          />
        ))}
      </ListGroup>
    </div>
  );
}
