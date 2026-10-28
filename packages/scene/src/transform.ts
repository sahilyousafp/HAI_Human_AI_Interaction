import type { Element, Level, Point3Mm, PointMm, SceneOp } from "@hai/protocol";
import { elementBase, elementBounds, unionBounds } from "./bounds.ts";
import { turn } from "./placement.ts";

/** One change of place: what Move, Rotate, Scale and Mirror (by hand, by voice or by the agent) all come down to. */
export type Transform =
  | { kind: "translate"; by: Point3Mm }
  /** Counter-clockwise seen from above, about a point in plan. */
  | { kind: "rotate"; deg: number; about: PointMm }
  /** Uniform, in plan and in height, about a point (its height is the height that stays where it is). */
  | { kind: "scale"; factor: number; about: Point3Mm }
  /** Flips x (about the line x = at) or y (about the line y = at). */
  | { kind: "mirror"; axis: "x" | "y"; at: number };

/** Where a transform takes a point. */
function mapPoint(t: Transform, p: Point3Mm): Point3Mm {
  switch (t.kind) {
    case "translate":
      return [p[0] + t.by[0], p[1] + t.by[1], p[2] + t.by[2]];
    case "rotate": {
      const [x, y] = turn([p[0] - t.about[0], p[1] - t.about[1]], t.deg);
      return [t.about[0] + x, t.about[1] + y, p[2]];
    }
    case "scale": {
      const [px, py, pz] = t.about;
      const k = t.factor;
      return [px + k * (p[0] - px), py + k * (p[1] - py), pz + k * (p[2] - pz)];
    }
    case "mirror":
      return t.axis === "x" ? [2 * t.at - p[0], p[1], p[2]] : [p[0], 2 * t.at - p[1], p[2]];
  }
}

const mapPlan = (t: Transform, p: PointMm): PointMm => {
  const [x, y] = mapPoint(t, [p[0], p[1], 0]);
  return [x, y];
};

/** The factor a transform scales lengths by (1 unless it scales). */
const factorOf = (t: Transform) => (t.kind === "scale" ? t.factor : 1);

/** The rotation of a turned rectangle after the transform: a mirror reverses it, a rotation adds to it. */
function rotationAfter(deg: number, t: Transform): number {
  if (t.kind === "rotate") return deg + t.deg;
  if (t.kind === "mirror") return -deg;
  return deg;
}

/** Whether a transform changes the vertical position of things (a move up or down, a scale about a height). */
const movesHeight = (t: Transform) =>
  (t.kind === "translate" && t.by[2] !== 0) || (t.kind === "scale" && t.factor !== 1);

const scaledBase = (t: Transform, base: number) => mapPoint(t, [0, 0, base])[2];

/**
 * The patch that puts an element through a transform, or null when it cannot be done (a mirrored imported model: its
 * triangles would have to be turned inside out). The patch is whole fields, ready for an `update` op, and never
 * touches a field the transform leaves alone.
 */
