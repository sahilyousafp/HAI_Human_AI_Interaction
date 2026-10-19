import { z } from "zod";

/** Scene lengths are millimetres; the axis convention is right-handed with Z up, matching Rhino. */
export const SCENE_UNITS = "mm";
export const SCENE_UP = "Z";

const mm = z.number().finite();
const positiveMm = z.number().finite().positive();
export const PointMm = z.tuple([mm, mm]);
export type PointMm = z.infer<typeof PointMm>;
export const Point3Mm = z.tuple([mm, mm, mm]);
export type Point3Mm = z.infer<typeof Point3Mm>;

export const ElementId = z.string().min(1).max(64);

export const Level = z.strictObject({
  id: ElementId,
  name: z.string().min(1),
  /** Height of the level's floor above the origin, mm. */
  elevation: mm,
});
export type Level = z.infer<typeof Level>;

const common = {
  id: ElementId,
  name: z.string().min(1),
  /** Level id the element sits on; its base is at that level's elevation. */
  level: ElementId.optional(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
};

export const MassingElement = z.strictObject({
  ...common,
  type: z.literal("massing"),
  /** Minimum corner (x, y, z), mm. */
  origin: Point3Mm,
  /** Width (x), depth (y), height (z), mm. */
  size: z.tuple([positiveMm, positiveMm, positiveMm]),
});

export const SlabElement = z.strictObject({
  ...common,
  type: z.literal("slab"),
  /** Closed outline in plan, counter-clockwise, mm. */
  outline: z.array(PointMm).min(3),
  thickness: positiveMm,
});

export const WallElement = z.strictObject({
  ...common,
  type: z.literal("wall"),
  /** Baseline in plan, mm; the wall is centred on it. */
  start: PointMm,
  end: PointMm,
  height: positiveMm,
  thickness: positiveMm,
});

export const ColumnElement = z.strictObject({
  ...common,
  type: z.literal("column"),
  position: PointMm,
  /** Section width (x) and depth (y), mm. */
  section: z.tuple([positiveMm, positiveMm]),
  height: positiveMm,
});

export const Element = z.discriminatedUnion("type", [
  MassingElement,
  SlabElement,
  WallElement,
  ColumnElement,
]);
export type Element = z.infer<typeof Element>;
export type ElementType = Element["type"];

export const SceneDocument = z.strictObject({
  version: z.literal(1),
  units: z.literal(SCENE_UNITS),
  up: z.literal(SCENE_UP),
  name: z.string().min(1),
  levels: z.array(Level),
  elements: z.record(ElementId, Element),
});
export type SceneDocument = z.infer<typeof SceneDocument>;

/** Operations on the scene. Update is a shallow patch of an element's fields. */
export const SceneOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("create"), element: Element }),
  z.strictObject({ op: z.literal("update"), id: ElementId, patch: z.record(z.string(), z.unknown()) }),
  z.strictObject({ op: z.literal("delete"), id: ElementId }),
]);
export type SceneOp = z.infer<typeof SceneOp>;

/** One shared wording for invalid element fields, e.g. `Element "w-north": thickness must be greater than 0`. */
export function elementIssue(id: string, field: string, zodMessage: string): string {
  const message = zodMessage.replace(/^Too small: expected number to be >0$/, "must be greater than 0");
  return `Element "${id}": ${field || "element"} ${message}`;
}

export type ParseSceneResult = { ok: true; doc: SceneDocument } | { ok: false; error: string };

/**
 * Validates a scene document. Errors name the element id and the invalid field, e.g.
 * `Element "w-north": thickness must be greater than 0`.
 */
export function parseScene(raw: unknown): ParseSceneResult {
  const result = SceneDocument.safeParse(raw);
  if (result.success) {
    const levelIds = new Set(result.data.levels.map((l) => l.id));
    for (const element of Object.values(result.data.elements)) {
      if (element.level && !levelIds.has(element.level)) {
        return { ok: false, error: `Element "${element.id}": level "${element.level}" does not exist` };
      }
    }
    for (const [key, element] of Object.entries(result.data.elements)) {
      if (key !== element.id) return { ok: false, error: `Element "${key}": id field is "${element.id}"` };
    }
    return { ok: true, doc: result.data };
  }
  const issue = result.error.issues[0];
  if (!issue) return { ok: false, error: "Invalid scene" };
  const [section, id, ...field] = issue.path.map(String);
  if (section === "elements" && id)
    return { ok: false, error: elementIssue(id, field.join("."), issue.message) };
  return { ok: false, error: `${issue.path.join(".") || "scene"}: ${issue.message}` };
}
