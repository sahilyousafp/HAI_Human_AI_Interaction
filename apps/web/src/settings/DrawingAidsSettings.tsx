import { DRAWING_AIDS } from "@hai/protocol";
import { ORTHO_STEPS } from "@hai/scene";
import { useSyncExternalStore } from "react";
import type { ToolController } from "../tools/controller.ts";
import { ListGroup, ListRow, Segmented, Switch } from "../ui/controls.tsx";
import type { DrawingAidsStore } from "./drawing-aids.ts";

/**
 * Settings > Drawing aids: one switch per aid, and the angles Ortho holds to. They help the sketch tools, Move and
 * Rotate put a point exactly where it belongs; a change applies to the very next point. The aids are kept for the
 * workspace, the angle step in this browser.
 */
export function DrawingAidsSettings({ store, tools }: { store: DrawingAidsStore; tools: ToolController }) {
  const aids = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { angleStepDeg } = useSyncExternalStore(tools.subscribe, tools.getSnapshot).constraints;
  return (
    <div className="settings-page-body" data-testid="drawing-aids-settings">
      <ListGroup footer="When several aids could apply, the first of Endpoint, Midpoint, Centre, Perpendicular and Project within reach wins, then Grid. Ortho holds a line to an axis first. The switches are kept for this workspace, in every browser; the angle step in this browser.">
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
        <ListRow
          label="Ortho angle step"
          detail="The angles Ortho holds a line to, and Rotate turns by."
          control={
            <Segmented
              label="Ortho angle step"
              testId="ortho-step"
              value={String(angleStepDeg)}
              options={ORTHO_STEPS.map((step) => ({
                value: String(step),
                label: `${step}°`,
                testId: `ortho-step-${step}`,
              }))}
              onChange={(step) => tools.setAngleStep(Number(step))}
            />
          }
        />
      </ListGroup>
    </div>
  );
}
