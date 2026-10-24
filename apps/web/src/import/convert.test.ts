import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { partBounds } from "@hai/scene";
import type { RhinoModule } from "rhino3dm";
import { beforeAll, describe, expect, it } from "vitest";
import { convert3dm, describeSkips, IMPORT_LIMITS, totalSkipped } from "./convert.ts";

const MODELS = join(import.meta.dirname, "..", "..", "..", "..", "test-assets", "models");
const model = (name: string) => new Uint8Array(readFileSync(join(MODELS, name)));

let rhino: RhinoModule;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rhino = await (require("rhino3dm") as () => Promise<RhinoModule>)();
});

describe("convert3dm", () => {
  it("brings in meshes and Breps with their render meshes, one part each", () => {
    const result = convert3dm(rhino, model("meshes-and-breps.3dm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.map((p) => p.name)).toEqual(["Mesh 1", "Mesh 2", "Mesh 3", "Brep 1", "Brep 2"]);
    expect(result.report.imported).toBe(5);
    expect(totalSkipped(result.report.skipped)).toBe(0);
    // A 12-triangle box, and a Brep of six one-quad faces (12 triangles too).
    expect(result.parts[0]?.indices.length).toBe(36);
    expect(result.parts[3]?.indices.length).toBe(36);
    expect(partBounds(result.parts[0] as never)).toEqual({ min: [0, 0, 0], max: [2000, 2000, 3000] });
  });

  it("scales the file's units to millimetres", () => {
    const result = convert3dm(rhino, model("metres-box.3dm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.units).toEqual({ name: "meters", mm: 1000, assumed: false });
    expect(partBounds(result.parts[0] as never)).toEqual({ min: [0, 0, 0], max: [2000, 1000, 1000] });
  });

  it("keeps the layer name and the colour, from the object or its layer", () => {
    const result = convert3dm(rhino, model("layers-and-colours.3dm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts[0]).toMatchObject({ name: "Red panel", layer: "Facade", color: "#ff0000" });
    expect(result.parts[1]).toMatchObject({ name: "Blue panel", layer: "Facade", color: "#0000ff" });
  });

  it("counts what it leaves out, by reason, and draws curves as tubes", () => {
    const result = convert3dm(rhino, model("with-curves-and-note.3dm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.imported).toBe(6); // two boxes and four lines drawn as thin tubes
    expect(result.report.curvesDrawn).toBe(4);
    expect(result.report.skipped).toMatchObject({ curves: 0, annotations: 1 });
    expect(totalSkipped(result.report.skipped)).toBe(1);
    expect(describeSkips(result.report.skipped)).toBe("1 annotation");
  });

  describe("curves", () => {
    const fileOf = (build: (f: import("rhino3dm").File3dm) => void) => {
      const f = new rhino.File3dm();
      f.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
      build(f);
      return new Uint8Array(f.toByteArray());
    };
    const points = (flat: number[][]) => flat.map((p) => p as unknown as number[]);

    it("a line is a tube from end to end, with the width of a thin line", () => {
      const line = convert3dm(rhino, model("with-curves-and-note.3dm"));
      if (!line.ok) throw new Error(line.error);
      const tube = line.parts.find((p) => p.indices.length > 36 && p.name !== "Box A" && p.name !== "Box B");
      expect(tube).toBeDefined();
      const b = partBounds(tube as never);
      expect(b.min[0]).toBeCloseTo(0, 3);
      expect(b.max[0]).toBeCloseTo(1000, 3);
      // 1000 mm long: a 4 mm radius (the smallest), six sides.
      expect(b.max[1] - b.min[1]).toBeGreaterThan(6);
      expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(8.1);
    });

    it("a smooth curve follows its shape, not its control polygon", () => {
      const bytes = fileOf((f) => {
        const curve = rhino.NurbsCurve.create(
          false,
          3,
          points([
            [0, 0, 0],
            [1000, 1000, 0],
            [2000, -1000, 0],
            [3000, 1000, 0],
            [4000, 0, 0],
          ]) as never,
        );
        f.objects().addCurve(curve as never, null as never);
      });
      const result = convert3dm(rhino, bytes);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.curvesDrawn).toBe(1);
      const b = partBounds(result.parts[0] as never);
      expect(b.min[0]).toBeLessThan(5);
      expect(b.max[0]).toBeGreaterThan(3995);
      // The curve stays inside its control points' hull: it never reaches the 1000 mm of a control point.
      expect(b.max[1]).toBeLessThan(900);
      expect(b.max[1]).toBeGreaterThan(100);
      expect(result.parts[0]?.indices.length).toBeGreaterThan(600);
    });

    it("a polyline keeps its corners", () => {
      const bytes = fileOf((f) => {
        const curve = rhino.NurbsCurve.create(
          false,
          1,
          points([
            [0, 0, 0],
            [1000, 0, 0],
            [1000, 1000, 500],
            [0, 1000, 0],
          ]) as never,
        );
        f.objects().addCurve(curve as never, null as never);
      });
      const result = convert3dm(rhino, bytes);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const b = partBounds(result.parts[0] as never);
      expect(b.max[2]).toBeGreaterThan(499); // the high corner is on the tube, not cut off
      // Three pieces, six sides each, plus two end caps of six triangles.
      expect(result.parts[0]?.indices.length).toBe(3 * 6 * 6 + 2 * 6 * 3);
    });

    it("curves count toward the model's limit like any triangles", () => {
      const result = convert3dm(rhino, model("with-curves-and-note.3dm"), {
        ...IMPORT_LIMITS,
        maxTriangles: 100,
      });
      expect(result.ok).toBe(false);
    });
  });

  it("a Brep with no stored mesh is reported, not imported", () => {
    const result = convert3dm(rhino, model("brep-without-meshes.3dm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts).toHaveLength(0);
    expect(result.report.skipped.noMesh).toBe(1);
    expect(describeSkips(result.report.skipped)).toMatch(/Save small/);
  });

  it("expands a block through each reference's transform, and skips the definition's own copy", () => {
    const result = convert3dm(rhino, model("blocks.3dm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((p) => partBounds(p).min[0])).toEqual([1000, 5000]);
    expect(result.parts[0]?.name).toBe("Column");
  });

  it("says plainly when the file is not a Rhino file", () => {
    const result = convert3dm(rhino, model("not-a-3dm.3dm"));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/could not be read as a Rhino file/) });
  });

  it("a model with more than 1000 objects becomes one element per layer and colour", () => {
    const file = new rhino.File3dm();
    file.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
    const layers = ["Walls", "Floors", "Glass"].map((name) =>
      file.layers().addLayer(name, { r: 0, g: 0, b: 0, a: 255 }),
    );
    for (let i = 0; i < 1200; i++) {
      const mesh = new rhino.Mesh();
      for (const [x, y, z] of [
        [i, 0, 0],
        [i + 1, 0, 0],
        [i, 1, 0],
      ] as const) {
        mesh.vertices().add(x, y, z);
      }
      mesh.faces().addTriFace(0, 1, 2);
      const attributes = new rhino.ObjectAttributes();
      attributes.layerIndex = layers[i % 3] as number;
      file.objects().addMesh(mesh, attributes);
    }
    const result = convert3dm(rhino, file.toByteArray());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.map((p) => p.name)).toEqual([
      "Walls (400 objects)",
      "Floors (400 objects)",
      "Glass (400 objects)",
    ]);
    expect(result.parts.map((p) => p.indices.length / 3)).toEqual([400, 400, 400]);
    expect(result.report).toMatchObject({ imported: 3, objects: 1200, grouped: true, triangles: 1200 });
    // Merged triangles still index their own vertices.
    const walls = result.parts[0];
    expect(Math.max(...(walls?.indices ?? []))).toBe(1199);
    expect(partBounds(walls as never).max[0]).toBeGreaterThan(1190);
  });

  it("refuses a model with too many triangles, importing nothing", () => {
    const result = convert3dm(rhino, model("meshes-and-breps.3dm"), { maxFileBytes: 1e9, maxTriangles: 20 });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/triangles, over the limit/) });
  });

  it("refuses a file over the size limit before reading it", () => {
    const result = convert3dm(rhino, new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/500 MB/) });
  });
});
