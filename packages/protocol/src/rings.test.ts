import { describe, expect, it } from "vitest";
import { actionFor, resolveBindings } from "./bindings.ts";
import { Settings } from "./messages.ts";
import { DEFAULT_ACTION_LAYOUT, DEFAULT_REFERENCE_LAYOUT, migrateRingSettings, ringFor } from "./rings.ts";

const OLD_TOOLS = ["select", "ask-agent", "measure", "section", "move", "massing", "delete", "undo"];
const OLD_CREATE = ["wall", "slab", "column", "massing", "copy", "redo", "undo", "delete"];

describe("the two rings", () => {
  it("the dominant hand shows the action ring and the other hand the reference ring", () => {
    expect(ringFor("Right", "Right")).toBe("action");
    expect(ringFor("Left", "Right")).toBe("reference");
    expect(ringFor("Left", "Left")).toBe("action");
    expect(ringFor("Right", "Left")).toBe("reference");
  });

  it("the default layouts have eight slots and no tool twice", () => {
    for (const layout of [DEFAULT_ACTION_LAYOUT, DEFAULT_REFERENCE_LAYOUT]) {
      expect(layout).toHaveLength(8);
      const ids = layout.filter((id) => id !== null);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const both = [...DEFAULT_ACTION_LAYOUT, ...DEFAULT_REFERENCE_LAYOUT].filter((id) => id !== null);
    expect(new Set(both).size).toBe(both.length);
  });

  it("Dominant hand is right unless set, and only left or right", () => {
    expect(Settings.parse({ palette: null }).dominantHand).toBe("Right");
    expect(Settings.safeParse({ palette: null, dominantHand: "Left" }).success).toBe(true);
    expect(Settings.safeParse({ palette: null, dominantHand: "Both" }).success).toBe(false);
  });
});

describe("settings saved before hold to talk", () => {
  it("Old default layout is replaced", () => {
    const migrated = migrateRingSettings({ palette: OLD_TOOLS, createPalette: OLD_CREATE });
    expect(migrated.palette).toBeNull();
    expect(migrated.createPalette).toBeNull();
  });

  it("the reference ring from before Lasso select takes the new default, so its free slot fills", () => {
    const before = [
      "sketch-line",
      "sketch-area",
      "place-marker",
      "measure",
      "massing",
      "section",
      "line",
      null,
    ];
    expect(migrateRingSettings({ createPalette: before }).createPalette).toBeNull();
    const own = [
      "sketch-line",
      "sketch-area",
      "place-marker",
      "measure",
      "massing",
      "section",
      "line",
      "wall",
    ];
    expect(migrateRingSettings({ createPalette: own }).createPalette).toEqual(own);
    expect(DEFAULT_REFERENCE_LAYOUT[7]).toBe("lasso");
  });

  it("Custom layout is kept", () => {
    const custom = ["section", ...OLD_CREATE.slice(1)];
    expect(migrateRingSettings({ createPalette: custom }).createPalette).toEqual(custom);
  });

  it("the old default long pinch takes the role defaults, however it was stored", () => {
    for (const gestures of [
      { "hold.left": "create-ring", "hold.right": "tools-ring", "tap.left": "select" },
      { "hold.right": "tools-ring" },
      { hold: "palette" },
    ]) {
      const migrated = migrateRingSettings({ gestures }).gestures as Record<string, string>;
      const bindings = resolveBindings(migrated);
      expect(actionFor(bindings, "hold", "Left")).toBe("talk");
      expect(actionFor(bindings, "hold", "Right")).toBe("action-ring");
    }
    const kept = migrateRingSettings({ gestures: { "tap.left": "select", hold: "palette" } }).gestures;
    expect(kept).toEqual({ "tap.left": "select" });
  });

  it("a custom long pinch is kept, with the rings' new names", () => {
    const migrated = migrateRingSettings({ gestures: { "hold.left": "tools-ring", "hold.right": "undo" } });
    expect(migrated.gestures).toEqual({ "hold.left": "action-ring", "hold.right": "undo" });
    const both = migrateRingSettings({ gestures: { hold: "create-ring" } });
    expect(both.gestures).toEqual({ hold: "reference-ring" });
  });

  it("running it twice gives the same result", () => {
    for (const stored of [
      { palette: OLD_TOOLS, gestures: { "hold.right": "tools-ring" }, speech: "device" },
      { createPalette: OLD_CREATE, gestures: { "hold.left": "tools-ring", "hold.right": "undo" } },
      { gestures: { "hold.left": "reference-ring", "hold.right": "action-ring" } },
    ]) {
      const once = migrateRingSettings(stored);
      expect(migrateRingSettings(once)).toEqual(once);
    }
  });

  it("talk on both hands, as hold to talk first stored it, takes the role defaults once", () => {
    const stored = { gestures: { "hold.left": "talk", "hold.right": "talk", "tap.left": "select" } };
    const migrated = migrateRingSettings(stored);
    expect(migrated.gestures).toEqual({ "tap.left": "select" });
    expect(migrated.holdRoles).toBe(true);
    const bindings = resolveBindings(migrated.gestures as Record<string, string>);
    expect(actionFor(bindings, "hold", "Right")).toBe("action-ring");
    expect(actionFor(bindings, "hold", "Left")).toBe("talk");
    // Chosen again after the change, talk on both hands is kept.
    const chosen = { holdRoles: true, gestures: { "hold.left": "talk", "hold.right": "talk" } };
    expect(migrateRingSettings(chosen)).toEqual(chosen);
  });

  it("a custom long pinch on one hand keeps both hands as they were", () => {
    const stored = { gestures: { "hold.left": "talk", "hold.right": "undo" } };
    expect(migrateRingSettings(stored).gestures).toEqual(stored.gestures);
  });

  it("leaves other settings alone", () => {
    expect(migrateRingSettings({ speech: "cloud", lastProject: "x" })).toEqual({
      speech: "cloud",
      lastProject: "x",
    });
  });
});
