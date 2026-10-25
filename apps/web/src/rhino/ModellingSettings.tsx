import type { ModellingMode } from "@hai/protocol";
import { useSyncExternalStore } from "react";
import { ListGroup, ListRow, Segmented, Switch } from "../ui/controls.tsx";
import type { RhinoMirror } from "./rhino-mirror.ts";
import { connectionText, notDrawnText, pythonText, syncText } from "./rhino-view.ts";

const SESSION_OPTIONS = ["2", "3", "4", "6", "8", "12"].map((n) => ({
  value: n,
  label: n,
  testId: `max-sessions-${n}`,
}));

const OPTIONS = [
  { value: "auto", label: "Automatic", testId: "modelling-auto" },
  { value: "rhino", label: "Rhino", testId: "modelling-rhino" },
  { value: "python", label: "Python only", testId: "modelling-python" },
] as const satisfies ReadonlyArray<{ value: ModellingMode; label: string; testId: string }>;

/**
 * Settings > Modelling: how the agent models. With Rhino it works in the open document and the model is drawn here;
 * without it, it writes .3dm files with Python. The choice follows the workspace between a machine with Rhino and
 * one without.
 */
export function ModellingSettings({
  mirror,
  onChange,
  showOwners,
  onShowOwners,
  showCameras,
  onShowCameras,
  maxSessions,
  onMaxSessions,
}: {
  mirror: RhinoMirror;
  onChange: (mode: ModellingMode) => void;
  /** Tint what agents own in their colour and draw their region claims. */
  showOwners: boolean;
  onShowOwners: (on: boolean) => void;
  /** Mark each camera an agent placed with a small marker in the model. */
  showCameras: boolean;
  onShowCameras: (on: boolean) => void;
  /** How many agent sessions (Mochi, specialists, workers) may run at once. */
  maxSessions: number;
  onMaxSessions: (limit: number) => void;
}) {
  const state = useSyncExternalStore(mirror.subscribe, mirror.getStatus);
  const sync = syncText(state.sync);
  const left = notDrawnText(state.notDrawn);
  return (
    <div className="settings-page-body" data-testid="modelling-settings">
      <ListGroup
        title="How the agent models"
        footer="Automatic uses Rhino while it is connected and Python otherwise. Rhino always expects it, and says so when it is not there. Python only writes .3dm files with the managed Python, never touches Rhino and does not draw its model here. While Rhino is used, its model is drawn in this window."
      >
        <div className="list-row">
          <Segmented
            value={state.mode}
            options={OPTIONS}
            onChange={onChange}
            label="How the agent models"
            testId="modelling-mode"
            wide
          />
        </div>
      </ListGroup>
      <ListGroup
        title="Agents working together"
        footer="When agents work on separate parts at the same time (Features > Parallel modelling), each element an agent owns is outlined and tinted in its colour, and region claims are drawn as boxes. The panel lists who holds what either way."
      >
        <ListRow
          label="Sessions at once"
          detail="Mochi, each specialist working and each worker. Every one is a model session with its own cost: a run with workers uses several times the tokens of a single agent. A worker over the limit waits for a free session."
          control={
            <Segmented
              value={String(maxSessions)}
              options={SESSION_OPTIONS}
              onChange={(value) => onMaxSessions(Number(value))}
              label="Sessions at once"
              testId="max-sessions"
            />
          }
        />
        <ListRow
          label="Show cameras"
          detail="A small marker where an agent has placed a camera to check its work. The pictures in the panel stay either way."
          control={
            <Switch
              label="Show cameras"
              testId="show-cameras"
              checked={showCameras}
              onChange={onShowCameras}
            />
          }
        />
        <ListRow
          label="Show owners"
          control={
            <Switch label="Show owners" testId="show-owners" checked={showOwners} onChange={onShowOwners} />
          }
        />
      </ListGroup>
      <ListGroup title="Now">
        <ListRow
          label="In use"
          testId="modelling-in-use"
          control={
            <span data-testid="modelling-in-use-value">
              {state.inUse === "rhino" ? "Rhino" : "Python only"}
            </span>
          }
        />
        <ListRow label="Rhino" detail={connectionText(state)} testId="modelling-connection" />
        {state.connected && pythonText(state.python) && (
          <ListRow
            label="Python in Rhino"
            detail={pythonText(state.python)}
            testId="modelling-python-status"
          />
        )}
        {state.connected && sync && <ListRow label="First sync" detail={sync} testId="modelling-sync" />}
        {state.connected && left && <ListRow label="Not drawn" detail={left} testId="modelling-not-drawn" />}
      </ListGroup>
    </div>
  );
}
