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

describe("imported elements", () => {
  const imported = {
    id: "i-1",
    type: "imported",
    name: "Facade panel",
    asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
    part: 2,
    bounds: { min: [0, 0, 0], max: [2000, 1000, 3000] },
    layer: "Facade",
    color: "#ff0000",
  };

  it("validates, and the translation defaults to zero", () => {
    const result = parseScene(scene({ "i-1": imported }));
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.doc.elements["i-1"]).toMatchObject({ translation: [0, 0, 0], layer: "Facade" });
  });

  it("names the element and the field when the bounding box is missing", () => {
    const { bounds: _bounds, ...without } = imported;
    const result = parseScene(scene({ "i-1": without }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('Element "i-1": bounds') });
  });

  it("rejects an inverted bounding box, a bad asset id and a bad colour", () => {
    const flipped = { ...imported, bounds: { min: [5, 0, 0], max: [0, 1, 1] } };
    expect(parseScene(scene({ "i-1": flipped })).ok).toBe(false);
    expect(parseScene(scene({ "i-1": { ...imported, asset: "../../etc/passwd" } })).ok).toBe(false);
    expect(parseScene(scene({ "i-1": { ...imported, color: "red" } })).ok).toBe(false);
  });
});

describe("base height", () => {
  it("walls, slabs and columns may carry their own base, and it must be a number", () => {
    const ok = parseScene(scene({ "w-top": { ...wall, id: "w-top", level: undefined, base: 31_200 } }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.doc.elements["w-top"]).toMatchObject({ base: 31_200 });
    expect(parseScene(scene({ "w-top": { ...wall, id: "w-top", base: "high" } })).ok).toBe(false);
  });
});
