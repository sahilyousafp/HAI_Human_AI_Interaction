import { createRequire } from "node:module";
import type { Element, SceneDocument } from "@hai/protocol";
import { type MeshPart, partBounds } from "@hai/scene";
import type { RhinoModule } from "rhino3dm";
import { beforeAll, describe, expect, it } from "vitest";
import { convert3dm } from "../import/convert.ts";
import { buildFile3dm } from "./build.ts";

let rhino: RhinoModule;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rhino = await (require("rhino3dm") as () => Promise<RhinoModule>)();
});

const ASSET = "0f8fad5b-d9cb-469f-a165-70867728950e";
const props = { properties: {} };
const wall: Element = {
  ...props,
  id: "w-1",
  type: "wall",
  name: "North wall",
  level: "L1",
  start: [1000, 1000],
  end: [7000, 1000],
  height: 3000,
  thickness: 200,
};
const slab: Element = {
  ...props,
  id: "s-1",
  type: "slab",
  name: "Floor",
  level: "L1",
  outline: [
    [0, 0],
    [8000, 0],
    [8000, 4000],
    [0, 4000],
  ],
  thickness: 250,
};
const column: Element = {
  id: "c-1",
  type: "column",
  name: "Column A",
  properties: { material: "steel" },
  level: "L0",
  position: [500, 500],
  section: [400, 400],
  height: 3000,
};
const box: Element = {
  ...props,
  id: "i-1",
  type: "imported",
  name: "Facade panel",
  asset: ASSET,
  part: 0,
  bounds: { min: [0, 0, 0], max: [1000, 1000, 1000] },
  translation: [1000, 0, 0],
  layer: "Facade",
  color: "#ff0000",
};

const docOf = (...elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [
    { id: "L0", name: "Ground", elevation: 0 },
    { id: "L1", name: "Level 1", elevation: 4500 },
  ],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

const triangle: MeshPart = {
  positions: new Float32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 1000]),
  indices: new Uint32Array([0, 1, 2]),
};
const assets = new Map([[ASSET, [triangle]]]);

/** Reads a saved file back with rhino3dm itself. */
function readBack(bytes: Uint8Array) {
  const file = rhino.File3dm.fromByteArray(bytes);
  if (!file) throw new Error("the saved file cannot be read");
  const objects = [];
  for (let i = 0; i < file.objects().count; i++) {
    const o = file.objects().get(i);
    const a = o.attributes();
    const g = o.geometry();
    const bb = (g as unknown as { getBoundingBox(): { min: number[]; max: number[] } }).getBoundingBox();
    objects.push({
      kind: g.constructor.name,
      name: a.name,
      layer: file.layers().get(a.layerIndex).name,
      min: Array.from(bb.min),
      max: Array.from(bb.max),
      strings: Object.fromEntries(a.getUserStrings() as unknown as Array<[string, string]>),
    });
  }
  const units = file.settings().modelUnitSystem;
  return { objects, units, mm: units === rhino.UnitSystem.Millimeters };
}

