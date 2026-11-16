import { HOST_IDS, HOST_INFO } from "@hai/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HostMirror, HostMirrors } from "./host-mirror.ts";
import { hostChip } from "./host-view.ts";

/** A chip reuses the connection pill's look: green when connected, pulsing while syncing, amber when it cannot run. */
const CHIP_STATE = { on: "connected", busy: "connecting", off: "offline" } as const;

/** One host's chip in the top bar, and how long a change there takes to be drawn here. */
function HostChip({ mirror }: { mirror: HostMirror }) {
  const state = useSyncExternalStore(mirror.subscribe, mirror.getStatus);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setMs(mirror.latencyP90()), 500);
    return () => clearInterval(id);
  }, [mirror]);
  const chip = hostChip(mirror.host, state);
  if (!chip) return null;
  // One pill per host, its latency beside its name as the bridge pill carries its version, so a second host does not
  // crowd the top bar onto two rows.
  return (
    <output
      className="status"
      data-testid="host-status"
      data-host={mirror.host}
      data-state={CHIP_STATE[chip.tone]}
      data-tone={chip.tone}
      aria-live="polite"
    >
      <span className="dot" aria-hidden="true" />
      <span data-testid="host-status-text">{chip.text}</span>
      {ms !== null && chip.tone === "on" && (
        <span
          className="meta"
          data-testid="host-latency"
          data-host={mirror.host}
          title={`How long a change in ${HOST_INFO[mirror.host].label} takes to show here (90th percentile)`}
        >
          {Math.round(ms)} ms
        </span>
      )}
    </output>
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
