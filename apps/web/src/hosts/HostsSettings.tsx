import { HOST_IDS, HOST_INFO, type HostId } from "@hai/protocol";
import { useSyncExternalStore } from "react";
import { ListGroup, ListRow, Segmented, Switch } from "../ui/controls.tsx";
import type { HostMirror, HostMirrors } from "./host-mirror.ts";
import { connectionText, notDrawnText, runText, syncText } from "./host-view.ts";

const SESSION_OPTIONS = ["2", "3", "4", "6", "8", "12"].map((n) => ({
  value: n,
  label: n,
  testId: `max-sessions-${n}`,
}));

const HOSTS_FOOTER =
  "Each application models with its own tools. While one is connected and on, its model is drawn here, and the agent runs code in it only after you have seen the script.";

/** One host: its switch, and while it is connected, what the agent can do in it and what is not drawn. */
function HostGroup({
  mirror,
  onSwitch,
  footer,
}: {
  mirror: HostMirror;
  onSwitch: (host: HostId, on: boolean) => void;
  footer?: string;
}) {
  const state = useSyncExternalStore(mirror.subscribe, mirror.getStatus);
  const { host } = mirror;
  const { label } = HOST_INFO[host];
  const sync = syncText(state.sync);
  const left = notDrawnText(state.notDrawn);
  const run = runText(host, state.run);
  const shown = state.connected && state.switchedOn;
  return (
    <ListGroup title={label} {...(footer ? { footer } : {})}>
      <ListRow
        label={`Use ${label}`}
        detail={
          state.switchedOn
            ? connectionText(host, state)
            : `Off: the agent does not use ${label}, and its model is not drawn.`
        }
        testId={`host-${host}-connection`}
        control={
          <Switch
            label={`Use ${label}`}
            testId={`host-${host}-switch`}
            checked={state.switchedOn}
            onChange={(on) => onSwitch(host, on)}
          />
        }
      />
      {shown && run && <ListRow label="Running code" detail={run} testId={`host-${host}-run`} />}
      {shown && sync && <ListRow label="First sync" detail={sync} testId={`host-${host}-sync`} />}
      {shown && left && <ListRow label="Not drawn" detail={left} testId={`host-${host}-not-drawn`} />}
    </ListGroup>
  );
}

/**
 * Settings > Hosts: the design applications the agent may use. Each host models with its own tools; while it is
 * connected and switched on, its model is drawn here and the agent can run code in it. The choice follows the
 * workspace between a machine with an application and one without.
 */
export function HostsSettings({
  mirrors,
  onSwitch,
  showOwners,
  onShowOwners,
  showCameras,
  onShowCameras,
  maxSessions,
  onMaxSessions,
}: {
  mirrors: HostMirrors;
  onSwitch: (host: HostId, on: boolean) => void;
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
  return (
    <div className="settings-page-body" data-testid="hosts-settings">
      {HOST_IDS.map((host, i) => (
        <HostGroup
          key={host}
          mirror={mirrors.byHost[host]}
          onSwitch={onSwitch}
          {...(i === HOST_IDS.length - 1 ? { footer: HOSTS_FOOTER } : {})}
        />
      ))}
      <ListGroup
        title="Agents working together"
        footer="When agents work on separate parts at the same time (Features > Parallel modelling), each object an agent owns is outlined and tinted in its colour, and region claims are drawn as boxes. The panel lists who holds what either way."
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
    </div>
  );
}
