import { MAX_SKETCH_POINTS, type Point2, type Point3Mm, type Sketch } from "@hai/protocol";
import type { Tool, ToolContext } from "./types.ts";

/** Sketch simplification: no kept point lies within this of the line between its neighbours, mm. */
export const SKETCH_TOLERANCE_MM = 100;
/** A path shorter than this adds nothing, mm. */
export const MIN_PATH_MM = 300;
/** An outline enclosing less than this adds nothing, mm² (1 square metre). */
export const MIN_AREA_MM2 = 1_000_000;
/** A new point is added to a sketch being drawn once the pointer has moved this far, mm. */
const SAMPLE_MM = 50;
/** A tap within this of a sketch's line or a marker on screen is on it, px (the drawing aids' snap reach). */
export const REFERENCE_REACH_PX = 24;

const distance = (a: Point3Mm, b: Point3Mm) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Distance from `p` to the segment a-b, in any number of dimensions. */
function segmentDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = a.map((v, i) => (b[i] ?? 0) - v);
  const ap = a.map((v, i) => (p[i] ?? 0) - v);
  const length2 = ab.reduce((sum, v) => sum + v * v, 0);
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ab.reduce((sum, v, i) => sum + v * (ap[i] ?? 0), 0) / length2));
  return Math.hypot(...ap.map((v, i) => v - t * (ab[i] ?? 0)));
}

/** Ramer-Douglas-Peucker: keeps the ends, and every point further than `tolerance` from the simplified line. */
export function simplify(points: Point3Mm[], tolerance = SKETCH_TOLERANCE_MM): Point3Mm[] {
  if (points.length <= 2) return points;
  const first = points[0] as Point3Mm;
  const last = points[points.length - 1] as Point3Mm;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i] as Point3Mm, first, last);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

/** The length of a path, mm. */
export function pathLength(points: Point3Mm[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += distance(points[i - 1] as Point3Mm, points[i] as Point3Mm);
  return length;
}

/** The area a closed outline encloses in plan, mm² (shoelace). */
export function outlineArea(points: Point3Mm[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i] as Point3Mm;
    const [x1, y1] = points[(i + 1) % points.length] as Point3Mm;
    twice += x0 * y1 - x1 * y0;
  }
  return Math.abs(twice) / 2;
}

/**
 * The sketch an outline or a path drawn by hand becomes: simplified, and kept only when it is big enough. An outline
 * that came back to its start is not given that point twice. Null with the reason when it is too small.
 */
export function finishSketch(
  kind: Sketch["kind"],
  drawn: Point3Mm[],
): { points: Point3Mm[] } | { tooSmall: string } {
  let points = simplify(drawn);
  if (kind === "outline") {
    const [first] = points;
    const last = points[points.length - 1];
    if (points.length > 3 && first && last && distance(first, last) <= SKETCH_TOLERANCE_MM)
      points = points.slice(0, -1);
    if (points.length < 3 || outlineArea(points) < MIN_AREA_MM2)
      return { tooSmall: "Outline at least a square metre to keep it." };
  } else if (points.length < 2 || pathLength(points) < MIN_PATH_MM) {
    return { tooSmall: `Draw at least ${MIN_PATH_MM} mm to keep a path.` };
  }
  if (points.length > MAX_SKETCH_POINTS)
    points = simplify(points, SKETCH_TOLERANCE_MM * 4).slice(0, MAX_SKETCH_POINTS);
  return { points };
}

/** The point under a viewer position, placed by the drawing aids, in whole millimetres; null if the view points away. */
function placed(ctx: ToolContext, at: Point2, anchor: Point3Mm | null = null): Point3Mm | null {
  const result = ctx.resolve(at, { anchor });
  if (!result) return null;
  const [x, y, z] = result.point;
  return [Math.round(x), Math.round(y), Math.round(z)];
}

/** The sketch or marker under a viewer position on screen (a marker first), or null. */
export function referenceAt(
  ctx: ToolContext,
  at: Point2,
): { kind: "marker"; letter: string } | { kind: "sketch"; label: string } | null {
  const pointer = ctx.toPixels(at);
  for (const marker of ctx.references.markers) {
    const p = ctx.toScreen(marker.point);
    if (p && Math.hypot(p[0] - pointer[0], p[1] - pointer[1]) <= REFERENCE_REACH_PX)
      return { kind: "marker", letter: marker.letter };
  }
  for (const sketch of [...ctx.references.sketches].reverse()) {
    const screen = sketch.points.map((p) => ctx.toScreen(p));
    const segments = sketch.kind === "outline" ? screen.length : screen.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = screen[i];
      const b = screen[(i + 1) % screen.length];
      if (a && b && segmentDistance(pointer, a, b) <= REFERENCE_REACH_PX)
        return { kind: "sketch", label: sketch.label };
    }
  }
  return null;
}

