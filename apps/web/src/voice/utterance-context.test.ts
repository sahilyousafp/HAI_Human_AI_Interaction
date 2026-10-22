import type { SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { UtteranceContext } from "./utterance-context.ts";

const column = (id: string, name: string) => ({
  id,
  type: "column" as const,
  name,
  level: "L0",
  position: [0, 0] as [number, number],
  section: [400, 400] as [number, number],
  height: 3000,
  properties: {},
});
const doc: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "T",
  levels: [{ id: "L0", name: "G", elevation: 0 }],
  elements: {
    a: column("a", "Column A"),
    b: column("b", "Column B"),
    w: { ...column("w", "Wall"), type: "column" },
  },
};

describe("UtteranceContext (point and speak)", () => {
  it("point at two columns while speaking: both are captured, in order", () => {
    const c = new UtteranceContext();
    c.begin(0, null);
    c.hover("a", 100);
    c.hover("b", 500); // rested on A for 400 ms
    c.hover(null, 900); // rested on B for 400 ms
    c.end(1000);
    expect(c.resolve(doc, [], null).references.map((r) => r.name)).toEqual(["Column A", "Column B"]);
  });

  it("a brief pass-over is ignored", () => {
    const c = new UtteranceContext();
    c.begin(0, null);
    c.hover("w", 100);
    c.hover(null, 200); // 100 ms over the wall
    c.end(1000);
    expect(c.ids).toEqual([]);
  });

  it("an element the pointer keeps resting on is captured on time (for its marker), and only once", () => {
    const c = new UtteranceContext();
    c.begin(0, "a"); // already under the pointer when speech starts
    c.tick(250);
    expect(c.ids).toEqual([]);
    c.tick(320);
    expect(c.ids).toEqual(["a"]);
    c.end(900);
    expect(c.ids).toEqual(["a"]);
  });

  it("taps that add to the selection count at once", () => {
    const c = new UtteranceContext();
    c.begin(0, null);
    c.selected(["a"], []);
    c.selected(["a", "b"], ["a"]);
    expect(c.ids).toEqual(["a", "b"]);
  });

  it("select first, then speak: with nothing captured, the selection is the references", () => {
    const c = new UtteranceContext();
    c.begin(0, null);
    c.end(1500);
    const context = c.resolve(doc, ["a", "b", "gone"], [100, 200, 0]);
    expect(context.references.map((r) => r.id)).toEqual(["a", "b"]);
    expect(context.selection).toEqual(["a", "b", "gone"]);
    expect(context.groundPoint).toEqual([100, 200, 0]);
  });

  it("hovering before speech starts captures nothing", () => {
    const c = new UtteranceContext();
    c.hover("a", 0);
    c.hover(null, 1000);
    c.begin(1100, null);
    c.end(2000);
    expect(c.ids).toEqual([]);
  });
});
