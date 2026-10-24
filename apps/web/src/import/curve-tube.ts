/**
 * Curves in the viewer. HAI's scene draws triangles, so a curve is drawn as a thin tube along it: sampled into a
 * polyline, then a six-sided tube with capped ends. It is a picture of the curve, not the curve (the saved `.3dm` keeps
 * the real one); a tube has a width in the model, where a CAD line has none, so the width is kept small.
 */

/** What of a rhino3dm curve the sampling needs; every curve class has `domain` and `pointAt`. */
export interface CurveLike {
  domain: number[];
  degree?: number;
  pointAt(t: number): number[];
  /** A polyline curve's vertices. */
  pointCount?: number;
  point?(index: number): number[];
  /** A NURBS curve's control points and knots. */
  points?(): { count: number; get(index: number): number[] };
  knots?(): { count: number; get(index: number): unknown };
}

const MIN_SAMPLES = 24;
const MAX_SAMPLES = 160;
const DEFAULT_SAMPLES = 64;

const finite = (p: number[]) => p.length >= 3 && p.every((v) => Number.isFinite(v));

/**
 * The points to draw a curve through, in the curve's own units: its vertices when it is made of straight pieces, so
 * corners stay sharp, else evenly along its domain (more for a curve with more control points). Null when it has none
 * to draw (a point-sized or broken curve).
 */
export function sampleCurve(curve: CurveLike): number[][] | null {
  const [t0, t1] = curve.domain;
  if (t0 === undefined || t1 === undefined || !(t1 > t0)) return null;
  let points: number[][] = [];
  if (curve.pointCount !== undefined && curve.point) {
    for (let i = 0; i < curve.pointCount; i++) points.push(curve.point(i));
  } else if (curve.degree === 1 && curve.knots) {
    // Straight pieces: the curve passes through its control points at the knots.
    const knots = curve.knots();
    const seen = new Set<number>();
    for (let i = 0; i < knots.count; i++) {
      const t = Number(knots.get(i));
      if (Number.isFinite(t) && t >= t0 && t <= t1 && !seen.has(t)) {
        seen.add(t);
        points.push(curve.pointAt(t));
      }
    }
    if (points.length < 2) points = [curve.pointAt(t0), curve.pointAt(t1)];
  } else if (curve.degree === 1) {
    points = [curve.pointAt(t0), curve.pointAt(t1)];
  } else {
    const controls = curve.points ? curve.points().count : 0;
    const n = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, controls > 0 ? controls * 12 : DEFAULT_SAMPLES));
    for (let i = 0; i <= n; i++) points.push(curve.pointAt(t0 + ((t1 - t0) * i) / n));
  }
  if (!points.every(finite)) return null;
  // Drop repeated points: a zero-length piece has no direction.
  const kept = points.filter((p, i) => i === 0 || distance(p, points[i - 1] as number[]) > 1e-9);
  return kept.length >= 2 ? kept : null;
}

const distance = (a: number[], b: number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

/** The length of the polyline. */
export function polylineLength(points: number[][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i] as number[], points[i - 1] as number[]);
  return total;
}

/**
 * The tube's radius for a curve of this length: a small share of it, kept between 4 and 40 mm so a short line is
 * still visible and a long one does not turn into a pipe. Millimetres.
 */
export const tubeRadiusMm = (lengthMm: number): number => Math.min(40, Math.max(4, lengthMm * 0.0015));

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
function unit(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

/**
 * A tube of `sides` sides and the given radius along a polyline (any units: the result is in the same ones), with
 * capped ends. The cross-section is carried along the line without twisting (parallel transport), and bends are
 * mitred, so a smooth curve gives a smooth tube.
 */
export function tubeAlong(
  points: number[][],
  radius: number,
  sides = 6,
): { positions: Float32Array; indices: Uint32Array } {
  const p = points.map((q) => [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0] as V3);
  const n = p.length;
  // The direction at each point: the average of the pieces on either side, so the section is square to the bend.
  const tangents: V3[] = p.map((point, i) => {
    const before = i > 0 ? unit(sub(point, p[i - 1] as V3)) : null;
    const after = i < n - 1 ? unit(sub(p[i + 1] as V3, point)) : null;
    if (before && after) return unit([before[0] + after[0], before[1] + after[1], before[2] + after[2]]);
    return (before ?? after) as V3;
  });
  // A first side vector square to the first direction, then carried along.
  const first = tangents[0] as V3;
  let normal: V3 = Math.abs(first[2]) < 0.9 ? unit(cross(first, [0, 0, 1])) : unit(cross(first, [1, 0, 0]));
  const positions = new Float32Array((n * sides + 2) * 3);
  let at = 0;
  const ring: V3[][] = [];
  for (let i = 0; i < n; i++) {
    const t = tangents[i] as V3;
    // Keep the side vector square to this direction and as close as possible to the last one.
    normal = unit(sub(normal, scale(t, dot(normal, t))));
    const binormal = unit(cross(t, normal));
    const row: V3[] = [];
    for (let s = 0; s < sides; s++) {
      const angle = (2 * Math.PI * s) / sides;
      const offset = sub(scale(normal, Math.cos(angle) * radius), scale(binormal, -Math.sin(angle) * radius));
      const q: V3 = [(p[i] as V3)[0] + offset[0], (p[i] as V3)[1] + offset[1], (p[i] as V3)[2] + offset[2]];
      row.push(q);
      positions[at++] = q[0];
      positions[at++] = q[1];
      positions[at++] = q[2];
    }
    ring.push(row);
  }
  const startCentre = n * sides;
  const endCentre = startCentre + 1;
  for (const [index, centre] of [
    [startCentre, p[0] as V3],
    [endCentre, p[n - 1] as V3],
  ] as const) {
    positions[index * 3] = centre[0];
    positions[index * 3 + 1] = centre[1];
    positions[index * 3 + 2] = centre[2];
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s;
      const b = i * sides + ((s + 1) % sides);
      const c = (i + 1) * sides + s;
      const d = (i + 1) * sides + ((s + 1) % sides);
      indices.push(a, b, d, a, d, c);
    }
  }
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    indices.push(startCentre, next, s); // the start cap faces back along the curve
    const base = (n - 1) * sides;
    indices.push(endCentre, base + s, base + next); // the end cap faces forward
  }
  return { positions, indices: new Uint32Array(indices) };
}