function sketchTool(options: {
  id: string;
  label: string;
  spoken: string[];
  icon: string;
  shortcut: string;
  kind: Sketch["kind"];
  hint: string;
}): Tool {
  let drawn: Point3Mm[] | null = null;
  return {
    id: options.id,
    label: options.label,
    spoken: options.spoken,
    icon: options.icon,
    shortcut: options.shortcut,
    activate(ctx) {
      ctx.setOverlay({ notice: options.hint });
    },
    deactivate(ctx) {
      drawn = null;
      ctx.references.setDraft(null);
      ctx.setOverlay({ notice: null });
    },
    onDragStart(ctx, at) {
      const start = placed(ctx, at);
      if (!start) return false;
      drawn = [start];
      ctx.references.setDraft({ kind: options.kind, points: drawn, hand: ctx.hand() });
      return true;
    },
    onDrag(ctx, at) {
      if (!drawn) return;
      const point = placed(ctx, at, drawn[0]);
      const last = drawn[drawn.length - 1];
      if (!point || (last && distance(point, last) < SAMPLE_MM)) return;
      drawn = [...drawn, point];
      ctx.references.setDraft({ kind: options.kind, points: drawn, hand: ctx.hand() });
    },
    onDragEnd(ctx, at) {
      if (!drawn) return;
      const end = placed(ctx, at, drawn[0]);
      const points = end ? [...drawn, end] : drawn;
      drawn = null;
      ctx.clearSnap();
      ctx.references.setDraft(null);
      const finished = finishSketch(options.kind, points);
      if ("tooSmall" in finished) {
        ctx.flash(finished.tooSmall);
        return;
      }
      const sketch = ctx.references.addSketch(options.kind, finished.points, ctx.hand());
      ctx.setOverlay({ notice: `${sketch.label} kept. Say what to do with it: "a wall along this".` });
    },
    onDragCancel(ctx) {
      drawn = null;
      ctx.references.setDraft(null);
    },
    onCancel(ctx) {
      if (ctx.references.sketches.length === 0) return false;
      ctx.references.clearSketches();
      ctx.flash("Sketches cleared.");
      return true;
    },
  };
}

export const sketchLineTool = (): Tool =>
  sketchTool({
    id: "sketch-line",
    label: "Sketch line",
    spoken: ["sketch line", "path"],
    icon: "M4 18c3-6 5-8 8-6s5 0 8-6",
    shortcut: "l",
    kind: "path",
    hint: "Pinch and drag to draw a path for the agent.",
  });

export const sketchAreaTool = (): Tool =>
  sketchTool({
    id: "sketch-area",
    label: "Sketch area",
    // "scatch area" is how the on-device speech model hears it (measured).
    spoken: ["area", "sketch area", "outline", "scatch area"],
    icon: "M5 7l6-3 8 4-2 9-9 2-3-6z",
    shortcut: "e",
    kind: "outline",
    hint: "Pinch and drag around an area for the agent.",
  });

export const placeMarkerTool: Tool = {
  id: "place-marker",
  label: "Place marker",
  spoken: ["marker", "place marker", "pin"],
  icon: "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  shortcut: "k",
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap to place a lettered marker; tap a marker to remove it." });
  },
  deactivate(ctx) {
    ctx.clearSnap();
    ctx.setOverlay({ notice: null });
  },
  onHover(ctx, at) {
    placed(ctx, at);
  },
  onTap(ctx, at) {
    const hit = referenceAt(ctx, at);
    if (hit?.kind === "marker") {
      ctx.references.removeMarker(hit.letter);
      ctx.flash(`Marker ${hit.letter} removed.`);
      return;
    }
    const point = placed(ctx, at);
    if (!point) return;
    const marker = ctx.references.placeMarker(point);
    ctx.flash(marker ? `Marker ${marker.letter} placed.` : "All 26 markers are in use; remove one first.");
  },
};