export function transformPatch(
  element: Element,
  t: Transform,
  levels: Level[],
): Record<string, unknown> | null {
  const k = factorOf(t);
  const mirror = t.kind === "mirror";
  switch (element.type) {
    case "massing": {
      const [w, d, h] = element.size;
      const [cx, cy] = mapPlan(t, [element.origin[0] + w / 2, element.origin[1] + d / 2]);
      const [nw, nd, nh] = [w * k, d * k, h * k];
      const patch: Record<string, unknown> = {
        origin: [cx - nw / 2, cy - nd / 2, mapPoint(t, [0, 0, element.origin[2]])[2]],
      };
      if (k !== 1) patch.size = [nw, nd, nh];
      if (t.kind === "rotate" || mirror) patch.rotationDeg = rotationAfter(element.rotationDeg ?? 0, t);
      return patch;
    }
    case "column": {
      const patch: Record<string, unknown> = { position: mapPlan(t, element.position) };
      if (k !== 1) {
        patch.section = [element.section[0] * k, element.section[1] * k];
        patch.height = element.height * k;
      }
      if (t.kind === "rotate" || mirror) patch.rotationDeg = rotationAfter(element.rotationDeg ?? 0, t);
      if (movesHeight(t)) patch.base = scaledBase(t, elementBase(element, levels));
      return patch;
    }
    case "wall": {
      const patch: Record<string, unknown> = {
        start: mapPlan(t, element.start),
        end: mapPlan(t, element.end),
      };
      if (k !== 1) Object.assign(patch, { height: element.height * k, thickness: element.thickness * k });
      if (movesHeight(t)) patch.base = scaledBase(t, elementBase(element, levels));
      return patch;
    }
    case "slab": {
      const outline = element.outline.map((p) => mapPlan(t, p));
      // A mirror turns the outline clockwise: keep it counter-clockwise.
      const patch: Record<string, unknown> = { outline: mirror ? outline.reverse() : outline };
      if (k !== 1) patch.thickness = element.thickness * k;
      if (movesHeight(t)) patch.base = scaledBase(t, elementBase(element, levels));
      return patch;
    }
    case "line":
      return { points: element.points.map((p) => mapPoint(t, p)) };
    case "imported": {
      if (mirror) return null;
      // The foot of the box centre is the point that stays put in the model's own placement.
      const { min, max } = element.bounds;
      const [tx, ty, tz] = element.translation;
      const foot: Point3Mm = [(min[0] + max[0]) / 2 + tx, (min[1] + max[1]) / 2 + ty, min[2] + tz];
      const [fx, fy, fz] = mapPoint(t, foot);
      const patch: Record<string, unknown> = {
        translation: [fx - (min[0] + max[0]) / 2, fy - (min[1] + max[1]) / 2, fz - min[2]],
      };
      if (t.kind === "rotate") patch.rotationDeg = rotationAfter(element.rotationDeg ?? 0, t);
      if (k !== 1) patch.scale = (element.scale ?? 1) * k;
      return patch;
    }
  }
}

/** The `update` op that puts an element through a transform, or null when it cannot be done. */
export function transformOp(element: Element, t: Transform, levels: Level[]): SceneOp | null {
  const patch = transformPatch(element, t, levels);
  return patch ? { op: "update", id: element.id, patch } : null;
}

/** A step as a person or an agent states it: the point it turns, scales or mirrors about is the group's centre unless given. */
export type TransformStep =
  | { kind: "translate"; by: Point3Mm }
  | { kind: "rotate"; deg: number; about?: PointMm }
  | { kind: "scale"; factor: number; about?: Point3Mm }
  | { kind: "mirror"; axis: "x" | "y"; at?: number };

export type StepsResult =
  | { ok: true; patches: Record<string, Record<string, unknown>> }
  | { ok: false; error: string };

/**
 * Puts a group of elements through steps one after another, each acting on what the step before left (a copy rotated
 * after it was moved turns about where it now is). The pivot a step does not name is the centre of the group's plan box
 * as it stands then, at its lowest height. Returns one patch per element, or why it cannot be done (nothing is changed).
 */
export function applySteps(elements: Element[], steps: TransformStep[], levels: Level[]): StepsResult {
  let working = elements;
  const patches: Record<string, Record<string, unknown>> = {};
  for (const step of steps) {
    const box = unionBounds(working.map((e) => elementBounds(e, levels)));
    if (!box) return { ok: false, error: "There is nothing to change." };
    const centre: PointMm = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
    const t = resolveStep(step, centre, box.min[2]);
    const next: Element[] = [];
    for (const element of working) {
      const patch = transformPatch(element, t, levels);
      if (!patch) return { ok: false, error: `${element.name} (${element.type}) cannot be ${verb(t)}.` };
      patches[element.id] = { ...patches[element.id], ...patch };
      next.push({ ...element, ...patch } as Element);
    }
    working = next;
  }
  return { ok: true, patches };
}

/** A step with its pivot filled in: the group's centre in plan, and its lowest height for a scale. */
function resolveStep(step: TransformStep, centre: PointMm, lowest: number): Transform {
  switch (step.kind) {
    case "rotate":
      return { kind: "rotate", deg: step.deg, about: step.about ?? centre };
    case "scale":
      return { kind: "scale", factor: step.factor, about: step.about ?? [centre[0], centre[1], lowest] };
    case "mirror":
      return { kind: "mirror", axis: step.axis, at: step.at ?? centre[step.axis === "x" ? 0 : 1] };
    case "translate":
      return step;
  }
}

const verb = (t: Transform) => (t.kind === "mirror" ? "mirrored" : `${t.kind}d`);
