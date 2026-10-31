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
  "line",
  "lasso",
];

/** The ring a silent long pinch of `hand` shows. */
export function ringFor(hand: Hand, dominant: DominantHand): Ring {
  return hand === dominant ? "action" : "reference";
}

/** The reference ring before Lasso select took its last free slot: a stored layout still equal to it takes the new default. */
const NO_LASSO_REFERENCE_LAYOUT = [
  "sketch-line",
  "sketch-area",
  "place-marker",
  "measure",
  "massing",
  "section",
  "line",
  null,
];

/** The defaults before hold to talk: replaced when a stored layout still equals them. */
const OLD_TOOLS_LAYOUT = ["select", "ask-agent", "measure", "section", "move", "massing", "delete", "undo"];
const OLD_CREATE_LAYOUT = ["wall", "slab", "column", "massing", "copy", "redo", "undo", "delete"];
/** Binding values from before the rings were renamed. */
const RENAMED_ACTIONS: Record<string, string> = {
  "tools-ring": "action-ring",
  "create-ring": "reference-ring",
};

const sameLayout = (stored: unknown, old: Array<string | null>): boolean =>
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
 * Hold to talk first shipped with both hands talking, and the app then stored every binding, defaults included. That
 * default (talk on both hands) gives way to the long pinch by role: the dominant hand's ring, the other hand's talk.
 */
function migrateHoldRoles(gestures: Record<string, unknown>): Record<string, unknown> {
  const hold = (hand: "left" | "right") => gestures[`hold.${hand}`] ?? gestures.hold ?? "talk";
  if (hold("left") !== "talk" || hold("right") !== "talk") return gestures;
  const { hold: _shared, "hold.left": _left, "hold.right": _right, ...rest } = gestures;
  return rest;
}

/**
 * Brings saved settings up to date. Settings from before hold to talk: a ring layout still equal to its old default
 * and the old default long pinch take the new defaults (null and no binding, so the app's defaults apply), and the
 * old ring binding values take the new names. Settings from before the long pinch went by role (`holdRoles` unset):
 * talk on both hands takes the role defaults. Everything else is kept as it is. Running it again changes nothing.
 */
export function migrateRingSettings(stored: Record<string, unknown>): Record<string, unknown> {
  const out = { ...stored };
  if (sameLayout(out.palette, OLD_TOOLS_LAYOUT)) out.palette = null;
  if (sameLayout(out.createPalette, OLD_CREATE_LAYOUT)) out.createPalette = null;
  if (sameLayout(out.createPalette, NO_LASSO_REFERENCE_LAYOUT)) out.createPalette = null;
  if (out.gestures && typeof out.gestures === "object" && !Array.isArray(out.gestures)) {
    const gestures = migrateGestures(out.gestures as Record<string, unknown>);
    out.gestures = out.holdRoles === true ? gestures : migrateHoldRoles(gestures);
    out.holdRoles = true;
  }
  return out;
}
