import { z } from "zod";

/** What a gesture can be set to do. Each gesture offers the subset that makes sense for it. */
export const GestureAction = z.enum([
  "use-tool",
  "select",
  "palette",
  "tool-or-orbit",
  "orbit",
  "pan",
  "navigate",
  "undo",
  "redo",
  "cancel",
  "yes",
  "no",
  "ask-agent",
  "stop-agent",
  "none",
]);
export type GestureAction = z.infer<typeof GestureAction>;

export const ACTION_LABELS: Record<GestureAction, string> = {
  "use-tool": "Use the active tool",
  select: "Select what it points at",
  palette: "Open the tool palette",
  "tool-or-orbit": "Active tool, else orbit",
  orbit: "Orbit the view",
  pan: "Pan the view",
  navigate: "Zoom, pan and turn the view",
  undo: "Undo",
  redo: "Redo",
  cancel: "Cancel, back to Select",
  yes: "Yes: confirm or allow",
  no: "No: cancel or deny",
  "ask-agent": "Ask the agent",
  "stop-agent": "Stop the agent",
  none: "Nothing",
};

/** One-shot actions any discrete gesture can run. */
const COMMANDS: GestureAction[] = ["undo", "redo", "cancel", "ask-agent", "stop-agent", "none"];

/**
 * The hand and head gestures the app recognises that can be given an action, in the order the settings show them,
 * with what each does out of the box. Engaging (an open palm) is fixed and not listed.
 */
export const GESTURE_SLOTS = {
  tap: {
    label: "Pinch tap",
    how: "Touch thumb and index and let go, keeping the hand still",
    actions: ["use-tool", "select", ...COMMANDS],
    default: "use-tool",
  },
  hold: {
    label: "Long pinch",
    how: "Pinch and keep still for a moment",
    actions: ["palette", "select", ...COMMANDS],
    default: "palette",
  },
  drag: {
    label: "Pinch drag",
    how: "Pinch and move the hand",
    actions: ["tool-or-orbit", "orbit", "pan", "none"],
    default: "tool-or-orbit",
  },
  twohand: {
    label: "Two-hand pinch",
    how: "Pinch with both hands and move them",
    actions: ["navigate", "none"],
    default: "navigate",
  },
  fist: {
    label: "Fist",
    how: "Close the hand and hold for half a second",
    actions: COMMANDS,
    default: "cancel",
  },
  nod: {
    label: "Nod",
    how: "Nod your head down and up",
    actions: ["yes", ...COMMANDS],
    default: "yes",
  },
  shake: {
    label: "Shake",
    how: "Shake your head left and right",
    actions: ["no", ...COMMANDS],
    default: "no",
  },
  palms: {
    label: "Two open palms",
    how: "Hold both open palms toward the camera",
    actions: ["stop-agent", "undo", "cancel", "none"],
    default: "stop-agent",
  },
} as const satisfies Record<
  string,
  { label: string; how: string; actions: GestureAction[]; default: GestureAction }
>;

export type GestureSlot = keyof typeof GESTURE_SLOTS;
export const GESTURE_SLOT_IDS = Object.keys(GESTURE_SLOTS) as GestureSlot[];
export type GestureBindings = Record<GestureSlot, GestureAction>;

export const DEFAULT_BINDINGS = Object.fromEntries(
  GESTURE_SLOT_IDS.map((slot) => [slot, GESTURE_SLOTS[slot].default]),
) as GestureBindings;

/** The user's choices: any subset of gestures, each set to one of that gesture's own actions. */
export const GestureBindingsSchema = z
  .partialRecord(z.enum(GESTURE_SLOT_IDS as [GestureSlot, ...GestureSlot[]]), GestureAction)
  .superRefine((bindings, ctx) => {
    for (const [slot, action] of Object.entries(bindings)) {
      const allowed: readonly GestureAction[] = GESTURE_SLOTS[slot as GestureSlot].actions;
      if (action && !allowed.includes(action))
        ctx.addIssue({ code: "custom", path: [slot], message: `${slot} cannot be set to ${action}` });
    }
  });

/** Stored choices over the defaults, ignoring anything a gesture no longer offers. */
export function resolveBindings(stored: Partial<Record<string, string>> | null | undefined): GestureBindings {
  const bindings = { ...DEFAULT_BINDINGS };
  for (const slot of GESTURE_SLOT_IDS) {
    const action = stored?.[slot];
    if ((GESTURE_SLOTS[slot].actions as readonly string[]).includes(action ?? ""))
      bindings[slot] = action as GestureAction;
  }
  return bindings;
}
