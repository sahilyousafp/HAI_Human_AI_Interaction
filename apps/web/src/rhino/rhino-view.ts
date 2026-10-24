import type { RhinoNotDrawn } from "@hai/protocol";
import type { MirrorStatus } from "./rhino-mirror.ts";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the viewer leaves out of Rhino's document, in words ("12 curves and 1 annotation are not drawn"), or null. */
export function notDrawnText(counts: RhinoNotDrawn): string | null {
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
  return [missing, heavy].filter(Boolean).join("; ") || null;
}

/** How far the first sync of a document has got ("Syncing 120 of 4000"), or null once it is in. */
export function syncText(sync: MirrorStatus["sync"]): string | null {
  return sync ? `Syncing ${sync.done} of ${sync.total}` : null;
}

/** The sentence for the Rhino connection. */
export function connectionText(state: Pick<MirrorStatus, "connected" | "document">): string {
  if (!state.connected) return "Not connected. Run HaiConnect in Rhino.";
  return state.document ? `Connected to ${state.document}` : "Connected (an unsaved document)";
}

/** The sentence for Python in Rhino: ready, or why not and what to do. */
export function pythonText(python: MirrorStatus["python"]): string | null {
  if (!python) return null;
  return python.state === "ready"
    ? "Python ready"
    : `Python not available in Rhino: ${python.reason}. Open Rhino's Script editor once, or install its Python 3 runtime, then run HaiConnect again.`;
}

/** The label of the top bar's Rhino pill, or null when there is nothing to say (no Rhino, and the mode is Automatic). */
export function rhinoPill(state: MirrorStatus): { text: string; tone: "on" | "off" | "busy" } | null {
  if (state.mode === "python") return { text: "Python only", tone: "off" };
  const sync = syncText(state.sync);
  if (state.connected) return sync ? { text: sync, tone: "busy" } : { text: "Rhino connected", tone: "on" };
  return state.mode === "rhino" ? { text: "Rhino not connected", tone: "off" } : null;
}
