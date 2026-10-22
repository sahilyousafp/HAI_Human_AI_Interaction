import type { DrawingAids, Element, Point2, Point3Mm, PointMm, SceneDocument } from "@aex/protocol";
import { elementBase, elementBounds } from "./bounds.ts";

/** What a point snapped to; `ortho` is a point only held on an axis, with nothing else near. */
export type SnapKind = "endpoint" | "midpoint" | "centre" | "perpendicular" | "project" | "grid" | "ortho";

export const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: "Endpoint",
  midpoint: "Midpoint",
  centre: "Centre",
  perpendicular: "Perpendicular",
  project: "Project",
  grid: "Grid",
  ortho: "Ortho",
};

/** How close, on screen, a point must be to existing geometry to snap to it. */
export const SNAP_TOLERANCE_PX = 24;
/** The grid, millimetres. */
export const GRID_MM = 100;
/** Ortho holds a line to an axis or a diagonal when it is within this many degrees of it. */
export const ORTHO_WINDOW_DEG = 7.5;
/** A point counts as lying on the ortho line (and in its plane) when it is within this distance, millimetres. */
const ON_RAY_MM = 1;

type Segment = [Point3Mm, Point3Mm];

/**
 * The points (by kind) and edges of a model that a point can snap to, at their real heights. Built once per scene and
 * reused.
 */
export interface SnapIndex {
  endpoint: Point3Mm[];
  midpoint: Point3Mm[];
  centre: Point3Mm[];
  segments: Segment[];
  /**
   * One group per element: its bounding sphere and where its candidates are in the lists above, so a pointer far from
   * an element on screen skips all of them at the cost of a few projections.
   */
  groups: Group[];
}

/** An element's bounding sphere (millimetres) and its candidates' ranges: [from, to) in each list. */
interface Group {
  centre: Point3Mm;
  radius: number;
  endpoint: [number, number];
  midpoint: [number, number];
  centres: [number, number];
  segments: [number, number];
}

/** An index with nothing to snap to. */
export const emptySnapIndex = (): SnapIndex => ({
  endpoint: [],
  midpoint: [],
  centre: [],
  segments: [],
  groups: [],
});

/**
 * Where a point in the scene (millimetres) is on screen, px, written into `out`; false when it is behind the camera.
 * Takes the output so matching thousands of candidates allocates nothing.
 */
export type Projector = (point: Point3Mm, out: [number, number]) => boolean;

const mid3 = (a: Point3Mm, b: Point3Mm): Point3Mm => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];
const at3 = ([x, y]: PointMm, z: number): Point3Mm => [x, y, z];

/** A closed outline at one height: corners, edge midpoints and edges, and (optionally) its centre. */
function addOutline(index: SnapIndex, corners: PointMm[], z: number, centre: PointMm | null): void {
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length] as PointMm;
    const [pa, pb] = [at3(a, z), at3(b, z)];
    index.endpoint.push(pa);
    index.midpoint.push(mid3(pa, pb));
    index.segments.push([pa, pb]);
  });
  if (centre) index.centre.push(at3(centre, z));
}

