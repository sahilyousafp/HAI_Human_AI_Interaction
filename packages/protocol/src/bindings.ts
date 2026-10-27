import { z } from "zod";
import type { Hand } from "./gestures.ts";

/** What a gesture can be set to do. Each gesture offers the subset that makes sense for it. */
export const GestureAction = z.enum([
  "use-tool",
  "select",
  "talk",
  "action-ring",
  "reference-ring",
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
  talk: "Hold to talk about this (the ring when silent)",
  "action-ring": "Open the action ring",
  "reference-ring": "Open the reference ring",
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
  "stop-agent": "Stop the agents",
  none: "Nothing",
};

/** What a one-hand gesture does by role: for the dominant hand and for the other hand. */
type RoleDefaults = { dominant: GestureAction; other: GestureAction };

/** One-shot actions any discrete gesture can run. */
const COMMANDS: GestureAction[] = ["undo", "redo", "cancel", "ask-agent", "stop-agent", "none"];

/**
 * The hand and head gestures the app recognises that can be given an action, in the order the settings show them,
 * with what each does out of the box. One-hand gestures (`perHand`) are set for each hand on its own; `default` is
 * the same for both unless `roles` gives the dominant hand and the other hand their own (the Dominant hand setting
 * decides which hand is which). Engaging (an open palm) is fixed and not listed.
 */
export const GESTURE_SLOTS = {
  tap: {
    label: "Pinch tap",
    how: "Touch thumb and index and let go, keeping the hand still",
    perHand: true,
    actions: ["use-tool", "select", ...COMMANDS],
    default: "use-tool",
  },
  hold: {
    label: "Long pinch",
    how: "Pinch and keep still for a moment",
    perHand: true,
    actions: ["talk", "action-ring", "reference-ring", "select", ...COMMANDS],
    // The dominant hand opens its action ring at once; the other hand talks, and held silent shows the reference ring.
    default: "talk",
    roles: { dominant: "action-ring", other: "talk" },
  },
  drag: {
    label: "Pinch drag",
    how: "Pinch and move the hand",
    perHand: true,
    actions: ["tool-or-orbit", "orbit", "pan", "none"],
    default: "tool-or-orbit",
  },
  fistdrag: {
    label: "Fist drag",
    how: "Close the hand into a fist and move it",
    perHand: true,
    actions: ["pan", "orbit", "none"],
    default: "pan",
  },
  fist: {
    label: "Fist hold",
    how: "Close the hand into a fist and keep it still for a second and a half",
    perHand: true,
    actions: COMMANDS,
    default: "cancel",
  },
  twohand: {
    label: "Two-hand pinch",
    how: "Pinch with both hands at once and move them",
    perHand: false,
    actions: ["navigate", "none"],
    default: "navigate",
  },
  nod: {
    label: "Nod",
    how: "Nod your head down and up",
    perHand: false,
    actions: ["yes", ...COMMANDS],
    default: "yes",
  },
  shake: {
    label: "Shake",
    how: "Shake your head left and right",
    perHand: false,
    actions: ["no", ...COMMANDS],
    default: "no",
  },
  stop: {
    label: "Two fists, then open hands",
    how: "Clench both hands into fists, then open both palms toward the camera",
    perHand: false,
    actions: ["stop-agent", "undo", "cancel", "none"],
    default: "stop-agent",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    how: string;
    perHand: boolean;
    actions: GestureAction[];
    default: GestureAction;
    roles?: RoleDefaults;
  }
>;

export type GestureSlot = keyof typeof GESTURE_SLOTS;
export const GESTURE_SLOT_IDS = Object.keys(GESTURE_SLOTS) as GestureSlot[];
export type HandSlot = {
  [S in GestureSlot]: (typeof GESTURE_SLOTS)[S]["perHand"] extends true ? S : never;
}[GestureSlot];
export type SharedSlot = Exclude<GestureSlot, HandSlot>;
export const HAND_SLOTS = GESTURE_SLOT_IDS.filter((s) => GESTURE_SLOTS[s].perHand) as HandSlot[];
export const SHARED_SLOTS = GESTURE_SLOT_IDS.filter((s) => !GESTURE_SLOTS[s].perHand) as SharedSlot[];

/** Where one action is stored: `tap.left` for a one-hand gesture's hand, `nod` for a shared one. */
export type BindingKey = `${HandSlot}.${"left" | "right"}` | SharedSlot;
export const BINDING_KEYS: BindingKey[] = [
  ...HAND_SLOTS.flatMap((s) => [`${s}.left`, `${s}.right`] as BindingKey[]),
  ...SHARED_SLOTS,
];
export type GestureBindings = Record<BindingKey, GestureAction>;

/** The storage key of a gesture, for a hand when the gesture is set per hand. */
export function bindingKey(slot: GestureSlot, hand?: Hand): BindingKey {
  if (!GESTURE_SLOTS[slot].perHand) return slot as SharedSlot;
  return `${slot as HandSlot}.${hand === "Left" ? "left" : "right"}`;
}

function slotOf(key: BindingKey): GestureSlot {
  return key.split(".")[0] as GestureSlot;
}

function handOf(key: BindingKey): Hand | null {
  if (key.endsWith(".left")) return "Left";
  if (key.endsWith(".right")) return "Right";
  return null;
}

function defaultFor(key: BindingKey, dominant: Hand): GestureAction {
  const slot: { default: GestureAction; roles?: RoleDefaults } = GESTURE_SLOTS[slotOf(key)];
  const hand = handOf(key);
  if (!hand || !slot.roles) return slot.default;
  return hand === dominant ? slot.roles.dominant : slot.roles.other;
}

/** What every gesture does out of the box, for a user whose dominant hand is `dominant`. */
export function defaultBindings(dominant: Hand = "Right"): GestureBindings {
  return Object.fromEntries(BINDING_KEYS.map((key) => [key, defaultFor(key, dominant)])) as GestureBindings;
}

/** The defaults for a right-handed user, the app's own default. */
export const DEFAULT_BINDINGS = defaultBindings("Right");

/** What a gesture does, for the hand that made it when it is set per hand. */
export function actionFor(bindings: GestureBindings, slot: GestureSlot, hand?: Hand): GestureAction {
  return bindings[bindingKey(slot, hand)];
}

const allowed = (key: BindingKey, action: string): boolean =>
  (GESTURE_SLOTS[slotOf(key)].actions as readonly string[]).includes(action);

/**
 * Keys from before per-hand settings: a one-hand gesture for both hands (with the long pinch's old single
 * `palette`), and the old two-palm stop. Each maps to the binding keys it now stands for.
 */
const LEGACY: Record<string, { keys: BindingKey[]; also?: string }> = {
  ...Object.fromEntries(
    HAND_SLOTS.map((s) => [
      s,
      { keys: [`${s}.left`, `${s}.right`], ...(s === "hold" ? { also: "palette" } : {}) },
    ]),
  ),
  palms: { keys: ["stop"] },
};

/**
 * The user's choices: any subset of binding keys, each set to one of that gesture's own actions. Settings saved
 * before gestures were set per hand (`tap`, `hold`, `drag`, `fist` for both hands, `palms` for the stop) are still
 * accepted; `resolveBindings` reads them.
 */
export const GestureBindingsSchema = z.record(z.string(), z.string()).superRefine((bindings, ctx) => {
  for (const [key, action] of Object.entries(bindings)) {
    if ((BINDING_KEYS as string[]).includes(key)) {
      if (!allowed(key as BindingKey, action))
        ctx.addIssue({ code: "custom", path: [key], message: `${key} cannot be set to ${action}` });
    } else if (LEGACY[key]) {
      const { keys, also } = LEGACY[key];
      if (action !== also && !keys.every((k) => allowed(k, action)))
        ctx.addIssue({ code: "custom", path: [key], message: `${key} cannot be set to ${action}` });
    } else {
      ctx.addIssue({ code: "custom", path: [key], message: `${key} is not a gesture` });
    }
  }
});

/**
 * Stored choices over the defaults for the dominant hand, ignoring anything a gesture no longer offers. A gesture the
 * user never set follows its role, so switching the dominant hand swaps what each hand's long pinch does.
 */
export function resolveBindings(
  stored: Partial<Record<string, string>> | null | undefined,
  dominant: Hand = "Right",
): GestureBindings {
  const bindings = defaultBindings(dominant);
  const take = (key: BindingKey, action: string | undefined) => {
    if (action && allowed(key, action)) bindings[key] = action as GestureAction;
  };
  // Older settings first, so a newer per-hand choice wins. The old single palette ("palette") became one ring per
  // hand, so each hand keeps its own default ring: `take` ignores it as no longer offered.
  for (const [legacy, { keys }] of Object.entries(LEGACY))
    for (const key of keys) take(key, stored?.[legacy]);
  for (const key of BINDING_KEYS) take(key, stored?.[key]);
  return bindings;
}

/** Only the choices that differ from the defaults for the dominant hand: what is stored, so defaults keep their role. */
export function changedBindings(bindings: GestureBindings, dominant: Hand): Partial<GestureBindings> {
  const defaults = defaultBindings(dominant);
  return Object.fromEntries(
    BINDING_KEYS.filter((k) => bindings[k] !== defaults[k]).map((k) => [k, bindings[k]]),
  );
}
