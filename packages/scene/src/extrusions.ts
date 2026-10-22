import type { PointMm, SceneDocument } from "@hai/protocol";
import { elementBase } from "./bounds.ts";

/** The layer an element's type is saved on. */
export const EXPORT_LAYERS = {
  wall: "Walls",
  slab: "Slabs",
  column: "Columns",
  massing: "Massings",
} as const;

/** A drawn element as the extrusion of its footprint: what a Rhino file keeps of a wall, slab, column or massing. */
export interface ExtrusionExport {
  id: string;
  name: string;
  /** The layer it is saved on. */
  layer: (typeof EXPORT_LAYERS)[keyof typeof EXPORT_LAYERS];
  /** The closed footprint, counter-clockwise, without the first point repeated, millimetres. */
  footprint: PointMm[];
  /** Where the extrusion starts and how tall it is, millimetres. */
  baseMm: number;
  heightMm: number;
  /** The level's name, when the element is on one, and its own properties: kept as text on the object. */
  level: string | null;
  properties: Record<string, string | number | boolean>;
}

/** Twice the signed area of a polygon: positive when it runs counter-clockwise. */
function signedArea2(points: PointMm[]): number {
  let sum = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as PointMm;
    sum += a[0] * b[1] - b[0] * a[1];
  });
  return sum;
}

const counterClockwise = (points: PointMm[]): PointMm[] =>
  signedArea2(points) < 0 ? [...points].reverse() : points;

const rectangle = (x0: number, y0: number, x1: number, y1: number): PointMm[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/**
 * Every wall, slab, column and massing of a scene as the extrusion of its footprint, in the order of the scene. A wall is
 * the rectangle around its baseline; a slab its outline, hanging down from its level; a column and a massing their
 * rectangles. Imported geometry is not here: it is meshes, kept as they are. A wall with no length is left out.
 */
export function exportExtrusions(doc: SceneDocument): ExtrusionExport[] {
  const out: ExtrusionExport[] = [];
  const levelName = (id: string | undefined) => doc.levels.find((l) => l.id === id)?.name ?? null;
  for (const element of Object.values(doc.elements)) {
    const common = {
      id: element.id,
      name: element.name,
      level: levelName(element.level),
      properties: element.properties,
    };
    switch (element.type) {
      case "wall": {
        const [ax, ay] = element.start;
        const [bx, by] = element.end;
        const length = Math.hypot(bx - ax, by - ay);
        if (length === 0) break;
        const nx = (-(by - ay) / length) * (element.thickness / 2);
        const ny = ((bx - ax) / length) * (element.thickness / 2);
        out.push({
          ...common,
          layer: EXPORT_LAYERS.wall,
          footprint: [
            [ax - nx, ay - ny],
            [bx - nx, by - ny],
            [bx + nx, by + ny],
            [ax + nx, ay + ny],
          ],
          baseMm: elementBase(element, doc.levels),
          heightMm: element.height,
        });
        break;
      }
      case "slab":
        out.push({
          ...common,
          layer: EXPORT_LAYERS.slab,
          footprint: counterClockwise(element.outline),
          baseMm: elementBase(element, doc.levels) - element.thickness,
          heightMm: element.thickness,
        });
        break;
      case "column": {
        const [x, y] = element.position;
        const [w, d] = element.section;
        out.push({
          ...common,
          layer: EXPORT_LAYERS.column,
          footprint: rectangle(x - w / 2, y - d / 2, x + w / 2, y + d / 2),
          baseMm: elementBase(element, doc.levels),
          heightMm: element.height,
        });
        break;
      }
      case "massing": {
        const [x, y, z] = element.origin;
        const [w, d, h] = element.size;
        out.push({
          ...common,
          layer: EXPORT_LAYERS.massing,
          footprint: rectangle(x, y, x + w, y + d),
          baseMm: z,
          heightMm: h,
        });
        break;
      }
      case "imported":
        break;
    }
  }
  // A wall drawn right to left has the same rectangle; make sure each one runs counter-clockwise for Rhino.
  return out.map((e) => ({ ...e, footprint: counterClockwise(e.footprint) }));
}

/** Triangles of a simple counter-clockwise polygon by ear clipping: each is three indices into the polygon. */
function triangulate(polygon: PointMm[]): Array<[number, number, number]> {
  const remaining = polygon.map((_, i) => i);
  const triangles: Array<[number, number, number]> = [];
  const cross = (o: PointMm, a: PointMm, b: PointMm) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: PointMm, a: PointMm, b: PointMm, c: PointMm) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = polygon.length * polygon.length;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < remaining.length; k++) {
      const [ia, ib, ic] = [
        remaining[(k + remaining.length - 1) % remaining.length] as number,
        remaining[k] as number,
        remaining[(k + 1) % remaining.length] as number,
      ];
      const [a, b, c] = [polygon[ia] as PointMm, polygon[ib] as PointMm, polygon[ic] as PointMm];
      if (cross(a, b, c) <= 0) continue; // a reflex or flat corner is not an ear
      const covered = remaining.some(
        (i) => i !== ia && i !== ib && i !== ic && inside(polygon[i] as PointMm, a, b, c),
      );
      if (covered) continue;
      triangles.push([ia, ib, ic]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // not a simple polygon: what is left is closed with a fan below
  }
  for (let k = 1; k + 1 < remaining.length; k++) {
    triangles.push([remaining[0] as number, remaining[k] as number, remaining[k + 1] as number]);
  }
  return triangles;
}

/**
 * The triangles of an extrusion's prism (sides, bottom and top), millimetres, facing outward: what a Rhino file keeps as
 * the render mesh of the extrusion, so viewers that only read meshes (this app's import included) can draw it.
 */
export function prismMesh(e: ExtrusionExport): { positions: Float32Array; indices: Uint32Array } {
  const n = e.footprint.length;
  const positions = new Float32Array(n * 2 * 3);
  e.footprint.forEach(([x, y], i) => {
    positions.set([x, y, e.baseMm], i * 3);
    positions.set([x, y, e.baseMm + e.heightMm], (n + i) * 3);
  });
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i); // a side, facing out of the counter-clockwise footprint
  }
  for (const [a, b, c] of triangulate(e.footprint)) {
    indices.push(n + a, n + b, n + c); // the top faces up
    indices.push(c, b, a); // the bottom faces down
  }
  return { positions, indices: new Uint32Array(indices) };
}
