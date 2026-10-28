import type { SceneDocument } from "@hai/protocol";
import { exportExtrusions, importedPlacement, type MeshPart, prismMesh } from "@hai/scene";
import type { RhinoModule } from "rhino3dm";

/** What goes into a Rhino file: the scene, and the triangles of each imported model it uses (millimetres). */
export interface ExportInput {
  doc: SceneDocument;
  assets: ReadonlyMap<string, MeshPart[]>;
}

export interface ExportReport {
  /** Objects written: extrusions, curves and meshes. */
  objects: number;
  extrusions: number;
  curves: number;
  meshes: number;
  /** Elements that could not be saved, with the reason. */
  skipped: string[];
}

export type ExportResult =
  | { ok: true; bytes: Uint8Array; report: ExportReport }
  | { ok: false; error: string };

/**
 * Mesh arrays in the layout rhino3dm reads them: three.js axes (Y up), which it turns into Rhino's (Z up). A point
 * (x, y, z) of this app goes in as (x, z, -y) and comes out as itself.
 */
function asThreeAxes(
  positions: Float32Array,
  placement: { offset: readonly number[]; scale: number; rotationDeg: number } = {
    offset: [0, 0, 0],
    scale: 1,
    rotationDeg: 0,
  },
): Float32Array {
  const out = new Float32Array(positions.length);
  const { offset, scale } = placement;
  const cos = Math.cos((placement.rotationDeg * Math.PI) / 180);
  const sin = Math.sin((placement.rotationDeg * Math.PI) / 180);
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] as number;
    const py = positions[i + 1] as number;
    const x = (offset[0] as number) + scale * (px * cos - py * sin);
    const y = (offset[1] as number) + scale * (px * sin + py * cos);
    const z = (offset[2] as number) + scale * (positions[i + 2] as number);
    out[i] = x;
    out[i + 1] = z;
    out[i + 2] = -y;
  }
  return out;
}

/** The grey a layer gets when the file does not say. */
const LAYER_COLOR = { r: 150, g: 150, b: 150, a: 255 };

const rgba = (hex: string | undefined) => {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    a: 255,
  };
};

/**
 * Writes the scene as a Rhino file, in millimetres: each wall, slab, column and massing as a native extrusion of its
 * footprint at its real base height (with its prism as the render mesh, so mesh-only readers can draw it); each line as
 * a polyline curve through its points; each imported element as a mesh moved by its translation. Every object is on a layer named after its type or its source layer, is
 * named like the element, and carries the element's id, level and properties as user strings.
 */
export function buildFile3dm(rhino: RhinoModule, { doc, assets }: ExportInput): ExportResult {
  const extrusions = exportExtrusions(doc);
  const imported = Object.values(doc.elements).filter((e) => e.type === "imported");
  const lines = Object.values(doc.elements).filter((e) => e.type === "line");
  if (extrusions.length === 0 && imported.length === 0 && lines.length === 0) {
    return { ok: false, error: "There is nothing to save: the project has no elements." };
  }

  const file = new rhino.File3dm();
  try {
    file.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
    const layers = new Map<string, number>();
    const layerIndex = (name: string) => {
      let index = layers.get(name);
      if (index === undefined) {
        index = file.layers().addLayer(name, LAYER_COLOR);
        layers.set(name, index);
      }
      return index;
    };
    const attributesFor = (
      name: string,
      layer: string,
      id: string,
      level: string | null,
      properties: Record<string, string | number | boolean>,
    ) => {
      const attributes = new rhino.ObjectAttributes();
      attributes.name = name;
      attributes.layerIndex = layerIndex(layer);
      attributes.setUserString("hai.id", id);
      if (level) attributes.setUserString("hai.level", level);
      for (const [key, value] of Object.entries(properties))
        attributes.setUserString(`hai.property.${key}`, String(value));
      return attributes;
    };

    const report: ExportReport = { objects: 0, extrusions: 0, curves: 0, meshes: 0, skipped: [] };
    for (const e of extrusions) {
      const ring = [...e.footprint, e.footprint[0] as [number, number]].map(([x, y]) => [x, y, e.baseMm]);
      const curve = rhino.NurbsCurve.create(false, 1, ring);
      const extrusion = curve ? rhino.Extrusion.create(curve, e.heightMm, true) : null;
      if (!extrusion) {
        report.skipped.push(`${e.name}: its footprint could not be extruded`);
        continue;
      }
      const prism = prismMesh(e);
      const mesh = rhino.Mesh.createFromThreejsJSON({
        data: {
          attributes: {
            position: { itemSize: 3, type: "Float32Array", array: asThreeAxes(prism.positions) },
          },
          index: { type: "Uint32Array", array: prism.indices },
        },
      });
      if (mesh) extrusion.setMesh(mesh, rhino.MeshType.Render);
      file.objects().addExtrusion(extrusion, attributesFor(e.name, e.layer, e.id, e.level, e.properties));
      report.extrusions++;
    }

    for (const line of lines) {
      if (line.type !== "line") continue;
      const points = line.closed ? [...line.points, line.points[0] as [number, number, number]] : line.points;
      const curve = rhino.NurbsCurve.create(false, 1, points);
      if (!curve) {
        report.skipped.push(`${line.name}: its curve could not be written`);
        continue;
      }
      const level = doc.levels.find((l) => l.id === line.level)?.name ?? null;
      file.objects().addCurve(curve, attributesFor(line.name, "Lines", line.id, level, line.properties));
      report.curves++;
    }

    for (const element of imported) {
      if (element.type !== "imported") continue;
      const part = assets.get(element.asset)?.[element.part];
      if (!part) {
        report.skipped.push(`${element.name}: its model file is missing`);
        continue;
      }
      const positions = asThreeAxes(part.positions, importedPlacement(element));
      const mesh = rhino.Mesh.createFromThreejsJSON({
        data: {
          attributes: { position: { itemSize: 3, type: "Float32Array", array: positions } },
          index: { type: "Uint32Array", array: part.indices },
        },
      });
      if (!mesh) {
        report.skipped.push(`${element.name}: its triangles could not be written`);
        continue;
      }
      const attributes = attributesFor(
        element.name,
        element.layer ?? "Imported",
        element.id,
        null,
        element.properties,
      );
      const color = rgba(element.color);
      if (color) {
        attributes.colorSource = rhino.ObjectColorSource.ColorFromObject;
        attributes.objectColor = color;
      }
      file.objects().addMesh(mesh, attributes);
      report.meshes++;
    }

    report.objects = report.extrusions + report.curves + report.meshes;
    if (report.objects === 0) {
      return { ok: false, error: `Nothing could be saved. ${report.skipped.join("; ")}` };
    }
    return { ok: true, bytes: file.toByteArray(), report };
  } finally {
    file.destroy();
  }
}
