import type { Point2 } from "@hai/protocol";

/**
 * Snapping a hand pointer to a model. A pinch lands where the hand is, which is rarely pixel-exact, so when the ray
 * through the pointer hits nothing, the nearest model within a few centimetres of the pointer on screen is meant. A
 * model's outline on screen is taken as the convex hull of its bounding box's corners (a box is its own hull, and for
 * anything else it is a little generous, which is the right side to err on for snapping).
 */

/** One candidate: an element id, its hull on screen (px) and how far it is from the camera. */
export interface SnapCandidate {
  id: string;
  /** The corners projected to the screen, px. */
  corners: Point2[];
  depth: number;
}

/** The corners of the convex hull, counter-clockwise (Andrew's monotone chain). Fewer than 3 points come back as given. */
export function convexHull(points: Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (input: Point2[]): Point2[] => {
    const chain: Point2[] = [];
    for (const p of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2] as Point2, chain[chain.length - 1] as Point2, p) <= 0
      )
        chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

/** The distance from a point to a segment, px. */
function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The distance from a point to a hull, px: 0 inside it (or on it), else to its nearest edge. */
export function distanceToHull(p: Point2, hull: Point2[]): number {
  if (hull.length === 0) return Number.POSITIVE_INFINITY;
  if (hull.length < 3) {
    const [a, b] = [hull[0] as Point2, (hull[1] ?? hull[0]) as Point2];
    return segmentDistance(p, a, b);
  }
  let inside = true;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i] as Point2;
    const b = hull[(i + 1) % hull.length] as Point2;
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) inside = false;
    nearest = Math.min(nearest, segmentDistance(p, a, b));
  }
  return inside ? 0 : nearest;
}

/**
 * The element a pointer at `at` (px) is nearest to, within `radius` px: the one whose outline is closest, and among
 * those equally close (the pointer is inside several outlines) the one nearest the camera. Null when none is in reach.
 */
export function nearestModel(candidates: SnapCandidate[], at: Point2, radius: number): string | null {
  let best: { id: string; distance: number; depth: number } | null = null;
  for (const candidate of candidates) {
    const distance = distanceToHull(at, convexHull(candidate.corners));
    if (distance > radius) continue;
    if (!best || distance < best.distance || (distance === best.distance && candidate.depth < best.depth)) {
      best = { id: candidate.id, distance, depth: candidate.depth };
    }
  }
  return best?.id ?? null;
}

/** How far a pointer snaps to a model, px: a twentieth of the view's height, kept between 24 and 64. */
export function snapRadius(viewHeightPx: number): number {
  return Math.min(64, Math.max(24, viewHeightPx / 20));
}