describe("buildFile3dm", () => {
  it("saves a drawn project as native extrusions on layers named after their types, in millimetres", () => {
    const result = buildFile3dm(rhino, { doc: docOf(wall, slab, column), assets });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report).toMatchObject({ objects: 3, extrusions: 3, meshes: 0, skipped: [] });
    const back = readBack(result.bytes);
    expect(back.mm).toBe(true);
    expect(back.objects.map((o) => [o.kind, o.layer, o.name])).toEqual([
      ["Extrusion", "Walls", "North wall"],
      ["Extrusion", "Slabs", "Floor"],
      ["Extrusion", "Columns", "Column A"],
    ]);
  });

  it("a line is saved as a polyline curve at its real heights, a closed one returning to its start", () => {
    const line: Element = {
      id: "ln-1",
      name: "Path",
      type: "line",
      level: "L1",
      properties: {},
      closed: true,
      points: [
        [0, 0, 4500],
        [4000, 0, 4500],
        [4000, 3000, 5000],
      ],
    };
    const result = buildFile3dm(rhino, { doc: docOf(line), assets });
    if (!result.ok) throw new Error(result.error);
    expect(result.report).toMatchObject({ objects: 1, curves: 1, extrusions: 0, skipped: [] });
    const [curve] = readBack(result.bytes).objects;
    expect(curve).toMatchObject({ kind: "NurbsCurve", layer: "Lines", name: "Path" });
    expect(curve?.min).toEqual([0, 0, 4500]);
    expect(curve?.max).toEqual([4000, 3000, 5000]);
    expect(curve?.strings).toMatchObject({ "hai.id": "ln-1", "hai.level": "Level 1" });
  });

  it("heights and sizes are exact: a wall 6000 x 200 x 3000 on a level at 4500", () => {
    const result = buildFile3dm(rhino, { doc: docOf(wall), assets });
    if (!result.ok) throw new Error(result.error);
    const [w] = readBack(result.bytes).objects;
    expect(w?.min).toEqual([1000, 900, 4500]);
    expect(w?.max).toEqual([7000, 1100, 7500]);
  });

  it("a slab hangs down from its level", () => {
    const result = buildFile3dm(rhino, { doc: docOf(slab), assets });
    if (!result.ok) throw new Error(result.error);
    const [s] = readBack(result.bytes).objects;
    expect(s?.min[2]).toBe(4250);
    expect(s?.max[2]).toBe(4500);
  });

  it("keeps the element's id, level and properties as text on the object", () => {
    const result = buildFile3dm(rhino, { doc: docOf(column), assets });
    if (!result.ok) throw new Error(result.error);
    const [c] = readBack(result.bytes).objects;
    expect(c?.strings).toEqual({
      "hai.id": "c-1",
      "hai.level": "Ground",
      "hai.property.material": "steel",
    });
  });

  it("an imported model comes back as a mesh moved by its translation, on its layer, in its colour", () => {
    const result = buildFile3dm(rhino, { doc: docOf(box), assets });
    if (!result.ok) throw new Error(result.error);
    const [m] = readBack(result.bytes).objects;
    expect(m).toMatchObject({
      kind: "Mesh",
      layer: "Facade",
      name: "Facade panel",
      min: [1000, 0, 0],
      max: [2000, 1000, 1000],
    });
    const file = rhino.File3dm.fromByteArray(result.bytes);
    const attributes = file?.objects().get(0).attributes();
    expect(attributes?.objectColor).toMatchObject({ r: 255, g: 0, b: 0 });
  });

  it("the saved file imports again, and the report counts every object", () => {
    const result = buildFile3dm(rhino, { doc: docOf(wall, slab, column, box), assets });
    if (!result.ok) throw new Error(result.error);
    const again = convert3dm(rhino, result.bytes);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.imported).toBe(4);
    expect(again.report.skipped).toMatchObject({ noMesh: 0, unsupported: 0, curves: 0 });
    // The wall comes back as its prism: 6000 x 200 x 3000 at 4500.
    const wallPart = again.parts.find((p) => p.name === "North wall");
    expect(partBounds(wallPart as MeshPart)).toEqual({ min: [1000, 900, 4500], max: [7000, 1100, 7500] });
    expect(again.report.units.name).toBe("millimeters");
  });

  it("a missing model file is reported, and the rest is saved", () => {
    const result = buildFile3dm(rhino, { doc: docOf(wall, box), assets: new Map() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.objects).toBe(1);
    expect(result.report.skipped).toEqual(["Facade panel: its model file is missing"]);
  });

  it("an empty project has nothing to save", () => {
    expect(buildFile3dm(rhino, { doc: docOf(), assets })).toEqual({
      ok: false,
      error: "There is nothing to save: the project has no elements.",
    });
  });
});
