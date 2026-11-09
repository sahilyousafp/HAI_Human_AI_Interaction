import type { MeshPart } from "@hai/scene";
import type { File3dm, File3dmObject, GeometryBase, RhinoModule } from "rhino3dm";
import { type CurveLike, polylineLength, sampleCurve, tubeAlong, tubeRadiusMm } from "./curve-tube.ts";
import { reduceMesh } from "./reduce-mesh.ts";

/** The most an import may bring in; beyond this nothing is imported. */
export interface ImportLimits {
  maxFileBytes: number;
  maxTriangles: number;
}
export const IMPORT_LIMITS: ImportLimits = { maxFileBytes: 500_000_000, maxTriangles: 5_000_000 };

/** One imported object: its triangles in millimetres and what the file said about it. */
export interface ImportedPart extends MeshPart {
  name: string;
  layer?: string;
  /** Display colour, #rrggbb; absent when the file leaves it at the default. */
  color?: string;
  /** The object's id in the file (a block's parts take the block instance's); absent once parts are merged. */
  objectId?: string;
}

/** What was left out, by reason. */
export interface SkipCounts {
  curves: number;
  points: number;
  annotations: number;
  /** Block references that could not be expanded. */
  blocks: number;
  /** Meshes, Breps and extrusions the file stores no mesh for. */
  noMesh: number;
  unsupported: number;
}

export interface ImportReport {
  /** Elements created: one per object, or one per layer and colour for a big model. */
  imported: number;
  /** Objects read from the file. */
  objects: number;
  /** The objects were merged per layer and colour. */
  grouped: boolean;
  /** How many of the objects are curves, drawn as thin tubes along them. */
  curvesDrawn?: number;
  skipped: SkipCounts;
  /** The file's unit system by name, and how many millimetres one of its units is. */
  units: { name: string; mm: number; assumed: boolean };
  triangles: number;
  /** The model was over the limit because of blocks placed many times, and those are drawn with less detail. */
  simplified?: {
    /** The blocks drawn with less detail, by name. */
    blocks: string[];
    /** How many times they are placed in the model. */
    placements: number;
    /** The triangles of the whole model at full detail. */
    fromTriangles: number;
  };
}

export type ConvertResult =
  | { ok: true; parts: ImportedPart[]; report: ImportReport }
  | { ok: false; error: string };

/** How many millimetres one unit of each Rhino unit system is. */
const MM_PER_UNIT: Record<string, number> = {
  Nanometers: 1e-6,
  Microns: 1e-3,
  Millimeters: 1,
  Centimeters: 10,
  Decimeters: 100,
  Meters: 1000,
  Dekameters: 1e4,
  Hectometers: 1e5,
  Kilometers: 1e6,
  Microinches: 2.54e-5,
  Mils: 0.0254,
  Inches: 25.4,
  Feet: 304.8,
  Yards: 914.4,
  Miles: 1_609_344,
};

/**
 * The number behind a rhino3dm enum value. The typings say numbers; at run time the WebAssembly module hands out
 * objects with a `value`, and the same values compare equal by identity.
 */
const enumValue = (e: unknown): number => (typeof e === "number" ? e : (e as { value: number }).value);

/** A model with more objects than this is imported as one element per layer and colour. */
export const MAX_ELEMENTS = 1000;

const NO_SKIPS = (): SkipCounts => ({
  curves: 0,
  points: 0,
  annotations: 0,
  blocks: 0,
  noMesh: 0,
  unsupported: 0,
});

/** A 4 x 4 transform, row-major. */
type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const BLOCK_DEPTH = 8;

/** Only a block placed at least this many times is drawn with less detail: one placed once is part of the design. */
const MIN_PLACEMENTS = 2;
/** Blocks are simplified, the heaviest in the model first, until the exact geometry left is this share of the limit. */
const EXACT_SHARE = 0.2;
/** The share of the limit the simplified model may fill, so a model at the limit is not refused for a rounding. */
const REDUCED_SHARE = 0.9;
/** How finely a simplified block is kept, cells along its longest side: the finest that fits is used. */
const GRID_STEPS = [48, 32, 24, 16, 12, 8, 6, 4, 3, 2];