/** The footprint of a box in plan: four corners, counter-clockwise. */
function footprint(min: readonly number[], max: readonly number[]): PointMm[] {
  const [x0, y0, x1, y1] = [min[0] as number, min[1] as number, max[0] as number, max[1] as number];
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function addElement(index: SnapIndex, element: Element, doc: SceneDocument): void {
  switch (element.type) {
    case "wall": {
      const base = elementBase(element, doc.levels);
      for (const z of [base, base + element.height]) {
        const [a, b] = [at3(element.start, z), at3(element.end, z)];
        index.endpoint.push(a, b);
        index.midpoint.push(mid3(a, b));
        index.segments.push([a, b]);
      }
      return;
    }
    case "column": {
      const base = elementBase(element, doc.levels);
      for (const z of [base, base + element.height]) {
        const p = at3(element.position, z);
        index.endpoint.push(p);
        index.centre.push(p);
      }
      return;
    }
    case "slab": {
      const { min, max } = elementBounds(element, doc.levels);
      const centre: PointMm = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
      addOutline(index, element.outline, elementBase(element, doc.levels), centre);
      return;
    }
    case "massing":
    case "imported": {
      const { min, max } = elementBounds(element, doc.levels);
      const centre: PointMm = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
      for (const z of [min[2], max[2]]) addOutline(index, footprint(min, max), z, centre);
      return;
    }
  }
}

/** Collects what can be snapped to, leaving out the elements in `exclude` (the ones being moved). */
export function buildSnapIndex(doc: SceneDocument, exclude: ReadonlySet<string> = new Set()): SnapIndex {
  const index = emptySnapIndex();
  for (const element of Object.values(doc.elements)) {
    if (exclude.has(element.id)) continue;
    const before = [index.endpoint.length, index.midpoint.length, index.centre.length, index.segments.length];
    addElement(index, element, doc);
    const { min, max } = elementBounds(element, doc.levels);
    index.groups.push({
      centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
      endpoint: [before[0] as number, index.endpoint.length],
      midpoint: [before[1] as number, index.midpoint.length],
      centres: [before[2] as number, index.centre.length],
      segments: [before[3] as number, index.segments.length],
    });
  }
  return index;
}

export interface ResolveInput {
  /** Where the pointer is on screen, px (or where a moved element's reference point is). */
  pointer: Point2;
  /** Where the view ray under the pointer meets the horizontal plane at a height, millimetres; null if it never does. */
  ground(heightMm: number): Point3Mm | null;
  /** Where the line being drawn or the move began; null for a first point. */
  anchor: Point3Mm | null;
  aids: DrawingAids;
  index: SnapIndex;
  /** The camera; without one no existing geometry can be matched and only Ortho and Grid apply. */
  project: Projector | null;
}

export interface Resolved {
  /** The point, millimetres, at the height it snapped to (or the plane it was drawn in). */
  point: Point3Mm;
  /** What the point snapped to, or null when it is the free point. */
  kind: SnapKind | null;
  /** The kind's name for the marker, or null. */
  label: string | null;
  /** The line is held to an axis or a diagonal. */
  ortho: boolean;
}

const round3 = (p: Point3Mm): Point3Mm => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];

/** The unit direction an ortho line takes from `anchor` towards `raw` in plan, or null when it is free (off every axis). */
function orthoDirection(anchor: readonly number[], raw: readonly number[]): PointMm | null {
  const dx = (raw[0] as number) - (anchor[0] as number);
  const dy = (raw[1] as number) - (anchor[1] as number);
  if (Math.hypot(dx, dy) === 0) return null;
  const step = Math.PI / 4;
  const angle = Math.atan2(dy, dx);
  const nearest = Math.round(angle / step) * step;
  if (Math.abs(angle - nearest) > (ORTHO_WINDOW_DEG * Math.PI) / 180) return null;
  return [Math.cos(nearest), Math.sin(nearest)].map((v) => (Math.abs(v) < 1e-9 ? 0 : v)) as PointMm;
}

/** The distance from a point to the infinite line through `anchor` along `dir`, in plan. */
function offRay(anchor: readonly number[], dir: PointMm, p: readonly number[]): number {
  return Math.abs(
    ((p[0] as number) - (anchor[0] as number)) * dir[1] - ((p[1] as number) - (anchor[1] as number)) * dir[0],
  );
}

/** Where the ray from `origin` along `dir` (both ways) meets a plan segment, or null when it misses or runs parallel. */
function rayHitsSegment(
  origin: readonly number[],
  dir: PointMm,
  a: readonly number[],
  b: readonly number[],
): PointMm | null {
  const [ax, ay, bx, by] = [a[0] as number, a[1] as number, b[0] as number, b[1] as number];
  const [px, py] = [origin[0] as number, origin[1] as number];
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dir[0] * ey - dir[1] * ex;
  if (Math.abs(denom) < 1e-9) return null;
  const ox = ax - px;
  const oy = ay - py;
  const t = (ox * ey - oy * ex) / denom;
  const u = (ox * dir[1] - oy * dir[0]) / denom;
  if (u < 0 || u > 1) return null;
  return [px + dir[0] * t, py + dir[1] * t];
}

