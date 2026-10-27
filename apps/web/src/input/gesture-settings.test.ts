import { actionFor } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { GestureSettings } from "./gesture-settings.ts";

describe("gesture settings", () => {
  it("a long pinch goes by role: the dominant hand's ring and the other hand's talk swap with the setting", () => {
    const settings = new GestureSettings(() => true);
    expect(actionFor(settings.getSnapshot(), "hold", "Right")).toBe("action-ring");
    expect(actionFor(settings.getSnapshot(), "hold", "Left")).toBe("talk");
    settings.setDominant("Left");
    expect(actionFor(settings.getSnapshot(), "hold", "Left")).toBe("action-ring");
    expect(actionFor(settings.getSnapshot(), "hold", "Right")).toBe("talk");
  });

  it("only the user's own choices are saved, so a chosen gesture stays when the dominant hand changes", () => {
    const saved: unknown[] = [];
    const settings = new GestureSettings((b) => saved.push(b) > 0);
    settings.set("hold.right", "undo");
    expect(saved.at(-1)).toEqual({ "hold.right": "undo" });
    settings.setDominant("Left");
    expect(actionFor(settings.getSnapshot(), "hold", "Right")).toBe("undo");
    expect(actionFor(settings.getSnapshot(), "hold", "Left")).toBe("action-ring");
    // Choosing the default again forgets the choice.
    settings.set("hold.right", "talk");
    expect(saved.at(-1)).toEqual({});
    settings.reset();
    expect(saved.at(-1)).toEqual({});
  });
});
