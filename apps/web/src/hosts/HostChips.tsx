import { HOST_IDS, HOST_INFO } from "@hai/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { IconPill } from "../ui/IconPill.tsx";
import { HostGlyph } from "./HostGlyph.tsx";
import type { HostMirror, HostMirrors } from "./host-mirror.ts";
import { hostChip } from "./host-view.ts";

/** A chip reuses the connection pill's states: green when connected, pulsing while syncing, amber when it cannot run. */
const CHIP_STATE = { on: "connected", busy: "connecting", off: "offline" } as const;

/**
 * One host's chip in the top bar, compact: the host's icon with its status as a dot in the corner, and beside it how
 * long a change there takes to be drawn here (or how far a sync has got). The words ("Rhino connected") are the
 * chip's tooltip and what a screen reader says, so several hosts fit one row of the top bar.
 */
function HostChip({ mirror }: { mirror: HostMirror }) {
  const state = useSyncExternalStore(mirror.subscribe, mirror.getStatus);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setMs(mirror.latencyP90()), 500);
    return () => clearInterval(id);
  }, [mirror]);
  const chip = hostChip(mirror.host, state);
  if (!chip) return null;
  const { label } = HOST_INFO[mirror.host];
  const latency = ms !== null && chip.tone === "on" ? `${Math.round(ms)} ms` : null;
  const progress = chip.tone === "busy" && state.sync ? `${state.sync.done}/${state.sync.total}` : null;
  const title = latency
    ? `${chip.text}: a change there shows here in ${latency} (90th percentile)`
    : chip.tone === "off" && state.run?.state === "unavailable"
      ? `${chip.text}: ${state.run.reason}`
      : chip.text;
  return (
    <IconPill
      testId="host-status"
      state={CHIP_STATE[chip.tone]}
      glyph={<HostGlyph host={mirror.host} />}
      text={chip.text}
      title={title}
      extra={{ "data-host": mirror.host, "data-tone": chip.tone }}
      meta={
        <>
          {latency && (
            <span className="meta">
              <span data-testid="host-latency" data-host={mirror.host} aria-hidden="true">
                {latency}
              </span>
              <span className="visually-hidden">{`${label} to HAI ${latency}`}</span>
            </span>
          )}
          {progress && (
            <span className="meta" data-testid="host-progress" aria-hidden="true">
              {progress}
            </span>
          )}
        </>
      }
    />
  );
}

/** The chips of every connected, switched-on host, in a fixed order. */
export function HostChips({ mirrors }: { mirrors: HostMirrors }) {
  return (
    <>
      {HOST_IDS.map((host) => (
        <HostChip key={host} mirror={mirrors.byHost[host]} />
      ))}
    </>
  );
}