/** The parameter (0 to 1) of the point on the segment a-b nearest to `p`, in plan (or on screen). */
function nearestParameter(a: readonly number[], b: readonly number[], p: readonly number[]): number {
  const dx = (b[0] as number) - (a[0] as number);
  const dy = (b[1] as number) - (a[1] as number);
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      (((p[0] as number) - (a[0] as number)) * dx + ((p[1] as number) - (a[1] as number)) * dy) / len2,
    ),
  );
}

/** Whether the perpendicular from `p` meets the plan segment within its length (not on the line beyond an end). */
function isFoot(p: readonly number[], a: readonly number[], b: readonly number[]): boolean {
  const dx = (b[0] as number) - (a[0] as number);
  const dy = (b[1] as number) - (a[1] as number);
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const t = (((p[0] as number) - (a[0] as number)) * dx + ((p[1] as number) - (a[1] as number)) * dy) / len2;
  return t >= 0 && t <= 1;
}

/** The groups of elements that could hold a candidate within reach of a screen position. */
function nearGroups(index: SnapIndex, project: Projector, reach: readonly number[]): Group[] {
  const near: Group[] = [];
  const c: [number, number] = [0, 0];
  const o: [number, number] = [0, 0];
  const probe: Point3Mm = [0, 0, 0];
  for (const g of index.groups) {
    if (!project(g.centre, c)) {
      near.push(g); // behind the camera, but parts of it may not be: keep it
      continue;
    }
    // How far the sphere reaches on screen: the largest of its radius along each axis, with room for perspective.
    let radius = 0;
    for (let axis = 0; axis < 3; axis++) {
      probe[0] = g.centre[0];
      probe[1] = g.centre[1];
      probe[2] = g.centre[2];
      probe[axis] = (probe[axis] as number) + g.radius;
      if (project(probe, o)) radius = Math.max(radius, Math.hypot(o[0] - c[0], o[1] - c[1]));
      else radius = Number.POSITIVE_INFINITY;
    }
    const limit = SNAP_TOLERANCE_PX + radius * 1.5 + 8;
    if ((c[0] - (reach[0] as number)) ** 2 + (c[1] - (reach[1] as number)) ** 2 <= limit * limit)
      near.push(g);
  }
  return near;
}

/** The edges of the given groups. */
function* segmentsOf(index: SnapIndex, groups: Group[]): Generator<Segment> {
  for (const g of groups) {
    for (let i = g.segments[0]; i < g.segments[1]; i++) yield index.segments[i] as Segment;
  }
}

const snapped = (point: Point3Mm, kind: SnapKind, ortho: boolean): Resolved => ({
  point,
  kind,
  label: SNAP_LABELS[kind],
  ortho,
});

/**
 * Where a point lands once the drawing aids that are on have had their say. Ortho comes first and holds the point on an
 * axis or diagonal through the anchor, in the plane at the anchor's height. Then the first of Endpoint, Midpoint,
 * Centre, Perpendicular and Project that has geometry within 24 px of the pointer on screen wins, whatever its height
 * (with Ortho on, only a point on the held line, in that plane, counts); then Grid takes what is left. With nothing on,
 * or nothing near, the free point on the plane is returned as it is. Null when the pointer meets no plane and nothing
 * snapped.
 */
