import { z } from "zod";

/**
 * Features the user can switch off as a unit (Settings > Features), so a demo or a release shows exactly what is
 * turned on. A switched-off feature leaves the interface and ignores its gestures; nothing else changes. Every
 * feature is on until the user turns it off.
 */
export const FEATURES = [
  {
    id: "toolRings",
    label: "Tool rings",
    description: "A long pinch, Space or a held right button opens a ring of tools.",
  },
  {
    id: "createTools",
    label: "Create tools",
    description: "Wall, Slab, Column and Copy, and the left hand's create ring.",
  },
  {
    id: "twoHandNavigation",
    label: "Two-hand navigation",
    description: "Pinch with both hands to zoom, pan and turn the view.",
  },
  {
    id: "handScrolling",
    label: "Scroll by hand",
    description: "Pinch over a list and move the hand to scroll it.",
  },
  {
    id: "handPress",
    label: "Press controls by hand",
    description: "A pinch on a button, switch or link presses it.",
  },
  {
    id: "headGestures",
    label: "Nod and shake",
    description: "A nod says yes and a shake says no.",
  },
  {
    id: "stopGesture",
    label: "Stop gesture",
    description: "Both fists, then open hands, stop the agents.",
  },
  {
    id: "snapToButtons",
    label: "Snap to buttons",
    description: "A hand pointer near a button locks onto it, so a pinch presses it.",
  },
  {
    id: "voice",
    label: "Voice",
    description: "The microphone, the talk key and listening for names.",
  },
  {
    id: "agent",
    label: "Agent",
    description: "The agent panel and Ask agent.",
  },
  {
    id: "generatedPanels",
    label: "Generated panels",
    description: "The agent can offer a small panel for a task, such as a tolerance, and a nod opens it.",
  },
  {
    id: "latencyReadout",
    label: "Latency readout",
    description: "Gesture to render time in the status bar.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string }>;

export type FeatureId = (typeof FEATURES)[number]["id"];
export const FEATURE_IDS = FEATURES.map((f) => f.id) as FeatureId[];

/** Which features are on. */
export type Features = Record<FeatureId, boolean>;

export const DEFAULT_FEATURES = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as Features;

/** The user's choices: only the features they changed. Unknown names (from a newer or older app) are ignored. */
export const FeatureChoices = z.record(z.string(), z.boolean());
export type FeatureChoices = z.infer<typeof FeatureChoices>;

/** Stored choices over the defaults. */
export function resolveFeatures(stored: FeatureChoices | null | undefined): Features {
  const features = { ...DEFAULT_FEATURES };
  for (const id of FEATURE_IDS) {
    const on = stored?.[id];
    if (typeof on === "boolean") features[id] = on;
  }
  return features;
}