/** What to draw with less detail: the blocks, by definition id, and how finely. */
interface Reduction {
  definitions: Set<string>;
  cells: number;
  blocks: string[];
  placements: number;
  fromTriangles: number;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      for (let k = 0; k < 4; k++)
        out[r * 4 + c] = (out[r * 4 + c] as number) + (a[r * 4 + k] as number) * (b[k * 4 + c] as number);
    }
  }
  return out as unknown as Matrix;
}

const hex = (c: { r: number; g: number; b: number }): string | undefined => {
  if (c.r === 0 && c.g === 0 && c.b === 0) return undefined; // Rhino's default black: no colour was chosen
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Appends triangle meshes into one set of arrays. */
function merge(meshes: Array<{ position: Float32Array; index: Uint32Array }>): MeshPart {
  const vertices = meshes.reduce((n, m) => n + m.position.length, 0);
  const indices = meshes.reduce((n, m) => n + m.index.length, 0);
  const positions = new Float32Array(vertices);
  const index = new Uint32Array(indices);
  let v = 0;
  let i = 0;
  for (const m of meshes) {
    for (let k = 0; k < m.index.length; k++) index[i + k] = (m.index[k] as number) + v / 3;
    positions.set(m.position, v);
    v += m.position.length;
    i += m.index.length;
  }
  return { positions, indices: index };
}

/**
 * Reads a `.3dm` file into triangle parts in millimetres, Z up. Meshes come as they are; Breps and extrusions through
 * the render meshes the file stores for their faces; block references are expanded through their transforms. Curves
 * are drawn as thin tubes along them. Points, annotations and anything else are counted, not imported, so the report
 * can say what was left out.
 */
export function convert3dm(
  rhino: RhinoModule,
  bytes: Uint8Array,
  limits: ImportLimits = IMPORT_LIMITS,
): ConvertResult {
  if (bytes.length > limits.maxFileBytes) {
    return { ok: false, error: `The file is over the ${limits.maxFileBytes / 1e6} MB limit for imports.` };
  }
  let file: File3dm | null = null;
  try {
    file = rhino.File3dm.fromByteArray(bytes);
  } catch {
    file = null;
  }
  if (!file) {
    return {
      ok: false,
      error:
        "The file could not be read as a Rhino file. It may be damaged, not a .3dm file, or saved by a newer version of Rhino than this reader supports.",
    };
  }
  try {
    return convertFile(rhino, file, limits);
  } finally {
    file.destroy();
  }
}

function convertFile(rhino: RhinoModule, file: File3dm, limits: ImportLimits): ConvertResult {
  const unitValue = enumValue(file.settings().modelUnitSystem);
  const unitName = Object.keys(MM_PER_UNIT).find(
    (name) => enumValue((rhino.UnitSystem as unknown as Record<string, unknown>)[name]) === unitValue,
  );
  const units = unitName
    ? { name: unitName.toLowerCase(), mm: MM_PER_UNIT[unitName] as number, assumed: false }
    : { name: "millimetres", mm: 1, assumed: true };

  let skipped = NO_SKIPS();
  let parts: ImportedPart[] = [];
  let triangles = 0;
  let overLimit = false;
  let curvesDrawn = 0;
  let reduction: Reduction | null = null;

  const layerOf = (index: number) =>
    index >= 0 && index < file.layers().count ? file.layers().get(index) : null;

  /** The triangles of one geometry object in file units, or null when the file stores no mesh for it. */
  const meshOf = (geometry: GeometryBase): MeshPart | null => {
    const kind = geometry.objectType;
    const buffers = (mesh: { toThreejsBuffers(rotateToYUp: boolean): object }) =>
      mesh.toThreejsBuffers(false) as { position: Float32Array; index: Uint32Array };
    if (kind === rhino.ObjectType.Mesh) {
      const b = buffers(geometry as unknown as { toThreejsBuffers(rotateToYUp: boolean): object });
      return b.index.length > 0 ? { positions: b.position, indices: b.index } : null;
    }
    const brep =
      kind === rhino.ObjectType.Brep
        ? (geometry as unknown as import("rhino3dm").Brep)
        : kind === rhino.ObjectType.Extrusion
          ? (geometry as unknown as import("rhino3dm").Extrusion).toBrep(true)
          : null;
    if (!brep) return null;
    const faces = brep.faces();
    const found: Array<{ position: Float32Array; index: Uint32Array }> = [];
    for (let i = 0; i < faces.count; i++) {
      const mesh = faces.get(i).getMesh(rhino.MeshType.Any);
      if (mesh) found.push(buffers(mesh));
    }
    // An extrusion may carry its own mesh rather than its faces'.
    if (found.length === 0 && kind === rhino.ObjectType.Extrusion) {
      const own = (geometry as unknown as import("rhino3dm").Extrusion).getMesh(rhino.MeshType.Any);
      if (own) found.push(buffers(own));
    }
    const merged = found.length > 0 ? merge(found) : null;
    return merged && merged.indices.length > 0 ? merged : null;
  };

  /** A thin tube along a curve, in file units, or null when the curve has nothing to draw. */
  const curveOf = (geometry: GeometryBase): MeshPart | null => {
    const points = sampleCurve(geometry as unknown as CurveLike);
    if (!points) return null;
    const radius = tubeRadiusMm(polylineLength(points) * units.mm) / units.mm;
    const tube = tubeAlong(points, radius);
    return { positions: tube.positions, indices: tube.indices };
  };

  const cellsFor = (definitionId: string) =>
    reduction?.definitions.has(definitionId) ? reduction.cells : null;

  /** A low-detail copy of one object in a block, made once however many times the block is placed. */
  const reducedCopies = new Map<string, MeshPart | null>();
  const reducedOf = (id: string, geometry: GeometryBase, cells: number): MeshPart | null => {
    const key = `${id}|${cells}`;
    let copy = reducedCopies.get(key);
    if (copy === undefined) {
      const mesh = meshOf(geometry);
      copy = mesh ? reduceMesh(mesh, cells) : null;
      reducedCopies.set(key, copy);
    }
    return copy;
  };

  /**
   * The triangles of an object, a block counting all it holds. With `cells`, those of its low-detail copies. Counts are
   * kept by object, so a block placed thousands of times is measured once.
   */
  const triangleCounts = new Map<string, number>();
  const trianglesIn = (object: File3dmObject, cells: number | null, depth = 0): number => {
    const id = object.attributes().id as string;
    const key = cells === null ? id : `${id}|${cells}`;
    const known = triangleCounts.get(key);
    if (known !== undefined) return known;
    const geometry = object.geometry();
    const T = rhino.ObjectType;
    let count = 0;
    if (geometry.objectType === T.InstanceReference) {
      const reference = geometry as unknown as import("rhino3dm").InstanceReference;
      const definition = file.instanceDefinitions().findId(reference.parentIdefId);
      if (definition && depth < BLOCK_DEPTH) {
        for (const childId of definition.getObjectIds() as string[]) {
          const child = file.objects().findId(childId);
          if (child) count += trianglesIn(child, cells, depth + 1);
        }
      }
    } else if (geometry.objectType === T.Curve) {
      const curve = curveOf(geometry);
      count = curve ? curve.indices.length / 3 : 0;
    } else if (
      geometry.objectType === T.Mesh ||
      geometry.objectType === T.Brep ||
      geometry.objectType === T.Extrusion
    ) {
      const mesh = cells === null ? meshOf(geometry) : reducedOf(id, geometry, cells);
      count = mesh ? mesh.indices.length / 3 : 0;
    }
    triangleCounts.set(key, count);
    return count;
  };

  /**
   * How to bring a model over the limit under it by drawing its heaviest repeated blocks with less detail, keeping them
   * as fine as will fit, or null when it cannot be done: what is over the limit is not repeated.
   */
  const planReduction = (): Reduction | null => {
    const objects = file.objects();
    const placed = new Map<string, { object: File3dmObject; name: string; placements: number }>();
    let whole = 0;
    for (let i = 0; i < objects.count; i++) {
      const object = objects.get(i);
      if (object.attributes().isInstanceDefinitionObject) continue;
      whole += trianglesIn(object, null);
      const geometry = object.geometry();
      if (geometry.objectType !== rhino.ObjectType.InstanceReference) continue;
      const id = (geometry as unknown as import("rhino3dm").InstanceReference).parentIdefId as string;
      const entry = placed.get(id);
      if (entry) entry.placements++;
      else {
        const name = file.instanceDefinitions().findId(id)?.name || "Block";
        placed.set(id, { object, name, placements: 1 });
      }
    }
    const heaviest = [...placed.entries()]
      .filter(([, block]) => block.placements >= MIN_PLACEMENTS)
      .map(([id, block]) => ({ id, ...block, weight: block.placements * trianglesIn(block.object, null) }))
      .sort((a, b) => b.weight - a.weight);
    const chosen: typeof heaviest = [];
    let exact = whole;
    for (const block of heaviest) {
      if (exact <= limits.maxTriangles * EXACT_SHARE) break;
      chosen.push(block);
      exact -= block.weight;
    }
    if (chosen.length === 0) return null;
    for (const cells of GRID_STEPS) {
      const total = chosen.reduce((sum, b) => sum + b.placements * trianglesIn(b.object, cells), exact);
      if (total <= limits.maxTriangles * REDUCED_SHARE) {
        return {
          definitions: new Set(chosen.map((b) => b.id)),
          cells,
          blocks: chosen.map((b) => b.name),
          placements: chosen.reduce((sum, b) => sum + b.placements, 0),
          fromTriangles: whole,
        };
      }
    }
    return null;
  };

  const add = (
    object: File3dmObject,
    transform: Matrix,
    inherited: { name: string; color?: string; sourceId?: string } | null,
    depth: number,
    cells: number | null = null,
  ) => {
    const attributes = object.attributes();
    // The object in the file this part comes from: for a block's parts, the block instance placed in the model.
    const sourceId = inherited?.sourceId ?? (attributes.id as string | undefined);
    const geometry = object.geometry();
    const kind = geometry.objectType;
    const T = rhino.ObjectType;
    if (kind === T.InstanceReference) {
      const reference = geometry as unknown as import("rhino3dm").InstanceReference;
      const definition = file.instanceDefinitions().findId(reference.parentIdefId);
      const ids = definition ? (definition.getObjectIds() as string[]) : [];
      if (!definition || depth >= BLOCK_DEPTH || ids.length === 0) {
        skipped.blocks++;
        return;
      }
      const layer = layerOf(attributes.layerIndex);
      const own =
        enumValue(attributes.colorSource) === enumValue(rhino.ObjectColorSource.ColorFromObject)
          ? hex(attributes.objectColor as never)
          : undefined;
      const color = own ?? inherited?.color ?? (layer ? hex(layer.color as never) : undefined);
      const next = {
        name: attributes.name || definition.name || "Block",
        ...(color ? { color } : {}),
        ...(sourceId ? { sourceId } : {}),
      };
      const matrix = multiply(
        transform,
        Array.from(
          (reference.xform as unknown as { toFloatArray(rowDominant: boolean): number[] }).toFloatArray(true),
        ) as unknown as Matrix,
      );
      for (const id of ids) {
        const child = file.objects().findId(id);
        if (child) add(child, matrix, next, depth + 1, cells ?? cellsFor(definition.id as string));
        else skipped.blocks++;
      }
      return;
    }
    if (depth === 0 && attributes.isInstanceDefinitionObject) return; // a block's own geometry: placed through its references
    if (kind === T.Point || kind === T.PointSet) return void skipped.points++;
    if (kind === T.Annotation || kind === T.TextDot || kind === T.Hatch) return void skipped.annotations++;
    if (kind !== T.Mesh && kind !== T.Brep && kind !== T.Extrusion && kind !== T.Curve)
      return void skipped.unsupported++;

    const mesh =
      kind === T.Curve
        ? curveOf(geometry)
        : cells !== null
          ? reducedOf(attributes.id as string, geometry, cells)
          : meshOf(geometry);
    if (!mesh) return void (kind === T.Curve ? skipped.curves++ : skipped.noMesh++);
    if (kind === T.Curve) curvesDrawn++;
    const count = mesh.indices.length / 3;
    triangles += count;
    if (triangles > limits.maxTriangles) {
      overLimit = true;
      return;
    }
    // File units to millimetres, and the block's placement.
    const positions = new Float32Array(mesh.positions.length);
    const s = units.mm;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] as number;
      const y = mesh.positions[i + 1] as number;
      const z = mesh.positions[i + 2] as number;
      positions[i] = (transform[0] * x + transform[1] * y + transform[2] * z + transform[3]) * s;
      positions[i + 1] = (transform[4] * x + transform[5] * y + transform[6] * z + transform[7]) * s;
      positions[i + 2] = (transform[8] * x + transform[9] * y + transform[10] * z + transform[11]) * s;
    }
    const layer = layerOf(attributes.layerIndex);
    const source = enumValue(attributes.colorSource);
    const color =
      source === enumValue(rhino.ObjectColorSource.ColorFromObject)
        ? hex(attributes.objectColor as never)
        : source === enumValue(rhino.ObjectColorSource.ColorFromParent) && inherited?.color
          ? inherited.color
          : layer
            ? hex(layer.color as never)
            : undefined;
    const name = inherited?.name || attributes.name || layer?.name || "Imported";
    parts.push({
      positions,
      indices: mesh.indices,
      name,
      ...(layer?.name ? { layer: layer.name } : {}),
      ...(color ? { color } : {}),
      ...(sourceId ? { objectId: sourceId } : {}),
    });
  };

  const addAll = () => {
    skipped = NO_SKIPS();
    parts = [];
    triangles = 0;
    overLimit = false;
    curvesDrawn = 0;
    const objects = file.objects();
    for (let i = 0; i < objects.count && !overLimit; i++) add(objects.get(i), IDENTITY, null, 0);
  };
  addAll();
  if (overLimit) {
    reduction = planReduction();
    if (reduction) addAll();
    if (overLimit) {
      return {
        ok: false,
        error: `The model has more than ${limits.maxTriangles / 1e6} million triangles, over the limit for imports.`,
      };
    }
  }
  const grouped = parts.length > MAX_ELEMENTS;
  const elements = grouped ? groupByLayer(parts) : parts;
  return {
    ok: true,
    parts: elements,
    report: {
      imported: elements.length,
      objects: parts.length,
      grouped,
      ...(curvesDrawn > 0 ? { curvesDrawn } : {}),
      skipped,
      units,
      triangles,
      ...(reduction
        ? {
            simplified: {
              blocks: reduction.blocks,
              placements: reduction.placements,
              fromTriangles: reduction.fromTriangles,
            },
          }
        : {}),
    },
  };
}