export function resolvePoint(input: ResolveInput): Resolved | null {
  const { pointer, anchor, aids, index, project } = input;
  const height = anchor ? anchor[2] : 0;
  const raw = input.ground(height);
  const dir = aids.ortho && anchor && raw ? orthoDirection(anchor, raw) : null;
  const ortho = dir !== null;
  // The pointer's point on the plane, held on the ortho line when there is one.
  let held: Point3Mm | null = raw;
  if (raw && anchor && dir) {
    const along = (raw[0] - anchor[0]) * dir[0] + (raw[1] - anchor[1]) * dir[1];
    held = [anchor[0] + dir[0] * along, anchor[1] + dir[1] * along, height];
  }
  /** With Ortho holding a line, a candidate must lie on it, in its plane. */
  const onLine = (p: Point3Mm) =>
    !(anchor && dir) || (offRay(anchor, dir, p) <= ON_RAY_MM && Math.abs(p[2] - height) <= ON_RAY_MM);
  const tol2 = SNAP_TOLERANCE_PX * SNAP_TOLERANCE_PX;
  const px: [number, number] = [0, 0];
  const pxB: [number, number] = [0, 0];
  // Distances are taken from the pointer, or, when Ortho holds the line, from where the line's end is on screen.
  const reach: [number, number] = [pointer[0], pointer[1]];
  if (project && ortho && held) project(held, reach);
  const dist2 = (q: [number, number]) => (q[0] - reach[0]) ** 2 + (q[1] - reach[1]) ** 2;

  if (project) {
    // Elements whose bounding sphere is far from the pointer on screen cannot hold a candidate within reach.
    const near = nearGroups(index, project, reach);
    for (const kind of ["endpoint", "midpoint", "centre"] as const) {
      if (!aids[kind]) continue;
      let best: Point3Mm | null = null;
      let bestDistance = tol2;
      const list = index[kind];
      for (const g of near) {
        const [from, to] = kind === "centre" ? g.centres : g[kind];
        for (let i = from; i < to; i++) {
          const candidate = list[i] as Point3Mm;
          if (!project(candidate, px)) continue;
          const d = dist2(px);
          if (d <= bestDistance && onLine(candidate)) {
            best = candidate;
            bestDistance = d;
          }
        }
      }
      if (best) return snapped(best, kind, ortho);
    }

    if (aids.perpendicular && anchor) {
      let best: Point3Mm | null = null;
      let bestDistance = tol2;
      for (const [a, b] of segmentsOf(index, near)) {
        // The foot of the perpendicular must fall on the edge itself, not on its extension.
        if (!isFoot(anchor, a, b)) continue;
        const t = nearestParameter(a, b, anchor);
        const foot = round3([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        if (!project(foot, px)) continue;
        const d = dist2(px);
        if (d <= bestDistance && onLine(foot)) {
          best = foot;
          bestDistance = d;
        }
      }
      if (best) return snapped(best, "perpendicular", ortho);
    }

    if (aids.project) {
      let best: Point3Mm | null = null;
      let bestDistance = tol2;
      for (const [a, b] of segmentsOf(index, near)) {
        let hitPoint: Point3Mm | null = null;
        if (anchor && dir) {
          // Where the held line meets a level edge in its plane.
          if (Math.abs(a[2] - height) > ON_RAY_MM || Math.abs(b[2] - height) > ON_RAY_MM) continue;
          const hit = rayHitsSegment(anchor, dir, a, b);
          hitPoint = hit ? [hit[0], hit[1], height] : null;
        } else if (project(a, px) && project(b, pxB)) {
          // The point of the edge nearest the pointer on screen, taken back onto the edge in 3D.
          const t = nearestParameter(px, pxB, reach);
          hitPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        }
        if (!hitPoint) continue;
        const rounded = round3(hitPoint);
        if (!project(rounded, px)) continue;
        const d = dist2(px);
        if (d <= bestDistance) {
          best = rounded;
          bestDistance = d;
        }
      }
      if (best) return snapped(best, "project", ortho);
    }
  }

  if (held) {
    if (aids.grid) {
      if (anchor && dir) {
        // Step along the held line so its length lands on the grid, on both axes for a diagonal.
        const step = GRID_MM / Math.max(Math.abs(dir[0]), Math.abs(dir[1]));
        const along = (held[0] - anchor[0]) * dir[0] + (held[1] - anchor[1]) * dir[1];
        const k = Math.round(along / step);
        return snapped(
          round3([anchor[0] + dir[0] * k * step, anchor[1] + dir[1] * k * step, height]),
          "grid",
          true,
        );
      }
      return snapped(
        [Math.round(held[0] / GRID_MM) * GRID_MM, Math.round(held[1] / GRID_MM) * GRID_MM, height],
        "grid",
        ortho,
      );
    }
    if (dir) return { point: held, kind: "ortho", label: SNAP_LABELS.ortho, ortho: true };
  }
  if (raw) return { point: raw, kind: null, label: null, ortho: false };
  return null;
}
