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
  it("defaults: a long pinch opens the tools ring on the right hand and the create ring on the left", () => {
    expect(actionFor(DEFAULT_BINDINGS, "hold", "Right")).toBe("tools-ring");
    expect(actionFor(DEFAULT_BINDINGS, "hold", "Left")).toBe("create-ring");
    for (const hand of ["Left", "Right"] as const) {
      expect(actionFor(DEFAULT_BINDINGS, "tap", hand)).toBe("use-tool");
      expect(actionFor(DEFAULT_BINDINGS, "drag", hand)).toBe("tool-or-orbit");
      expect(actionFor(DEFAULT_BINDINGS, "fist", hand)).toBe("cancel");
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
    // The old single palette: each hand keeps its own ring.
    expect(actionFor(b, "hold", "Left")).toBe("create-ring");
    expect(actionFor(b, "hold", "Right")).toBe("tools-ring");
    expect(actionFor(b, "stop")).toBe("none");
    // A newer per-hand choice wins over an older shared one.
    expect(actionFor(resolveBindings({ tap: "select", "tap.right": "undo" }), "tap", "Right")).toBe("undo");
  });

  it("ignores actions a gesture does not offer and unknown gestures", () => {
    const b = resolveBindings({ "tap.left": "navigate", wave: "undo" });
    expect(b).toEqual(DEFAULT_BINDINGS);
  });

  it("the stored schema accepts per-hand and older keys, and refuses what a gesture cannot do", () => {
    expect(GestureBindingsSchema.safeParse({ "hold.left": "tools-ring", nod: "undo" }).success).toBe(true);
    expect(GestureBindingsSchema.safeParse({ hold: "palette", palms: "stop-agent" }).success).toBe(true);
    expect(GestureBindingsSchema.safeParse({ "tap.left": "navigate" }).success).toBe(false);
    expect(GestureBindingsSchema.safeParse({ wave: "undo" }).success).toBe(false);
  });
});
