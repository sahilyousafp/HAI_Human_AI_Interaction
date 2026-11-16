import { HOST_INFO, type HostId, type HostNotDrawn } from "@hai/protocol";
import type { MirrorStatus } from "./host-mirror.ts";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the viewer leaves out of a host's document, in words ("12 curves and 1 annotation are not drawn"), or null. */
export function notDrawnText(counts: HostNotDrawn): string | null {
  const parts = [
    counts.curves ? plural(counts.curves, "curve") : "",
    counts.points ? plural(counts.points, "point") : "",
    counts.annotations ? plural(counts.annotations, "annotation") : "",
    counts.other ? plural(counts.other, "other object") : "",
  ].filter(Boolean);
  const heavy = counts.heavy
    ? `${plural(counts.heavy, "object")} too heavy to draw in full (drawn as ${counts.heavy === 1 ? "a box" : "boxes"})`
    : "";
  const missing = parts.length > 0 ? `${parts.join(", ").replace(/, ([^,]*)$/, " and $1")} not drawn` : "";
  const simplified = counts.simplified
    ? `${plural(counts.simplified, "placed block")} drawn with less detail, as the model is too heavy to draw in full`
    : "";
  return [missing, heavy, simplified].filter(Boolean).join("; ") || null;
}

/** How far the first sync of a document has got ("Syncing 120 of 4000"), or null once it is in. */
export function syncText(sync: MirrorStatus["sync"]): string | null {
  return sync ? `Syncing ${sync.done} of ${sync.total}` : null;
}

/** The sentence for a host's connection, with how to connect it when it is not. */
export function connectionText(
  host: HostId,
  state: Pick<MirrorStatus, "connected" | "document" | "app">,
): string {
  if (!state.connected) return `Not connected. ${HOST_INFO[host].connectHint}`;
  const app = state.app ? `${HOST_INFO[host].label} ${state.app.version}` : HOST_INFO[host].label;
  return state.document ? `${app}, ${state.document}` : `${app}, an unsaved document`;
}

/** What fixes a host that cannot run code, by host. */
const RUN_FIX: Record<HostId, string> = {
  rhino: "Open Rhino's Script editor once, or install its Python 3 runtime, then run HaiConnect again.",
  blender: "Check that the HAI add-on is enabled, then press Connect again.",
  revit: "Close any open dialog in Revit, then press Connect again.",
};

/** The sentence for whether the agent can run code in a host: ready, or why not and what to do. */
export function runText(host: HostId, run: MirrorStatus["run"]): string | null {
  if (!run) return null;
  const { label } = HOST_INFO[host];
  return run.state === "ready"
    ? `The agent can run code in ${label}`
    : `The agent cannot run code in ${label}: ${run.reason}. ${RUN_FIX[host]}`;
}

/**
 * A host's chip in the top bar, or null when there is nothing to say: a host the user switched off, or one that is not
 * connected, shows none. While it syncs, it says how far it has got.
 */
export function hostChip(
  host: HostId,
  state: MirrorStatus,
): { text: string; tone: "on" | "off" | "busy" } | null {
  if (!state.switchedOn || !state.connected) return null;
  const sync = syncText(state.sync);
  if (sync) return { text: sync, tone: "busy" };
  if (state.run?.state === "unavailable")
    return { text: `${HOST_INFO[host].label}: cannot run code`, tone: "off" };
  return { text: `${HOST_INFO[host].label} connected`, tone: "on" };
}
