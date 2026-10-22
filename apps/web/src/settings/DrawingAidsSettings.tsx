import { DRAWING_AIDS } from "@aex/protocol";
import { useSyncExternalStore } from "react";
import { ListGroup, ListRow, Switch } from "../ui/controls.tsx";
import type { DrawingAidsStore } from "./drawing-aids.ts";

/**
 * Settings > Drawing aids: one switch per aid. They help the create tools and Move put a point exactly where it
 * belongs; a change applies to the very next point. The choice is kept for the workspace.
 */
export function DrawingAidsSettings({ store }: { store: DrawingAidsStore }) {
  const aids = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className="settings-page-body" data-testid="drawing-aids-settings">
      <ListGroup footer="When several aids could apply, the first of Endpoint, Midpoint, Centre, Perpendicular and Project within reach wins, then Grid. Ortho holds a line to an axis first. The choice is kept for this workspace, in every browser.">
        {DRAWING_AIDS.map((aid) => (
          <ListRow
            key={aid.id}
            label={aid.label}
            detail={aid.description}
            control={
              <Switch
                label={aid.label}
                testId={`aid-${aid.id}`}
                checked={aids[aid.id]}
                onChange={(on) => store.set(aid.id, on)}
              />
            }
          />
        ))}
      </ListGroup>
    </div>
  );
}
