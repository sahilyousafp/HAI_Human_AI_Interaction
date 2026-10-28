import type { Element, Level, Point3Mm } from "@hai/protocol";
import { elementBounds } from "./bounds.ts";
import { applySteps, type TransformStep } from "./transform.ts";

/** The most copies one array makes. */
export const MAX_ARRAY = 500;

/** A place on a rail where a copy goes. */
export interface RailStop {
  point: Point3Mm;
  /** The way the rail runs there, degrees counter-clockwise from +x seen from above. */
  headingDeg: number;
  /** How far along the copies this stop is: 0 at the first, 1 at the last. */
  t: number;
}

export interface RailOptions {
  /** The rail's last point joins its first. */
  closed?: boolean;
  /** A copy every this many millimetres along the rail. */
  spacing?: number;
  /** Or this many copies, spread evenly (round a closed rail without repeating the start). */
  count?: number;
  /** Where along the rail the first copy goes, millimetres from its start (default 0). */
  from?: number;
  /** Where the last copy may go, millimetres from its start (default the end of the rail). */
  to?: number;
}

export type RailResult = { ok: true; stops: RailStop[]; length: number } | { ok: false; error: string };

const EPSILON = 1e-6;

interface Run {
  from: Point3Mm;
  to: Point3Mm;
  length: number;
  headingDeg: number;
  start: number;
}

/** The straight runs of a rail, with the length before each; runs of no length are dropped. */
function runsOf(points: Point3Mm[], closed: boolean): Run[] {
  const runs: Run[] = [];
  let start = 0;
  let heading = 0;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i] as Point3Mm;
    const b = points[(i + 1) % points.length] as Point3Mm;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (length < EPSILON) continue;
    // A run straight up has no heading in plan: it keeps the one before.
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > EPSILON)
      heading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    runs.push({ from: a, to: b, length, headingDeg: heading, start });
    start += length;
  }
  return runs;
}

/**
 * Where copies go along a rail (a polyline): every `spacing` millimetres, or `count` of them spread evenly, between
 * `from` and `to` measured along the rail. Each stop says where the rail is and which way it runs.
 */
export function stopsAlong(points: Point3Mm[], options: RailOptions): RailResult {
  const closed = options.closed ?? false;
  const runs = runsOf(points, closed);
  const length = runs.reduce((sum, run) => sum + run.length, 0);
  if (runs.length === 0) return { ok: false, error: "The rail has no length." };
  const from = options.from ?? 0;
  const to = options.to ?? length;
  if (from < 0 || to > length + EPSILON || from >= to)
    return {
      ok: false,
      error: `The copies must lie between 0 and ${Math.round(length)} mm along the rail, from before to.`,
    };
  const { spacing, count } = options;
  if ((spacing === undefined) === (count === undefined))
    return { ok: false, error: "Give either spacing or count." };

  let distances: number[];
  if (spacing !== undefined) {
    if (spacing <= 0) return { ok: false, error: "The spacing must be above zero." };
    const wraps = closed && options.to === undefined;
    const steps = Math.floor((to - from) / spacing + EPSILON);
    // Round a closed rail the last stop would sit on the first.
    const fits = wraps && Math.abs(from + steps * spacing - to) < EPSILON ? steps - 1 : steps;
    distances = Array.from({ length: fits + 1 }, (_, i) => from + i * spacing);
  } else {
    if (!Number.isInteger(count) || (count as number) < 1)
      return { ok: false, error: "The count must be a whole number above zero." };
    const n = count as number;
    const gaps = closed && options.to === undefined ? n : n - 1;
    distances = Array.from({ length: n }, (_, i) => (gaps === 0 ? from : from + (i * (to - from)) / gaps));
  }
  if (distances.length > MAX_ARRAY)
    return {
      ok: false,
      error: `That is ${distances.length} copies; at most ${MAX_ARRAY} can be made at once. Use a larger spacing or a smaller count.`,
    };

  const stops = distances.map((distance, i): RailStop => {
    const run = runs.find((r) => distance <= r.start + r.length + EPSILON) ?? (runs.at(-1) as Run);
    // At a corner the copy takes the way the rail runs on from it.
    const onward = runs[runs.indexOf(run) + 1];
    const atEnd = Math.abs(distance - (run.start + run.length)) < EPSILON && onward !== undefined;
    const along = Math.min(Math.max(distance - run.start, 0), run.length) / run.length;
    const point = run.from.map((v, k) => v + ((run.to[k] as number) - v) * along) as Point3Mm;
    return {
      point,
      headingDeg: (atEnd ? onward : run).headingDeg,
      t: distances.length > 1 ? i / (distances.length - 1) : 0,
    };
  });
  return { ok: true, stops, length };
}

