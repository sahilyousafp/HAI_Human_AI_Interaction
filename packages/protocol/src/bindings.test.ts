import { describe, expect, it } from "vitest";
import {
  actionFor,
  BINDING_KEYS,
  DEFAULT_BINDINGS,
  GESTURE_SLOTS,
  GestureBindingsSchema,
  resolveBindings,
} from "./bindings.ts";

describe("gesture bindings", () => {
  it("defaults: a long pinch with either hand is hold to talk", () => {
    expect(actionFor(DEFAULT_BINDINGS, "hold", "Right")).toBe("talk");
    expect(actionFor(DEFAULT_BINDINGS, "hold", "Left")).toBe("talk");
    for (const hand of ["Left", "Right"] as const) {
      expect(actionFor(DEFAULT_BINDINGS, "tap", hand)).toBe("use-tool");
      expect(actionFor(DEFAULT_BINDINGS, "drag", hand)).toBe("tool-or-orbit");
      expect(actionFor(DEFAULT_BINDINGS, "fist", hand)).toBe("cancel");
      expect(actionFor(DEFAULT_BINDINGS, "fistdrag", hand)).toBe("pan");
    }
    expect(actionFor(DEFAULT_BINDINGS, "stop")).toBe("stop-agent");
    expect(actionFor(DEFAULT_BINDINGS, "twohand", "Left")).toBe("navigate");
  });

  it("every default is one of its gesture's own actions", () => {
    for (const key of BINDING_KEYS) {
      const slot = key.split(".")[0] as keyof typeof GESTURE_SLOTS;
      expect(GESTURE_SLOTS[slot].actions as readonly string[]).toContain(DEFAULT_BINDINGS[key]);
    }
  });

  it("per-hand choices apply to their hand only", () => {
    const b = resolveBindings({ "tap.left": "select", "fist.right": "undo" });
    expect(actionFor(b, "tap", "Left")).toBe("select");
    expect(actionFor(b, "tap", "Right")).toBe("use-tool");
    expect(actionFor(b, "fist", "Right")).toBe("undo");
    expect(actionFor(b, "fist", "Left")).toBe("cancel");
  });

  it("settings saved before per-hand gestures still apply, to both hands", () => {
    const b = resolveBindings({ tap: "select", fist: "undo", hold: "palette", palms: "none" });
    expect(actionFor(b, "tap", "Left")).toBe("select");
    expect(actionFor(b, "tap", "Right")).toBe("select");
    expect(actionFor(b, "fist", "Left")).toBe("undo");
    // The old single palette is no longer offered: each hand keeps the default.
    expect(actionFor(b, "hold", "Left")).toBe("talk");
    expect(actionFor(b, "hold", "Right")).toBe("talk");
    expect(actionFor(b, "stop")).toBe("none");
    // A newer per-hand choice wins over an older shared one.
    expect(actionFor(resolveBindings({ tap: "select", "tap.right": "undo" }), "tap", "Right")).toBe("undo");
  });

  it("a fist drag is set per hand to pan, orbit or nothing, and the fist hold keeps its actions", () => {
    const b = resolveBindings({ "fistdrag.left": "orbit", "fistdrag.right": "none" });
    expect(actionFor(b, "fistdrag", "Left")).toBe("orbit");
    expect(actionFor(b, "fistdrag", "Right")).toBe("none");
    expect(GESTURE_SLOTS.fistdrag.actions).toEqual(["pan", "orbit", "none"]);
    expect(GESTURE_SLOTS.fist.actions).toEqual(["undo", "redo", "cancel", "ask-agent", "stop-agent", "none"]);
    expect(GestureBindingsSchema.safeParse({ "fistdrag.left": "cancel" }).success).toBe(false);
    expect(GestureBindingsSchema.safeParse({ "fist.left": "pan" }).success).toBe(false);
  });

  it("settings saved before the fist drag existed load with it set to pan on both hands", () => {
    const old = { "tap.left": "select", "fist.right": "undo", nod: "none" };
    expect(GestureBindingsSchema.safeParse(old).success).toBe(true);
    const b = resolveBindings(old);
    for (const hand of ["Left", "Right"] as const) expect(actionFor(b, "fistdrag", hand)).toBe("pan");
    expect(actionFor(b, "fist", "Right")).toBe("undo");
  });

  it("ignores actions a gesture does not offer and unknown gestures", () => {
    const b = resolveBindings({ "tap.left": "navigate", wave: "undo" });
    expect(b).toEqual(DEFAULT_BINDINGS);
  });

  it("the stored schema accepts per-hand and older keys, and refuses what a gesture cannot do", () => {
    expect(GestureBindingsSchema.safeParse({ "hold.left": "action-ring", nod: "undo" }).success).toBe(true);
    expect(GestureBindingsSchema.safeParse({ "hold.right": "talk" }).success).toBe(true);
    expect(GestureBindingsSchema.safeParse({ "tap.right": "talk" }).success).toBe(false);
    expect(GestureBindingsSchema.safeParse({ hold: "palette", palms: "stop-agent" }).success).toBe(true);
    expect(GestureBindingsSchema.safeParse({ "tap.left": "navigate" }).success).toBe(false);
    expect(GestureBindingsSchema.safeParse({ wave: "undo" }).success).toBe(false);
  });
});
