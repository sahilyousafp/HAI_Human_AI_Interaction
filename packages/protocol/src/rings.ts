import { Hand } from "./gestures.ts";

/**
 * The two tool rings. The action ring (the dominant hand's) holds the tools that act on the model; the reference
 * ring (the other hand's) holds the tools that point things out for the agent. They are stored as `palette` and
 * `createPalette`, the names they had as the tools ring and the create ring.
 */
export type Ring = "action" | "reference";

/** The hand the user draws with; its silent long pinch shows the action ring. */
export const DominantHand = Hand;
export type DominantHand = Hand;

/** Tool ids clockwise from the top; null is an empty slot. */
export const DEFAULT_ACTION_LAYOUT: Array<string | null> = [
  "select",
  "move",
  "copy",
  "delete",
  "undo",
  "column",
  "wall",
  "slab",
];
export const DEFAULT_REFERENCE_LAYOUT: Array<string | null> = [
  "sketch-line",
  "sketch-area",
  "place-marker",
  "measure",
  "massing",
  "section",
  null,
  null,
];

/** The ring a silent long pinch of `hand` shows. */
export function ringFor(hand: Hand, dominant: DominantHand): Ring {
  return hand === dominant ? "action" : "reference";
}

/** The defaults before hold to talk: replaced when a stored layout still equals them. */
const OLD_TOOLS_LAYOUT = ["select", "ask-agent", "measure", "section", "move", "massing", "delete", "undo"];
const OLD_CREATE_LAYOUT = ["wall", "slab", "column", "massing", "copy", "redo", "undo", "delete"];
/** Binding values from before the rings were renamed. */
const RENAMED_ACTIONS: Record<string, string> = {
  "tools-ring": "action-ring",
  "create-ring": "reference-ring",
};

const sameLayout = (stored: unknown, old: string[]): boolean =>
  Array.isArray(stored) && stored.length === old.length && stored.every((id, i) => id === old[i]);

/**
 * The long pinch each hand had before hold to talk, from per-hand keys over the old shared `hold` key, over the old
 * defaults (the tools ring for the right hand, the create ring for the left; the old single "palette" meant the same).
 */
function oldHold(gestures: Record<string, unknown>, hand: "left" | "right"): unknown {
  const shared = gestures.hold === "palette" ? undefined : gestures.hold;
  return gestures[`hold.${hand}`] ?? shared ?? (hand === "left" ? "create-ring" : "tools-ring");
}

function migrateGestures(gestures: Record<string, unknown>): Record<string, unknown> {
  const oldDefaults =
    oldHold(gestures, "left") === "create-ring" && oldHold(gestures, "right") === "tools-ring";
  const out: Record<string, unknown> = {};
  for (const [key, action] of Object.entries(gestures)) {
    // The old default long pinch (each hand its own ring) becomes the new default, hold to talk.
    if (oldDefaults && (key === "hold" || key === "hold.left" || key === "hold.right")) continue;
    out[key] = typeof action === "string" ? (RENAMED_ACTIONS[action] ?? action) : action;
  }
  return out;
}

/**
 * Brings settings saved before hold to talk up to date: a ring layout still equal to its old default and the old
 * default long pinch take the new defaults (null and no binding, so the app's defaults apply), and the old ring
 * binding values take the new names. Everything else is kept as it is. Running it again changes nothing.
 */
export function migrateRingSettings(stored: Record<string, unknown>): Record<string, unknown> {
  const out = { ...stored };
  if (sameLayout(out.palette, OLD_TOOLS_LAYOUT)) out.palette = null;
  if (sameLayout(out.createPalette, OLD_CREATE_LAYOUT)) out.createPalette = null;
  if (out.gestures && typeof out.gestures === "object" && !Array.isArray(out.gestures))
    out.gestures = migrateGestures(out.gestures as Record<string, unknown>);
  return out;
}