/** A value that changes in a straight line from `from` at the first copy to `to` at the last. */
export interface Taper {
  from: number;
  to: number;
}

export interface ArrayOptions {
  /** Turn each copy to run the way the rail does; the element's own x axis is taken as its length along the rail. */
  align: boolean;
  /** Uniform scale of the whole element at each copy (1 keeps its size). */
  scale?: Taper;
  /** The element's width across the rail, millimetres: a massing's depth, a column's section depth. */
  width?: Taper;
}

const lerp = (taper: Taper, t: number) => taper.from + (taper.to - taper.from) * t;

export type ArrayResult = { ok: true; copies: Array<Record<string, unknown>> } | { ok: false; error: string };

/**
 * The copies of an element along a rail: for each stop, the fields of the copy that differ from the element, ready to be
 * laid over it. The element's centre in plan goes to the stop (its height follows the rail's rise from the first stop),
 * so the original can stay where it is as the module.
 */
export function arrayAlong(
  element: Element,
  stops: RailStop[],
  options: ArrayOptions,
  levels: Level[],
): ArrayResult {
  if (options.width && element.type !== "massing" && element.type !== "column")
    return { ok: false, error: `A width can only be set on a massing or a column, not a ${element.type}.` };
  const copies: Array<Record<string, unknown>> = [];
  const rise = stops[0]?.point[2] ?? 0;
  for (const stop of stops) {
    const copy = copyAt(element, stop, rise, options, levels);
    if (typeof copy === "string") return { ok: false, error: copy };
    copies.push(copy);
  }
  return { ok: true, copies };
}

/** The fields one copy differs by at a stop (scaled, then given its width, then turned and moved), or why it cannot be made. */
function copyAt(
  element: Element,
  stop: RailStop,
  rise: number,
  options: ArrayOptions,
  levels: Level[],
): Record<string, unknown> | string {
  let working = element;
  let fields: Record<string, unknown> = {};
  const layer = (patch: Record<string, unknown>) => {
    fields = { ...fields, ...patch };
    working = { ...working, ...patch } as Element;
  };
  const step = (steps: TransformStep[]): string | null => {
    const done = applySteps([working], steps, levels);
    if (!done.ok) return done.error;
    layer(done.patches[working.id] ?? {});
    return null;
  };

  const factor = options.scale ? lerp(options.scale, stop.t) : 1;
  if (factor <= 0) return "The scale must stay above zero along the whole array.";
  if (Math.abs(factor - 1) > EPSILON) {
    const failed = step([{ kind: "scale", factor }]);
    if (failed) return failed;
  }
  if (options.width) {
    const width = lerp(options.width, stop.t);
    if (width <= 0) return "The width must stay above zero along the whole array.";
    layer(withWidth(working, width));
  }
  const steps: TransformStep[] = [];
  if (options.align && Math.abs(stop.headingDeg) > EPSILON)
    steps.push({ kind: "rotate", deg: stop.headingDeg });
  const here = centreOf(working, levels);
  steps.push({
    kind: "translate",
    by: [stop.point[0] - here[0], stop.point[1] - here[1], stop.point[2] - rise],
  });
  return step(steps) ?? fields;
}

/** The patch that gives a massing or a column this width across, about its centre. */
function withWidth(element: Element, width: number): Record<string, unknown> {
  if (element.type === "massing") {
    const [w, d, h] = element.size;
    return {
      size: [w, width, h],
      origin: [element.origin[0], element.origin[1] + (d - width) / 2, element.origin[2]],
    };
  }
  if (element.type === "column") return { section: [element.section[0], width] };
  return {};
}

/** The centre of an element's plan box. */
function centreOf(element: Element, levels: Level[]): [number, number] {
  const { min, max } = elementBounds(element, levels);
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
}