/** Merges parts that share a layer and colour into one part each, named after the layer and how many it holds. */
export function groupByLayer(parts: ImportedPart[]): ImportedPart[] {
  const groups = new Map<string, ImportedPart[]>();
  for (const part of parts) {
    const key = `${part.layer ?? ""}|${part.color ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(part);
    else groups.set(key, [part]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as ImportedPart;
    const merged = merge(group.map((p) => ({ position: p.positions, index: p.indices })));
    const base = first.layer ?? "Imported";
    return {
      ...merged,
      name: `${base} (${group.length} ${group.length === 1 ? "object" : "objects"})`,
      ...(first.layer ? { layer: first.layer } : {}),
      ...(first.color ? { color: first.color } : {}),
    };
  });
}

/** One line per skipped reason, for the report ("4 curves, 1 annotation"). */
export function describeSkips(skipped: SkipCounts): string {
  const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [];
  if (skipped.curves) lines.push(noun(skipped.curves, "curve"));
  if (skipped.points) lines.push(noun(skipped.points, "point"));
  if (skipped.annotations) lines.push(noun(skipped.annotations, "annotation"));
  if (skipped.blocks) lines.push(`${noun(skipped.blocks, "block")} that could not be expanded`);
  if (skipped.noMesh) lines.push(`${noun(skipped.noMesh, "object")} with no mesh (saved with Save small?)`);
  if (skipped.unsupported) lines.push(`${skipped.unsupported} of other kinds`);
  return lines.join(", ");
}

export const totalSkipped = (skipped: SkipCounts): number =>
  Object.values(skipped).reduce((n, v) => n + v, 0);
