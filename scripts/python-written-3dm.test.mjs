import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PythonWorkbench } from "../apps/bridge/src/python/python-run.ts";
import { HELPER_DIR, sharedPythonEnv } from "../apps/bridge/test/python-env.ts";
import { convert3dm } from "../apps/web/src/import/convert.ts";
import { partBounds } from "../packages/scene/src/index.ts";

// A .3dm written by Python without Rhino, through the helper, is read by HAI's own importer: every object comes in
// with triangles, nothing is skipped for lack of a mesh, and a disc is a disc.

const env = await sharedPythonEnv().catch(() => null);
const requireFromWeb = createRequire(join(import.meta.dirname, "..", "apps", "web", "package.json"));

const SCRIPT = `
import math
import rhino3dm as r
import hai_3dm

model = r.File3dm()

# A freeform canopy: a 5x5 cubic NURBS surface.
n = 5
surf = r.NurbsSurface.Create(3, False, 4, 4, n, n)
for i in range(n):
    for j in range(n):
        surf.Points[i, j] = r.Point4d(i * 1500, j * 1500, 900 * math.sin(i * 0.8) * math.cos(j * 0.8) + 3000, 1.0)
for k, v in enumerate([0, 0, 0, 0.5, 1, 1, 1]):
    surf.KnotsU[k] = v
    surf.KnotsV[k] = v
hai_3dm.add(model, r.Brep.CreateFromSurface(surf), "Canopy", "Roof", (60, 110, 200))

# A revolved solid about its own axis: its two end caps are discs of radius 800 and 300.
profile = r.NurbsCurve.CreateFromLine(r.Line(r.Point3d(800, 0, 0), r.Point3d(300, 0, 2200)))
rev = r.RevSurface.Create(profile, r.Line(r.Point3d(0, 0, 0), r.Point3d(0, 0, 1)), 0.0, 2 * math.pi)
hai_3dm.add(model, r.Brep.CreateFromRevSurface(rev, True, True), "Vase", "Roof")

# An extruded column.
hai_3dm.add(model, r.Extrusion.CreateCylinderExtrusion(r.Cylinder(r.Circle(r.Point3d(5000, 0, 0), 250), 3000), True, True), "Column", "Structure")

hai_3dm.save(model, "written.3dm")
`;

describe("a .3dm written by Python", () => {
  it.skipIf(!env)(
    "imports with every object drawn, nothing skipped for lack of a mesh, and discs for caps",
    async () => {
      const project = mkdtempSync(join(tmpdir(), "hai-written-"));
      const bench = new PythonWorkbench({ env, projectDir: () => project, helperDir: HELPER_DIR });
      const run = await bench.run({ code: SCRIPT, title: "Written", packages: [], agent: null });
      expect(run.ok, run.error).toBe(true);
      expect(run.written.map((w) => w.path)).toEqual(["written.3dm"]);

      const rhino = await requireFromWeb("rhino3dm")();
      const result = convert3dm(rhino, new Uint8Array(readFileSync(join(project, "written.3dm"))));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.parts.map((p) => p.name)).toEqual(["Canopy", "Vase", "Column"]);
      expect(result.report.skipped.noMesh).toBe(0);
      for (const part of result.parts) expect(part.indices.length, part.name).toBeGreaterThan(0);

      // The vase's bottom cap (z = 0) is a disc of radius 800: its triangles cover pi * r^2, not the square (2r)^2.
      const vase = result.parts[1];
      const area = bottomCapArea(vase.positions, vase.indices);
      expect(area).toBeGreaterThan(Math.PI * 800 ** 2 * 0.97);
      expect(area).toBeLessThan(Math.PI * 800 ** 2 * 1.03);
      expect(area).toBeLessThan((2 * 800) ** 2 * 0.9);
    },
    180_000,
  );

  it.skipIf(!env)(
    "curves written by Python are drawn: a smooth NURBS curve, a polyline and a circle",
    async () => {
      const project = mkdtempSync(join(tmpdir(), "hai-curves-"));
      const bench = new PythonWorkbench({ env, projectDir: () => project, helperDir: HELPER_DIR });
      const run = await bench.run({
        title: "Curves",
        packages: [],
        agent: null,
        code: [
          "import math",
          "import rhino3dm as r",
          "import hai_3dm",
          "model = r.File3dm()",
          "wave = r.NurbsCurve.Create(False, 3, [r.Point3d(i * 1000, 600 * math.sin(i), 2000) for i in range(7)])",
          "hai_3dm.add(model, wave, 'Wave', 'Curves', (200, 80, 40))",
          "path = r.PolylineCurve(r.Point3dList([r.Point3d(0, 0, 0), r.Point3d(3000, 0, 0), r.Point3d(3000, 3000, 1500)]))",
          "hai_3dm.add(model, path, 'Path', 'Curves')",
          "hai_3dm.add(model, r.Circle(r.Point3d(8000, 0, 0), 1200).ToNurbsCurve(), 'Ring', 'Curves')",
          "hai_3dm.save(model, 'curves.3dm')",
        ].join("\n"),
      });
      expect(run.ok, run.error).toBe(true);
      const rhino = await requireFromWeb("rhino3dm")();
      const result = convert3dm(rhino, new Uint8Array(readFileSync(join(project, "curves.3dm"))));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.parts.map((p) => p.name)).toEqual(["Wave", "Path", "Ring"]);
      expect(result.report.curvesDrawn).toBe(3);
      expect(result.report.skipped.curves).toBe(0);
      const [wave, path, ring] = result.parts.map((p) => partBounds(p));
      expect(wave.max[0]).toBeGreaterThan(5990);
      // The wave swings sideways; the curve stays inside its control points (600 mm out) and still reaches well out.
      expect(wave.max[1]).toBeGreaterThan(300);
      expect(wave.max[1]).toBeLessThan(620);
      expect(wave.min[1]).toBeLessThan(-100);
      expect(path.max[2]).toBeGreaterThan(1495);
      expect(ring.max[0] - ring.min[0]).toBeGreaterThan(2390);
      expect(ring.max[0] - ring.min[0]).toBeLessThan(2440); // the 2400 mm ring plus the tube's own width
    },
    180_000,
  );

  it.skipIf(!env)(
    "a plain rhino3dm save without the helper is reported, not silently empty",
    async () => {
      const project = mkdtempSync(join(tmpdir(), "hai-plain-"));
      const bench = new PythonWorkbench({ env, projectDir: () => project, helperDir: HELPER_DIR });
      const run = await bench.run({
        title: "Plain",
        packages: [],
        agent: null,
        code: "import rhino3dm as r\nm = r.File3dm()\nm.Objects.AddBrep(r.Brep.CreateFromBox(r.Box(r.BoundingBox(r.Point3d(0,0,0), r.Point3d(1000,1000,1000)))))\nm.Write('plain.3dm', 8)",
      });
      expect(run.ok, run.error).toBe(true);
      const rhino = await requireFromWeb("rhino3dm")();
      const result = convert3dm(rhino, new Uint8Array(readFileSync(join(project, "plain.3dm"))));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.skipped.noMesh).toBe(1);
    },
    180_000,
  );
});

/** The area of the triangles lying flat at z = 0. */
function bottomCapArea(positions, indices) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((k) => [
      positions[k * 3],
      positions[k * 3 + 1],
      positions[k * 3 + 2],
    ]);
    if (Math.abs(a[2]) + Math.abs(b[2]) + Math.abs(c[2]) > 1e-6) continue;
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  return area;
}
