import type { Element, Point2, Point3Mm } from "@hai/protocol";

export type LineElement = Extract<Element, { type: "line" }>;

/** Where a model point is on screen, px, or null when it is behind the camera. */
export type ScreenOf = (point: Point3Mm) => [number, number] | null;

/** The fewest points a line can have, and the fewest a closed one can. */
const MIN_POINTS = 2;
const MIN_CLOSED_POINTS = 3;

/**
 * The line point nearest the pointer on screen, within `reachPx`. Which line and which of its points: what a pinch
 * or a tap there means with the tools that edit points.
 */
export function linePointAt(
  lines: readonly LineElement[],
  screenOf: ScreenOf,
  pointer: Point2,
  reachPx: number,
): { id: string; index: number } | null {
  let found: { id: string; index: number } | null = null;
  let nearest = reachPx;
  for (const line of lines) {
    line.points.forEach((point, index) => {
      const at = screenOf(point);
      if (!at) return;
      const distance = Math.hypot(at[0] - pointer[0], at[1] - pointer[1]);
      if (distance <= nearest) {
        nearest = distance;
        found = { id: line.id, index };
      }
    });
  }
  return found;
}

/**
 * The line whose span runs nearest the pointer on screen, within `reachPx`, with the point of the span under the
 * pointer. A line is drawn far thinner than a finger, so it is found on screen and not by what the view ray hits.
 */
export function lineSpanAt(
  lines: readonly LineElement[],
  screenOf: ScreenOf,
  pointer: Point2,
  reachPx: number,
): { id: string; point: Point3Mm } | null {
  let found: { id: string; point: Point3Mm } | null = null;
  let nearest = reachPx;
  for (const line of lines) {
    const spans = line.closed ? line.points.length : line.points.length - 1;
    for (let i = 0; i < spans; i++) {
      const a = line.points[i] as Point3Mm;
      const b = line.points[(i + 1) % line.points.length] as Point3Mm;
      const [sa, sb] = [screenOf(a), screenOf(b)];
      if (!sa || !sb) continue;
      const [dx, dy] = [sb[0] - sa[0], sb[1] - sa[1]];
      const length2 = dx * dx + dy * dy;
      const raw = length2 === 0 ? 0 : ((pointer[0] - sa[0]) * dx + (pointer[1] - sa[1]) * dy) / length2;
      const t = Math.max(0, Math.min(1, raw));
      const distance = Math.hypot(sa[0] + t * dx - pointer[0], sa[1] + t * dy - pointer[1]);
      if (distance <= nearest) {
        nearest = distance;
        found = {
          id: line.id,
          point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        };
      }
    }
  }
  return found;
}

/** The patch that puts one point of a line somewhere else. */
export function linePointMoved(line: LineElement, index: number, to: Point3Mm): { points: Point3Mm[] } {
  return { points: line.points.map((point, i) => (i === index ? to : point)) };
}

/**
 * The patch that takes one point out of a line, or null when too few would be left to be a line. A closed line left
 * with too few points to stay closed opens.
 */
export function linePointRemoved(
  line: LineElement,
  index: number,
): { points: Point3Mm[]; closed: boolean } | null {
  const points = line.points.filter((_, i) => i !== index);
  if (points.length < MIN_POINTS) return null;
  return { points, closed: line.closed && points.length >= MIN_CLOSED_POINTS };
}
