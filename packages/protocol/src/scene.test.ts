import { describe, expect, it } from "vitest";
import { parseScene, type SceneDocument } from "./scene.ts";

const scene = (elements: Record<string, unknown>): unknown => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements,
});

const wall = {
  id: "w-north",
  type: "wall",
  name: "North wall",
  level: "L0",
  start: [0, 0],
  end: [6000, 0],
  height: 3000,
  thickness: 300,
};

describe("parseScene", () => {
  it("accepts every element type", () => {
    const result = parseScene(
      scene({
        "m-1": { id: "m-1", type: "massing", name: "Block", origin: [0, 0, 0], size: [10000, 8000, 12000] },
        "s-1": {
          id: "s-1",
          type: "slab",
          name: "Slab",
          level: "L0",
          outline: [
            [0, 0],
            [1000, 0],
            [1000, 1000],
          ],
          thickness: 250,
        },
        "w-north": wall,
        "c-1": {
          id: "c-1",
          type: "column",
          name: "C1",
          level: "L0",
          position: [0, 0],
          section: [400, 400],
          height: 3000,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const doc: SceneDocument = result.doc;
      expect(Object.keys(doc.elements)).toHaveLength(4);
      // properties default to an empty record
      expect(doc.elements["w-north"]?.properties).toEqual({});
    }
  });

  it("invalid element is rejected: the error names the element id and the field", () => {
    const result = parseScene(scene({ "w-north": { ...wall, thickness: -300 } }));
    expect(result).toEqual({ ok: false, error: 'Element "w-north": thickness must be greater than 0' });
  });

  it.each([
    ["millimetres only", { ...(scene({}) as object), units: "m" }],
    ["Z up only", { ...(scene({}) as object), up: "Y" }],
    [
      "a slab with two points",
      scene({
        s: {
          id: "s",
          type: "slab",
          name: "S",
          outline: [
            [0, 0],
            [1, 1],
          ],
          thickness: 1,
        },
      }),
    ],
    ["an unknown element type", scene({ x: { id: "x", type: "roof", name: "R" } })],
    ["an unknown level", scene({ "w-north": { ...wall, level: "L9" } })],
    ["a key that differs from the id", scene({ other: wall })],
  ])("rejects %s", (_label, raw) => {
    expect(parseScene(raw).ok).toBe(false);
  });
});
