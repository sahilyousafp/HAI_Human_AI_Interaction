import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPanelDescription, PANEL_HAND_CONTROLS } from "../apps/bridge/src/mcp/panel-api.ts";

// The agent is told which controls a hand can use in a panel. That list must be exactly the controls the hand tests
// press, so a control is never promised that no test has driven.

const root = join(import.meta.dirname, "..");
const hands = readFileSync(join(root, "e2e", "panel-hands.spec.ts"), "utf8");
const gestures = readFileSync(join(root, "docs", "gestures.md"), "utf8");
const description = openPanelDescription("");

/** Where each control is driven by hand in e2e/panel-hands.spec.ts. */
const COVERED_BY = {
  button: 'test("Press a button inside the panel',
  checkbox: 'type="checkbox"',
  radio: 'type="radio"',
  range: 'test("a hand-dragged range moves like a mouse-dragged one',
};

describe("hand input in panels", () => {
  it("the description lists exactly the controls the hand tests cover", () => {
    expect([...PANEL_HAND_CONTROLS].sort()).toEqual(Object.keys(COVERED_BY).sort());
    for (const [control, marker] of Object.entries(COVERED_BY)) expect(hands, control).toContain(marker);
    const listed = /Controls that work by hand: ([^.]+)\./.exec(description)?.[1] ?? "";
    expect(listed.split(", ").sort()).toEqual([...PANEL_HAND_CONTROLS].sort());
  });

  it("the description says what a hand cannot use", () => {
    expect(description).toContain("<select>");
    expect(description).toContain("text fields");
  });

  it("docs/gestures.md documents each control and what is left to the mouse", () => {
    const section = gestures.slice(
      gestures.indexOf("## Hands in a generated panel"),
      gestures.indexOf("## Thresholds"),
    );
    for (const word of ["Button", "Checkbox", "radio", "Range", "select", "text fields", "Escape"])
      expect(section, word).toContain(word);
  });
});
